package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"clearledger/indexer/api"
	"clearledger/indexer/config"
	"clearledger/indexer/db"

	"github.com/stellar/go-stellar-sdk/keypair"
)

// stubSorobanRPC starts an httptest.Server that responds with a JSON-RPC
// envelope ({"jsonrpc":"2.0","id":1,"result":body}) using the handler.
// Cleanup is registered with t.Cleanup.
func stubSorobanRPC(t *testing.T, handler func(method string) (body any, status int)) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		body, status := handler(req.Method)
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result":  body,
		})
	}))
	t.Cleanup(server.Close)
	return server
}

// newTestEventListener builds an EventListener whose DB-touching fns are
// stubbed to return empty values, so tests do not depend on a live db.Pool.
// Override individual fields in a test when its scenario needs real behavior.
func newTestEventListener(t *testing.T, cfgOverrides ...func(*config.Config)) *EventListener {
	t.Helper()
	kp, err := keypair.Random()
	if err != nil {
		t.Fatalf("failed to generate random keypair: %v", err)
	}
	cfg := &config.Config{
		StellarNetwork:        "testnet",
		IndexerPollIntervalMs: 50,
		ServerSeed:            kp.Seed(),
		NetworkPassphrase:     "Test SDF Network ; September 2015",
		JWTSecret:             "test-secret",
	}
	for _, fn := range cfgOverrides {
		fn(cfg)
	}
	l := NewEventListener(cfg, api.NewListenerHealth(), nil)
	// Defaults: zero-valued no-ops. Each test that needs real behavior
	// (e.g. TestStart_GetCheckpointErrorIsReturned) overrides the field below.
	l.getCheckpointFn = func(_ context.Context) (int32, error) { return 0, nil }
	l.getLatestProcessedLedgerFn = func(_ context.Context) (int32, error) { return 0, nil }
	l.upsertCheckpointFn = func(_ context.Context, _ int32) error { return nil }
	l.areEventsProcessedFn = func(_ context.Context, _ []string) (map[string]bool, error) {
		return map[string]bool{}, nil
	}
	return l
}

// ------------------------------------------------------------------
// pollEvents
// ------------------------------------------------------------------

func TestPollEvents_NoContractIDsReturnsLatestPlusOne(t *testing.T) {
	const wantLatest int32 = 5000
	var gotMethod string
	server := stubSorobanRPC(t, func(method string) (any, int) {
		gotMethod = method
		if method != "getLatestLedger" {
			t.Errorf("expected getLatestLedger, got %s", method)
		}
		return map[string]any{"sequence": wantLatest}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) { c.SorobanRPCURL = server.URL })

	got, err := l.pollEvents(context.Background(), 100)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if gotMethod != "getLatestLedger" {
		t.Errorf("expected rpc method=getLatestLedger, got %s", gotMethod)
	}
	if got != wantLatest+1 {
		t.Errorf("expected latest+1 = %d, got %d", wantLatest+1, got)
	}
}

func TestPollEvents_EmptyEventsReturnsLatestPlusOne(t *testing.T) {
	const inputStart int32 = 100
	const latestLedger int32 = 250
	var eventCalls int32

	server := stubSorobanRPC(t, func(method string) (any, int) {
		switch method {
		case "getEvents":
			atomic.AddInt32(&eventCalls, 1)
			return map[string]any{
				"events":       []any{},
				"latestLedger": uint32(latestLedger),
				"cursor":       "",
			}, http.StatusOK
		case "getLatestLedger":
			return map[string]any{"sequence": latestLedger}, http.StatusOK
		default:
			t.Errorf("unexpected RPC method: %s", method)
			return nil, http.StatusOK
		}
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
		c.InvoiceContractID = "CA4O3MR7LWHRSUDBNU6FY6UDFFYBN7TGBZXBDZB4OYYXFYXIFJ6RJF6B"
	})
	// AreEventsProcessed is wired to a no-op by newTestEventListener, but assert
	// it's never invoked when the events array is empty.
	l.areEventsProcessedFn = func(_ context.Context, _ []string) (map[string]bool, error) {
		t.Error("areEventsProcessed should not be called when the events array is empty")
		return map[string]bool{}, nil
	}

	got, err := l.pollEvents(context.Background(), inputStart)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if atomic.LoadInt32(&eventCalls) < 1 {
		t.Error("expected at least one getEvents call when contract IDs are configured")
	}
	if got != latestLedger+1 {
		t.Errorf("expected latest+1 = %d, got %d", latestLedger+1, got)
	}
}

