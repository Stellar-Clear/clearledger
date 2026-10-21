package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"clearledger/indexer/config"
	"clearledger/indexer/db"

	"github.com/go-chi/chi/v5"
	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/xdr"
)

// withURLParams returns a copy of req whose context carries the chi route
// parameters needed by handlers that read chi.URLParam (e.g. {id} and {address}).
// This lets tests invoke handlers directly without spinning up a full router.
func withURLParams(req *http.Request, params map[string]string) *http.Request {
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// buildLPPositionScVal returns a Map ScVal containing the LP position fields
// (shares / usdc_value / yield_earned as U128, deposit_count as U32) that
// HandleGetLPPosition reads via xdrutil.GetMapVal.
func buildLPPositionScVal(depositCount uint32, shares, usdcValue, yieldEarned uint64) xdr.ScVal {
	sym := func(s string) *xdr.ScSymbol {
		s2 := xdr.ScSymbol(s)
		return &s2
	}
	u128 := func(v uint64) *xdr.UInt128Parts {
		parts := xdr.UInt128Parts{Hi: xdr.Uint64(0), Lo: xdr.Uint64(v)}
		return &parts
	}
	u32 := func(v uint32) *xdr.Uint32 {
		u := xdr.Uint32(v)
		return &u
	}
	entries := []xdr.ScMapEntry{
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: sym("shares")}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU128, U128: u128(shares)}},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: sym("usdc_value")}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU128, U128: u128(usdcValue)}},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: sym("yield_earned")}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU128, U128: u128(yieldEarned)}},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: sym("deposit_count")}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU32, U32: u32(depositCount)}},
	}
	scMap := xdr.ScMap(entries)
	inner := &scMap
	return xdr.ScVal{Type: xdr.ScValTypeScvMap, Map: &inner}
}

// readonlyTestHandler builds an APIHandler with the testJWTSecret and a freshly
// generated server keypair, then returns it. Tests override individual
// *Fn fields to inject behavior.
func readonlyTestHandler(t *testing.T, cfgOverrides ...func(*config.Config)) *APIHandler {
	t.Helper()
	serverKP, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate server keypair: %v", err)
	}
	cfg := &config.Config{
		NetworkPassphrase: testNetworkPassphrase,
		JWTSecret:         "test-jwt-secret-for-readonly-tests",
		JWTExpiryHours:    24,
		ServerSeed:        serverKP.Seed(),
		PoolContractID:    "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS",
	}
	for _, fn := range cfgOverrides {
		fn(cfg)
	}
	h, err := NewAPIHandler(cfg)
	if err != nil {
		t.Fatalf("new APIHandler: %v", err)
	}
	return h
}

func decodeJSON[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode JSON: %v; body: %s", err, string(body))
	}
	return v
}

// ------------------------------------------------------------------
// HandleGetInvoiceByID
// ------------------------------------------------------------------

func TestHandleGetInvoiceByID_FoundReturns200(t *testing.T) {
	h := readonlyTestHandler(t)
	want := &db.DbInvoice{ID: "inv-1", Issuer: "GABC", Status: "Funded"}
	h.getInvoiceByIDFn = func(_ context.Context, id string) (*db.DbInvoice, error) {
		if id != "inv-1" {
			t.Errorf("expected id=inv-1, got %q", id)
		}
		return want, nil
	}

	req := withURLParams(httptest.NewRequest(http.MethodGet, "/invoices/inv-1", nil), map[string]string{"id": "inv-1"})
	rr := httptest.NewRecorder()
	h.HandleGetInvoiceByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}
	got := decodeJSON[db.DbInvoice](t, rr.Body.Bytes())
	if got.ID != want.ID || got.Status != want.Status {
		t.Errorf("expected %+v, got %+v", want, got)
	}
}