func TestPollEvents_RPCErrorIsPropagated(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		// Enter the contract-id branch so the very first RPC call is getEvents
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	})

	if _, err := l.pollEvents(context.Background(), 100); err == nil {
		t.Fatal("expected error when RPC returns HTTP 500")
	}
}

// rpcEventFor builds one getEvents result entry whose topic[0] carries the
// given event symbol. Using a registration symbol with no address topic makes
// handleEvent fail before it touches the database, so tests can tell from the
// returned error whether an event was handed off for processing at all.
func rpcEventFor(id, symbol string) map[string]any {
	return map[string]any{
		"id":             id,
		"contractId":     "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C",
		"ledger":         124,
		"ledgerClosedAt": "2024-12-30T00:00:00Z",
		"type":           "contract",
		"topic":          []string{encodeSymbol(symbol)},
		"value":          map[string]any{"xdr": encodeSymbol("unused")},
	}
}

// TestPollEvents_ProcessedLookupFailureIsReturned is the #929 regression: when
// the events_log de-duplication lookup fails, pollEvents must surface the error
// so Start backs off, instead of treating every event on the page as new and
// re-applying on-chain state changes while the database is unhealthy.
func TestPollEvents_ProcessedLookupFailureIsReturned(t *testing.T) {
	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getEvents" {
			return map[string]any{"sequence": int32(200)}, http.StatusOK
		}
		return map[string]any{
			"events":       []any{rpcEventFor("200-000001", "issuer_registered")},
			"latestLedger": uint32(200),
			"cursor":       "",
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	})
	wantErr := errors.New("events_log lookup unavailable")
	l.areEventsProcessedFn = func(_ context.Context, _ []string) (map[string]bool, error) {
		return nil, wantErr
	}

	_, err := l.pollEvents(context.Background(), 100)
	if err == nil {
		t.Fatal("expected pollEvents to fail when the de-duplication lookup fails")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("expected the lookup error to be wrapped, got %v", err)
	}
	if !strings.Contains(err.Error(), "check processed events") {
		t.Errorf("expected 'check processed events' in error, got %v", err)
	}
	// handleEvent rejects a registration event with no address topic, so this
	// string appearing would prove the event fell through to processing.
	if strings.Contains(err.Error(), "handle event") {
		t.Errorf("event was processed despite the failed lookup: %v", err)
	}
}

// TestPollEvents_BatchLookupRunsOncePerPage covers #929's other half: the whole
// page is checked with a single AreEventsProcessed call, and rows already in
// events_log are skipped rather than handled.
func TestPollEvents_BatchLookupRunsOncePerPage(t *testing.T) {
	const contractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	eventIDs := []string{"300-000001", "300-000002", "300-000003"}
	events := make([]any, 0, len(eventIDs))
	for _, id := range eventIDs {
		events = append(events, rpcEventFor(id, "issuer_registered"))
	}

	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getEvents" {
			return map[string]any{"sequence": int32(300)}, http.StatusOK
		}
		return map[string]any{
			"events":       events,
			"latestLedger": uint32(300),
			"cursor":       "",
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.RegistryContractID = contractID
	})

	var lookups int32
	var gotIDs []string
	l.areEventsProcessedFn = func(_ context.Context, ids []string) (map[string]bool, error) {
		atomic.AddInt32(&lookups, 1)
		gotIDs = ids
		processed := make(map[string]bool, len(ids))
		for _, id := range ids {
			processed[id] = true
		}
		return processed, nil
	}

	if _, err := l.pollEvents(context.Background(), 100); err != nil {
		t.Fatalf("expected processed events to be skipped without error, got %v", err)
	}
	if got := atomic.LoadInt32(&lookups); got != 1 {
		t.Errorf("expected 1 batched lookup for the page, got %d", got)
	}
	if strings.Join(gotIDs, ",") != strings.Join(eventIDs, ",") {
		t.Errorf("expected the whole page in one call, got %v", gotIDs)
	}
}

// TestPollEvents_LookupFailureDoesNotReapplyInvoice is the DB-backed form of
// #929's acceptance criterion: with the lookup failing, neither the invoice row
// nor the events_log row may appear.
func TestPollEvents_LookupFailureDoesNotReapplyInvoice(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	const (
		issuer     = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
		buyer      = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
		contractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	)
	rawIDBytes := []byte(fmt.Sprintf("lookupfail%d", time.Now().UnixNano()))
	invoiceIDHex := fmt.Sprintf("%x", rawIDBytes)
	eventID := fmt.Sprintf("event-lookupfail-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		if db.Pool != nil {
			_, _ = db.Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", invoiceIDHex)
			_, _ = db.Pool.Exec(ctx, "DELETE FROM events_log WHERE event_id = $1", eventID)
		}
	})

	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getEvents" {
			return map[string]any{"sequence": int32(400)}, http.StatusOK
		}
		return map[string]any{
			"events": []any{map[string]any{
				"id":             eventID,
				"contractId":     contractID,
				"ledger":         400,
				"ledgerClosedAt": "2024-12-30T00:00:00Z",
				"type":           "contract",
				"topic":          []string{encodeSymbol("create")},
				"value": map[string]any{
					"xdr": makeInvoiceCreatedValue(rawIDBytes, issuer, buyer, 1000000000, 1735689600),
				},
			}},
			"latestLedger": uint32(400),
			"cursor":       "",
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.RegistryContractID = contractID
	})
	l.areEventsProcessedFn = func(_ context.Context, _ []string) (map[string]bool, error) {
		return nil, errors.New("connection reset by peer")
	}

	if _, err := l.pollEvents(context.Background(), 100); err == nil {
		t.Fatal("expected pollEvents to return the lookup error")
	}

	invoice, err := db.GetInvoiceByID(ctx, db.Pool, invoiceIDHex)
	if err != nil {
		t.Fatalf("GetInvoiceByID: %v", err)
	}
	if invoice != nil {
		t.Error("invoice row was inserted although the de-duplication lookup failed")
	}
	processed, err := db.IsEventProcessed(ctx, eventID)
	if err != nil {
		t.Fatalf("IsEventProcessed: %v", err)
	}
	if processed {
		t.Error("events_log row was written although the de-duplication lookup failed")
	}
}

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------

func TestStart_ContextCancelReturnsNil(t *testing.T) {
	server := stubSorobanRPC(t, func(_ string) (any, int) {
		return map[string]any{"sequence": int32(100)}, http.StatusOK
	})
	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.IndexerPollIntervalMs = 1000 // slow polling; we cancel before first tick
	})
	l.health.MarkStarted()

	errCh := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // safety net: unblock the goroutine if any assertion below fires

	go func() { errCh <- l.Start(ctx) }()

	// Give Start a tiny moment to enter the select loop, then cancel.
	time.Sleep(20 * time.Millisecond)
	cancel() // drives Start's ctx.Done() branch

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("expected nil error on ctx cancel, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return within 2s after ctx cancel")
	}
	if l.health.IsHealthy() {
		t.Error("expected listener health to be unhealthy after MarkStopped")
	}
}