func TestHandleGetInvoiceByID_NotFoundReturns404(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getInvoiceByIDFn = func(_ context.Context, _ string) (*db.DbInvoice, error) {
		return nil, nil
	}

	rr := httptest.NewRecorder()
	req := withURLParams(httptest.NewRequest(http.MethodGet, "/invoices/missing", nil), map[string]string{"id": "missing"})
	h.HandleGetInvoiceByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestHandleGetInvoiceByID_DBErrorReturns500(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getInvoiceByIDFn = func(_ context.Context, _ string) (*db.DbInvoice, error) {
		return nil, errors.New("db down")
	}

	rr := httptest.NewRecorder()
	req := withURLParams(httptest.NewRequest(http.MethodGet, "/invoices/anything", nil), map[string]string{"id": "anything"})
	h.HandleGetInvoiceByID(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 on db error, got %d", rr.Code)
	}
}

// TestHandleGetInvoiceByID_InternalErrorDoesNotLeakErrorText covers issue
// #921: a backend failure must reach the operator's logs, not the client. The
// injected fn fails with an error carrying a sentinel secret (the kind of
// text pgx or *url.Error produce, e.g. an RPC URL with an API key); the
// response must stay generic, include a request id, and never contain the
// sentinel.
func TestHandleGetInvoiceByID_InternalErrorDoesNotLeakErrorText(t *testing.T) {
	h := readonlyTestHandler(t)

	const sentinel = "SUPER-SECRET-INTERNAL-DETAIL-postgres://user:pass@db/idx"
	h.getInvoiceByIDFn = func(_ context.Context, _ string) (*db.DbInvoice, error) {
		return nil, fmt.Errorf("pq: relation \"invoices\" missing: %s", sentinel)
	}

	rr := httptest.NewRecorder()
	req := withURLParams(httptest.NewRequest(http.MethodGet, "/invoices/anything", nil), map[string]string{"id": "anything"})
	h.HandleGetInvoiceByID(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), sentinel) {
		t.Fatalf("response leaked internal error text: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "failed to retrieve invoice") {
		t.Fatalf("expected generic failure message, got %q", rr.Body.String())
	}
	if rr.Header().Get("Content-Type") != "application/json" || !strings.Contains(rr.Body.String(), `"code":"internal_error"`) {
		t.Fatalf("expected JSON internal_error envelope, got %q", rr.Body.String())
	}
}

// ------------------------------------------------------------------
// HandleGetPoolStats
// ------------------------------------------------------------------

func TestHandleGetPoolStats_FoundReturnsJSON(t *testing.T) {
	h := readonlyTestHandler(t)
	updatedAt := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	h.getPoolStatsFn = func(_ context.Context) (*db.DbPoolStats, error) {
		return &db.DbPoolStats{
			TotalDeposits:         "100000",
			TotalFunded:           "50000",
			AvailableLiquidity:    "50000",
			UtilizationRateBps:    5000,
			TotalYieldDistributed: "1500",
			ActiveInvoiceCount:    3,
			UpdatedAt:             updatedAt,
		}, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/stats", nil)
	h.HandleGetPoolStats(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	got := decodeJSON[db.DbPoolStats](t, rr.Body.Bytes())
	if got.TotalDeposits != "100000" || got.ActiveInvoiceCount != 3 {
		t.Errorf("unexpected payload: %+v", got)
	}
}

func TestHandleGetPoolStats_NilReturnsZeros(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getPoolStatsFn = func(_ context.Context) (*db.DbPoolStats, error) {
		return nil, nil // pool_snapshots row missing
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/stats", nil)
	h.HandleGetPoolStats(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for missing stats row, got %d", rr.Code)
	}
	got := decodeJSON[db.DbPoolStats](t, rr.Body.Bytes())
	if got.TotalDeposits != "0" || got.AvailableLiquidity != "0" || got.ActiveInvoiceCount != 0 {
		t.Errorf("expected zero defaults for missing pool stats, got %+v", got)
	}
	if got.UpdatedAt.IsZero() {
		t.Error("expected populated UpdatedAt for client convenience")
	}
}

func TestHandleGetPoolStats_DBErrorReturns500(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getPoolStatsFn = func(_ context.Context) (*db.DbPoolStats, error) {
		return nil, errors.New("connection refused")
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/stats", nil)
	h.HandleGetPoolStats(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 on db error, got %d", rr.Code)
	}
}

// ------------------------------------------------------------------
// HandleGetEvents
// ------------------------------------------------------------------

func TestHandleGetEvents_HappyReturnsArray(t *testing.T) {
	h := readonlyTestHandler(t)
	want := []*db.EventLog{
		{ID: 1, EventID: "evt-1", EventType: "InvoiceCreated", Ledger: 200},
		{ID: 2, EventID: "evt-2", EventType: "InvoiceListed", Ledger: 201},
	}
	var capturedLimit int
	h.getRecentEventsFn = func(_ context.Context, limit int) ([]*db.EventLog, error) {
		capturedLimit = limit
		return want, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/events?limit=2", nil)
	h.HandleGetEvents(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if capturedLimit != 2 {
		t.Errorf("expected limit=2 to be forwarded, got %d", capturedLimit)
	}
	got := decodeJSON[[]*db.EventLog](t, rr.Body.Bytes())
	if len(got) != 2 || got[0].EventID != "evt-1" {
		t.Errorf("unexpected events payload: %+v", got)
	}
}

func TestHandleGetEvents_DefaultLimitIs20(t *testing.T) {
	h := readonlyTestHandler(t)
	var capturedLimit int
	h.getRecentEventsFn = func(_ context.Context, limit int) ([]*db.EventLog, error) {
		capturedLimit = limit
		return nil, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	h.HandleGetEvents(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if capturedLimit != 20 {
		t.Errorf("expected default limit=20, got %d", capturedLimit)
	}
}

func TestHandleGetEvents_DBErrorReturns500(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getRecentEventsFn = func(_ context.Context, _ int) ([]*db.EventLog, error) {
		return nil, errors.New("db error")
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	h.HandleGetEvents(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 on db error, got %d", rr.Code)
	}
}

// ------------------------------------------------------------------
// HandleGetLPPosition
// ------------------------------------------------------------------

func TestHandleGetLPPosition_HappyReturnsPosition(t *testing.T) {
	h := readonlyTestHandler(t)
	addrKP, _ := keypair.Random()

	h.readContractFn = func(_ context.Context, _ string, _ string, methodIn string, args []xdr.ScVal, _ *keypair.Full) (xdr.ScVal, error) {
		if methodIn != "get_lp_position" {
			t.Errorf("expected pool method get_lp_position, got %s", methodIn)
		}
		if len(args) != 1 {
			t.Errorf("expected 1 arg (address), got %d", len(args))
		}
		// Return a Map ScVal with the LP position fields the handler queries via xdrutil.
		return buildLPPositionScVal(7, 1234, 5678, 90), nil
	}

	req := withURLParams(httptest.NewRequest(http.MethodGet, "/pool/position/"+addrKP.Address(), nil), map[string]string{"address": addrKP.Address()})
	rr := httptest.NewRecorder()
	h.HandleGetLPPosition(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}
	got := decodeJSON[map[string]any](t, rr.Body.Bytes())
	if got["deposit_count"] == nil {
		t.Errorf("expected deposit_count in response, got %+v", got)
	}
	if got["deposit_count"].(float64) != 7 {
		t.Errorf("expected deposit_count=7, got %v", got["deposit_count"])
	}
	if got["shares"] != "1234" {
		t.Errorf("expected shares=\"1234\", got %v", got["shares"])
	}
	if got["usdc_value"] != "5678" {
		t.Errorf("expected usdc_value=\"5678\", got %v", got["usdc_value"])
	}
	if got["yield_earned"] != "90" {
		t.Errorf("expected yield_earned=\"90\", got %v", got["yield_earned"])
	}
}

func TestHandleGetLPPosition_InvalidAddressReturns400(t *testing.T) {
	h := readonlyTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/pool/position/not-a-stellar-address", nil)
	rr := httptest.NewRecorder()
	h.HandleGetLPPosition(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid address, got %d", rr.Code)
	}
}

func TestHandleGetLPPosition_ReadContractErrorReturns500(t *testing.T) {
	h := readonlyTestHandler(t)
	addrKP, _ := keypair.Random()
	h.readContractFn = func(_ context.Context, _ string, _ string, _ string, _ []xdr.ScVal, _ *keypair.Full) (xdr.ScVal, error) {
		return xdr.ScVal{}, errors.New("rpc failure")
	}

	req := withURLParams(httptest.NewRequest(http.MethodGet, "/pool/position/"+addrKP.Address(), nil), map[string]string{"address": addrKP.Address()})
	rr := httptest.NewRecorder()
	h.HandleGetLPPosition(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 when contract read fails, got %d", rr.Code)
	}
}

// ------------------------------------------------------------------
// HandleGetStats
// ------------------------------------------------------------------

func TestHandleGetStats_HappyFirstCallQueriesDB(t *testing.T) {
	h := readonlyTestHandler(t)
	calls := 0
	h.getProtocolStatsFn = func(_ context.Context) (*db.ProtocolStats, error) {
		calls++
		return &db.ProtocolStats{
			TotalUSDCFinanced:  "1000",
			ActiveInvoiceCount: 2,
			TotalInvoices:      5,
		}, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	h.HandleGetStats(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if calls != 1 {
		t.Errorf("expected 1 DB call on first request, got %d", calls)
	}
}

func TestHandleGetStats_SecondCallUsesCache(t *testing.T) {
	h := readonlyTestHandler(t)
	calls := 0
	h.getProtocolStatsFn = func(_ context.Context) (*db.ProtocolStats, error) {
		calls++
		return &db.ProtocolStats{TotalInvoices: 7}, nil
	}

	for i := 0; i < 3; i++ {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/stats", nil)
		h.HandleGetStats(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("iter %d: expected 200, got %d", i, rr.Code)
		}
	}
	if calls != 1 {
		t.Errorf("expected DB to be called exactly once across 3 requests (cache), got %d", calls)
	}
}

func TestHandleGetStats_DBErrorReturns500(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getProtocolStatsFn = func(_ context.Context) (*db.ProtocolStats, error) {
		return nil, errors.New("stats query failed")
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	h.HandleGetStats(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 on db error, got %d", rr.Code)
	}
}

func TestHandleGetPoolSnapshots_EmptyHistory(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getPoolSnapshotsFn = func(_ context.Context, _ int) ([]*db.DbPoolSnapshotHistory, error) {
		return []*db.DbPoolSnapshotHistory{}, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/snapshots", nil)
	h.HandleGetPoolSnapshots(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var result []map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty array, got %d items", len(result))
	}
}

func TestHandleGetPoolSnapshots_ReturnsCamelCaseShape(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getPoolSnapshotsFn = func(_ context.Context, _ int) ([]*db.DbPoolSnapshotHistory, error) {
		return []*db.DbPoolSnapshotHistory{
			{RecordedAt: 1748000000, UtilizationRateBps: 7500, TotalYieldDistributed: "15000000000000"},
			{RecordedAt: 1747000000, UtilizationRateBps: 5000, TotalYieldDistributed: "10000000000000"},
		}, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/snapshots", nil)
	h.HandleGetPoolSnapshots(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var result []map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(result))
	}

	first := result[0]
	if _, ok := first["timestamp"]; !ok {
		t.Error("missing timestamp field")
	}
	if _, ok := first["utilizationRateBps"]; !ok {
		t.Error("missing utilizationRateBps field")
	}
	if _, ok := first["totalYieldDistributed"]; !ok {
		t.Error("missing totalYieldDistributed field")
	}

	if got := first["timestamp"].(float64); got != 1748000000 {
		t.Errorf("timestamp: got %v, want 1748000000", got)
	}
	if got := first["utilizationRateBps"].(float64); got != 7500 {
		t.Errorf("utilizationRateBps: got %v, want 7500", got)
	}
	if got := first["totalYieldDistributed"].(string); got != "15000000000000" {
		t.Errorf("totalYieldDistributed: got %v, want 15000000000000", got)
	}
}

func TestHandleGetPoolSnapshots_LimitParameter(t *testing.T) {
	h := readonlyTestHandler(t)
	var gotLimit int
	h.getPoolSnapshotsFn = func(_ context.Context, limit int) ([]*db.DbPoolSnapshotHistory, error) {
		gotLimit = limit
		return []*db.DbPoolSnapshotHistory{}, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/snapshots", nil)
	h.HandleGetPoolSnapshots(rr, req)
	if gotLimit != 100 {
		t.Errorf("default limit: got %d, want 100", gotLimit)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/pool/snapshots?limit=50", nil)
	h.HandleGetPoolSnapshots(rr, req)
	if gotLimit != 50 {
		t.Errorf("custom limit: got %d, want 50", gotLimit)
	}
}

func TestHandleGetPoolSnapshots_DBErrorReturns500(t *testing.T) {
	h := readonlyTestHandler(t)
	h.getPoolSnapshotsFn = func(_ context.Context, _ int) ([]*db.DbPoolSnapshotHistory, error) {
		return nil, errors.New("snapshot query failed")
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/pool/snapshots", nil)
	h.HandleGetPoolSnapshots(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 on db error, got %d", rr.Code)
	}
}