func TestStart_GetCheckpointErrorIsReturned(t *testing.T) {
	l := newTestEventListener(t)
	wantErr := errors.New("checkpoint db down")
	l.getCheckpointFn = func(_ context.Context) (int32, error) {
		return 0, wantErr
	}

	err := l.Start(context.Background())
	if err == nil {
		t.Fatal("expected error from getCheckpoint failure")
	}
	if !strings.Contains(err.Error(), "checkpoint") {
		t.Errorf("expected 'checkpoint' in wrapped error, got %v", err)
	}
}

func TestStart_ProcessesAtLeastOnceThenStopsOnCancel(t *testing.T) {
	const latestLedger int32 = 500
	var pollCount int32
	server := stubSorobanRPC(t, func(method string) (any, int) {
		atomic.AddInt32(&pollCount, 1)
		switch method {
		case "getEvents":
			// Must return empty events so handleEvent's DB writes are never invoked.
			return map[string]any{
				"events":       []any{},
				"latestLedger": uint32(latestLedger),
				"cursor":       "",
			}, http.StatusOK
		case "getLatestLedger":
			return map[string]any{"sequence": latestLedger}, http.StatusOK
		case "getLedgers":
			// The post-poll hash record (issue #882) reads the finalized
			// ledger's header through getLedgers.
			return map[string]any{
				"ledgers": []any{map[string]any{"sequence": latestLedger, "hash": "abc123"}},
			}, http.StatusOK
		default:
			t.Errorf("unexpected method: %s", method)
			return nil, http.StatusOK
		}
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.IndexerPollIntervalMs = 10 // very tight loop
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	})

	// No events → upsertCheckpoint still runs (test that wire is connected).
	l.upsertCheckpointFn = func(_ context.Context, ledger int32) error {
		if ledger != latestLedger+1 {
			t.Errorf("expected checkpoint=latest+1=%d, got %d", latestLedger+1, ledger)
		}
		return nil
	}

	errCh := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // safety net
	go func() { errCh <- l.Start(ctx) }()

	// Wait for at least one poll iteration to occur.
	deadline := time.Now().Add(500 * time.Millisecond)
	for atomic.LoadInt32(&pollCount) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("listener never invoked RPC after 500ms")
		}
		time.Sleep(5 * time.Millisecond)
	}

	cancel() // drives Start's ctx.Done() branch after at least one iteration

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("expected nil error on ctx cancel after iteration, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return within 2s after cancel")
	}
	if l.health.IsHealthy() {
		// By the time Start returns via ctx.Done() (or after a final
		// iteration fails to find a non-cancelled ctx), MarkStopped has
		// been called and IsHealthy should report false.
		t.Error("expected listener health to be unhealthy after MarkStopped")
	}
}

func TestStart_SurvivesConsecutivePollErrors(t *testing.T) {
	const failures = 3
	var pollCount int32
	// Startup (getLatestLedger) succeeds so Start reaches its poll loop;
	// every getEvents call afterwards fails like a transient RPC outage.
	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method == "getEvents" {
			atomic.AddInt32(&pollCount, 1)
			return nil, http.StatusInternalServerError
		}
		return map[string]any{"sequence": int32(500)}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.IndexerPollIntervalMs = 5
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	})
	l.retryBackoff = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() { errCh <- l.Start(ctx) }()

	deadline := time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(&pollCount) < failures {
		if time.Now().After(deadline) {
			t.Fatal("listener exited after transient poll errors instead of retrying")
		}
		time.Sleep(5 * time.Millisecond)
	}

	// /health must surface the outage while the listener is backing off.
	healthDeadline := time.Now().Add(time.Second)
	for l.health.IsHealthy() && time.Now().Before(healthDeadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if l.health.IsHealthy() {
		t.Error("expected listener health to report degraded while retrying")
	}

	cancel()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("expected nil error on cancel after retry loop, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return after cancel")
	}
}

// ------------------------------------------------------------------
// Reorg protection (#882): confirmation depth + ledger hash verification
// ------------------------------------------------------------------

// eventAtLedger builds a getEvents entry for a specific ledger sequence on
// the registry contract.
func eventAtLedger(id string, ledger int32) map[string]any {
	ev := rpcEventFor(id, "issuer_registered")
	ev["ledger"] = ledger
	return ev
}

// TestPollEvents_ConfirmationDepthOnlyAppliesConfirmedEvents: with a depth of
// 3 and a tip at 104, only the ledger-101 event may enter processing, and the
// checkpoint must stop at the confirmation boundary (102) rather than the tip.
func TestPollEvents_ConfirmationDepthOnlyAppliesConfirmedEvents(t *testing.T) {
	const (
		startLedger  = int32(100)
		latestLedger = int32(104)
	)
	events := []any{
		eventAtLedger("101-000001", 101),
		eventAtLedger("102-000001", 102),
		eventAtLedger("103-000001", 103),
		eventAtLedger("104-000001", 104),
	}

	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getEvents" {
			return map[string]any{"sequence": latestLedger}, http.StatusOK
		}
		return map[string]any{
			"events":       events,
			"latestLedger": uint32(latestLedger),
			"cursor":       "",
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
		c.IndexerConfirmationDepth = 3
	})

	var lookedUp []string
	l.areEventsProcessedFn = func(_ context.Context, ids []string) (map[string]bool, error) {
		lookedUp = ids
		// Report everything as already indexed so handleEvent never runs: this
		// assertion is about which events entered the pipeline at all.
		processed := make(map[string]bool, len(ids))
		for _, id := range ids {
			processed[id] = true
		}
		return processed, nil
	}

	got, err := l.pollEvents(context.Background(), startLedger)
	if err != nil {
		t.Fatalf("pollEvents: %v", err)
	}
	if len(lookedUp) != 1 || lookedUp[0] != "101-000001" {
		t.Errorf("de-duplication lookup = %v, want only the confirmed ledger-101 event", lookedUp)
	}
	if want := int32(102); got != want { // safeLedger (104-3=101) + 1
		t.Errorf("next ledger = %d, want %d: the checkpoint must stop at the confirmation boundary", got, want)
	}
}

// TestPollEvents_PageInsideConfirmationWindowIsDeferredEntirely: when every
// event on the page is younger than the confirmation window, nothing is
// looked up or handled and the checkpoint does not advance past the window.
func TestPollEvents_PageInsideConfirmationWindowIsDeferredEntirely(t *testing.T) {
	const (
		startLedger  = int32(102)
		latestLedger = int32(104)
	)
	events := []any{
		eventAtLedger("102-000001", 102),
		eventAtLedger("103-000001", 103),
		eventAtLedger("104-000001", 104),
	}

	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getEvents" {
			return map[string]any{"sequence": latestLedger}, http.StatusOK
		}
		return map[string]any{
			"events":       events,
			"latestLedger": uint32(latestLedger),
			"cursor":       "",
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
		c.IndexerConfirmationDepth = 3
	})
	l.areEventsProcessedFn = func(_ context.Context, _ []string) (map[string]bool, error) {
		t.Error("no event on the page has cleared the confirmation window, so nothing may be looked up")
		return map[string]bool{}, nil
	}

	got, err := l.pollEvents(context.Background(), startLedger)
	if err != nil {
		t.Fatalf("pollEvents: %v", err)
	}
	if got != startLedger {
		t.Errorf("next ledger = %d, want %d: nothing confirmed yet, so the range is retried", got, startLedger)
	}
}

func TestVerifyFinalizedLedger_HashMismatchHalts(t *testing.T) {
	l := newTestEventListener(t)
	l.finalizedLedger = 500
	l.finalizedHash = "expected-hash"
	l.getLedgerHashFn = func(_ context.Context, sequence int32) (string, error) {
		if sequence != 500 {
			t.Errorf("verified ledger %d, want 500", sequence)
		}
		return "reorged-hash", nil
	}

	err := l.verifyFinalizedLedger(context.Background())
	if err == nil {
		t.Fatal("expected a reorg error when the finalized ledger's hash changed")
	}
	for _, want := range []string{"reorg detected at ledger 500", "replay", "restart the listener"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("reorg error %q does not contain the recovery step %q", err, want)
		}
	}
}

func TestVerifyFinalizedLedger_MatchingHashContinues(t *testing.T) {
	l := newTestEventListener(t)
	l.finalizedLedger = 500
	l.finalizedHash = "same-hash"
	l.getLedgerHashFn = func(context.Context, int32) (string, error) {
		return "same-hash", nil
	}

	if err := l.verifyFinalizedLedger(context.Background()); err != nil {
		t.Fatalf("expected nil when the hash is unchanged, got %v", err)
	}
}

// A transient RPC failure must not look like a reorg: absence of proof is not
// proof of divergence, so verification is skipped until the next poll.
func TestVerifyFinalizedLedger_TransientRPCFailureIsNotFatal(t *testing.T) {
	l := newTestEventListener(t)
	l.finalizedLedger = 500
	l.finalizedHash = "expected-hash"
	l.getLedgerHashFn = func(context.Context, int32) (string, error) {
		return "", errors.New("rpc unavailable")
	}

	if err := l.verifyFinalizedLedger(context.Background()); err != nil {
		t.Fatalf("expected a skipped verification rather than an error, got %v", err)
	}
}

func TestVerifyFinalizedLedger_NothingRecordedIsNoOp(t *testing.T) {
	l := newTestEventListener(t)
	l.getLedgerHashFn = func(context.Context, int32) (string, error) {
		t.Error("no hash was recorded yet, so nothing should be verified")
		return "", nil
	}

	if err := l.verifyFinalizedLedger(context.Background()); err != nil {
		t.Fatalf("expected nil before anything is finalized, got %v", err)
	}
}

func TestRecordFinalizedLedger_StoresNewBoundary(t *testing.T) {
	l := newTestEventListener(t)
	l.getLedgerHashFn = func(_ context.Context, sequence int32) (string, error) {
		return fmt.Sprintf("hash-%d", sequence), nil
	}

	l.recordFinalizedLedger(context.Background(), 500)

	if l.finalizedLedger != 500 || l.finalizedHash != "hash-500" {
		t.Errorf("recorded = (%d, %q), want (500, hash-500)", l.finalizedLedger, l.finalizedHash)
	}
}

// A failed hash read keeps the previous record (still valid to verify) rather
// than overwriting it with an unreadable state.
func TestRecordFinalizedLedger_KeepsPreviousOnRPCError(t *testing.T) {
	l := newTestEventListener(t)
	l.finalizedLedger = 500
	l.finalizedHash = "hash-500"
	l.getLedgerHashFn = func(context.Context, int32) (string, error) {
		return "", errors.New("rpc unavailable")
	}

	l.recordFinalizedLedger(context.Background(), 510)

	if l.finalizedLedger != 500 || l.finalizedHash != "hash-500" {
		t.Errorf("record = (%d, %q), want the previous (500, hash-500)", l.finalizedLedger, l.finalizedHash)
	}
}

func TestRecordFinalizedLedger_IgnoresOlderAndZeroSequences(t *testing.T) {
	l := newTestEventListener(t)
	l.finalizedLedger = 500
	l.finalizedHash = "hash-500"
	var calls int32
	l.getLedgerHashFn = func(context.Context, int32) (string, error) {
		atomic.AddInt32(&calls, 1)
		return "new-hash", nil
	}

	l.recordFinalizedLedger(context.Background(), 499)
	l.recordFinalizedLedger(context.Background(), 0)

	if got := atomic.LoadInt32(&calls); got != 0 {
		t.Errorf("hash read %d times, want 0 for non-advancing sequences", got)
	}
	if l.finalizedLedger != 500 || l.finalizedHash != "hash-500" {
		t.Errorf("record = (%d, %q), want the untouched (500, hash-500)", l.finalizedLedger, l.finalizedHash)
	}
}

func TestGetLedgerHash_ReturnsHeaderHash(t *testing.T) {
	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getLedgers" {
			t.Errorf("expected getLedgers, got %s", method)
		}
		return map[string]any{
			"ledgers": []any{map[string]any{"sequence": 500, "hash": "abc123"}},
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) { c.SorobanRPCURL = server.URL })

	hash, err := l.getLedgerHash(context.Background(), 500)
	if err != nil {
		t.Fatalf("getLedgerHash: %v", err)
	}
	if hash != "abc123" {
		t.Errorf("hash = %q, want abc123", hash)
	}
}

func TestGetLedgerHash_MissingLedgerIsAnError(t *testing.T) {
	server := stubSorobanRPC(t, func(method string) (any, int) {
		if method != "getLedgers" {
			t.Errorf("expected getLedgers, got %s", method)
		}
		// The response covers a different ledger than the one asked for.
		return map[string]any{
			"ledgers": []any{map[string]any{"sequence": 501, "hash": "abc123"}},
		}, http.StatusOK
	})

	l := newTestEventListener(t, func(c *config.Config) { c.SorobanRPCURL = server.URL })

	if _, err := l.getLedgerHash(context.Background(), 500); err == nil {
		t.Fatal("expected an error when the requested ledger is absent from the response")
	}
}

// TestStart_ReorgOnFinalizedLedgerHaltsListener is the end-to-end #882
// scenario: the first poll records the boundary ledger's hash, a later poll
// sees a different hash for it, and Start must stop with a reorg error (which
// main turns into a non-zero exit) instead of checkpointing further.
func TestStart_ReorgOnFinalizedLedgerHaltsListener(t *testing.T) {
	const (
		latestLedger = int32(200)
		checkpoint   = int32(100)
	)
	server := stubSorobanRPC(t, func(method string) (any, int) {
		switch method {
		case "getEvents":
			return map[string]any{
				"events":       []any{},
				"latestLedger": uint32(latestLedger),
				"cursor":       "",
			}, http.StatusOK
		case "getLatestLedger":
			return map[string]any{"sequence": latestLedger}, http.StatusOK
		default:
			t.Errorf("unexpected RPC method: %s", method)
			return nil, http.StatusOK
		}
	})

	l := newTestEventListener(t, func(c *config.Config) {
		c.SorobanRPCURL = server.URL
		c.IndexerPollIntervalMs = 10
		c.RegistryContractID = "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	})
	l.getCheckpointFn = func(context.Context) (int32, error) { return checkpoint, nil }

	// First read records the original hash (the record step); every later read
	// returns a different one, which is exactly what a reorg looks like.
	var hashCalls int32
	l.getLedgerHashFn = func(_ context.Context, sequence int32) (string, error) {
		if sequence != latestLedger {
			t.Errorf("hash requested for ledger %d, want the boundary %d", sequence, latestLedger)
		}
		if atomic.AddInt32(&hashCalls, 1) == 1 {
			return "original-hash", nil
		}
		return "reorged-hash", nil
	}

	errCh := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { errCh <- l.Start(ctx) }()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected Start to return a reorg error")
		}
		if !strings.Contains(err.Error(), "reorg detected at ledger") {
			t.Errorf("error = %v, want a reorg error", err)
		}
		if !strings.Contains(err.Error(), "replay") {
			t.Errorf("error = %v, want it to carry the manual replay step", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Start did not halt within 3s of the finalized ledger's hash changing")
	}
	if l.health.IsHealthy() {
		t.Error("expected listener health to report the halt")
	}
}

func TestEventFilterUsesConfiguredContractIDs(t *testing.T) {
	cfg := &config.Config{RegistryContractID: "CRegistry", InvoiceContractID: "CInvoice", PoolContractID: "", EscrowContractID: "CEscrow"}
	l := NewEventListener(cfg, api.NewListenerHealth(), nil)
	if len(l.cfg.RegistryContractID) == 0 || l.cfg.InvoiceContractID == "" || l.cfg.EscrowContractID == "" {
		t.Fatal("configured contract IDs must be retained for the RPC contract filter")
	}
}
