package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"clearledger/indexer/db"

	"github.com/stellar/go-stellar-sdk/xdr"
)

const (
	testIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
	testBuyer  = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
)

func testInvoiceID(t *testing.T) []byte {
	t.Helper()
	return []byte(fmt.Sprintf("%032x", time.Now().UnixNano()))
}

func testInvoiceIDTopic(t *testing.T) string {
	t.Helper()
	id := xdr.ScBytes(testInvoiceID(t))
	return encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvBytes, Bytes: &id})
}

func testU32Value(v uint32) string {
	val := xdr.Uint32(v)
	return encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvU32, U32: &val})
}

func testAddressTopic(t *testing.T, address string) string {
	t.Helper()
	return encodeScVal(makeAccountAddressScVal(address))
}

func testU128Value(v uint64) string {
	parts := xdr.UInt128Parts{Lo: xdr.Uint64(v)}
	return encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvU128, U128: &parts})
}

func testVersionedMap(t *testing.T, version uint32, payload xdr.ScVal) string {
	t.Helper()
	versionKey := xdr.ScSymbol("version")
	dataKey := xdr.ScSymbol("data")
	versionVal := xdr.Uint32(version)
	entries := xdr.ScMap{
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &versionKey}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU32, U32: &versionVal}},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &dataKey}, Val: payload},
	}
	inner := &entries
	return encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvMap, Map: &inner})
}

func invoiceCreatedPayloadScVal(t *testing.T) xdr.ScVal {
	t.Helper()
	id := xdr.ScBytes(testInvoiceID(t))
	face := xdr.UInt128Parts{Lo: xdr.Uint64(1_000_000_000)}
	due := xdr.Uint64(uint64(time.Now().Add(24 * time.Hour).Unix()))
	keys := []xdr.ScSymbol{"id", "issuer", "buyer", "face_value", "due_date"}
	entries := xdr.ScMap{
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &keys[0]}, Val: xdr.ScVal{Type: xdr.ScValTypeScvBytes, Bytes: &id}},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &keys[1]}, Val: makeAccountAddressScVal(testIssuer)},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &keys[2]}, Val: makeAccountAddressScVal(testBuyer)},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &keys[3]}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU128, U128: &face}},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &keys[4]}, Val: xdr.ScVal{Type: xdr.ScValTypeScvU64, U64: &due}},
	}
	inner := &entries
	return xdr.ScVal{Type: xdr.ScValTypeScvMap, Map: &inner}
}

func knownVersionEvents(t *testing.T) map[string]SorobanEvent {
	t.Helper()
	idTopic := testInvoiceIDTopic(t)
	events := map[string]SorobanEvent{
		"InvoiceCreated": {
			Topic: []string{encodeSymbol("InvoiceCreated")},
			Value: encodeScVal(invoiceCreatedPayloadScVal(t)),
		},
		"InvoiceListed": {
			Topic: []string{encodeSymbol("list_for_financing"), idTopic},
			Value: testU32Value(500),
		},
		"InvoiceFunded": {
			Topic: []string{encodeSymbol("fund_invoice"), idTopic},
			Value: testU128Value(1_000_000_000),
		},
		"InvoiceShipped": {
			Topic: []string{encodeSymbol("mark_shipped"), idTopic},
			Value: encodeSymbol("mark_shipped"),
		},
		"DeliveryConfirmed": {
			Topic: []string{encodeSymbol("confirm_delivery"), idTopic},
			Value: encodeSymbol("confirm_delivery"),
		},
		"InvoiceRepaid": {
			Topic: []string{encodeSymbol("repay"), idTopic},
			Value: encodeSymbol("repay"),
		},
		"InvoiceDefaulted": {
			Topic: []string{encodeSymbol("trigger_default"), idTopic},
			Value: encodeSymbol("trigger_default"),
		},
		"AttestationSubmitted": {
			Topic: []string{encodeSymbol("submit_attestation"), idTopic, encodeSymbol("agent_underwrite")},
			Value: testU32Value(2500),
		},
		"IssuerRegistered": {
			Topic: []string{encodeSymbol("issuer_registered"), testAddressTopic(t, testIssuer)},
			Value: encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvVoid}),
		},
		"BuyerRegistered": {
			Topic: []string{encodeSymbol("buyer_registered"), testAddressTopic(t, testBuyer)},
			Value: encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvVoid}),
		},
		"PoolDeposit": {
			Topic: []string{encodeSymbol("lp_deposited"), testAddressTopic(t, testIssuer)},
			Value: makeU128PairValue(2_500_000_000, 2_495_000_000),
		},
		"PoolWithdrawal": {
			Topic: []string{encodeSymbol("lp_withdrawn"), testAddressTopic(t, testIssuer)},
			Value: makeU128PairValue(750_000_000, 748_000_000),
		},
		"PoolYieldDistributed": {
			Topic: []string{encodeSymbol("repayment_received"), idTopic},
			Value: makeU128PairValue(1_050_000_000, 35_000_000),
		},
		"PoolDefault": {
			Topic: []string{encodeSymbol("handle_default"), idTopic},
			Value: testU128Value(100_000_000),
		},
	}
	for name, ev := range events {
		ev.ID = "event-" + name
		ev.ContractID = "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS"
		ev.Ledger = 1000
		ev.LedgerClosedAt = time.Now().Format(time.RFC3339)
		events[name] = ev
	}
	return events
}

func TestDecodeTypedEvent_AllKnownV1Events(t *testing.T) {
	for name, event := range knownVersionEvents(t) {
		t.Run(name, func(t *testing.T) {
			resolved, err := ResolveEvent(event)
			if err != nil {
				t.Fatalf("ResolveEvent: %v", err)
			}
			if resolved.Version != EventSchemaVersionV1 {
				t.Fatalf("version: got %d, want %d", resolved.Version, EventSchemaVersionV1)
			}
			typed, err := DecodeTypedEvent(resolved)
			if err != nil {
				t.Fatalf("DecodeTypedEvent: %v", err)
			}
			if typed == nil {
				t.Fatal("DecodeTypedEvent returned nil payload")
			}
		})
	}
}

func TestResolveEvent_VersionedEnvelopeV1(t *testing.T) {
	event := SorobanEvent{
		ID:             "event-versioned-envelope",
		ContractID:     "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS",
		Ledger:         1000,
		LedgerClosedAt: time.Now().Format(time.RFC3339),
		Topic:          []string{encodeSymbol("InvoiceCreated")},
		Value:          testVersionedMap(t, 1, invoiceCreatedPayloadScVal(t)),
	}

	resolved, err := ResolveEvent(event)
	if err != nil {
		t.Fatalf("ResolveEvent: %v", err)
	}
	if resolved.Version != 1 {
		t.Fatalf("version: got %d, want 1", resolved.Version)
	}
	if _, err := DecodeTypedEvent(resolved); err != nil {
		t.Fatalf("DecodeTypedEvent: %v", err)
	}
}

func TestResolveEvent_VersionFromTopicSuffix(t *testing.T) {
	event := SorobanEvent{
		Topic: []string{encodeSymbol("InvoiceCreated:v1")},
		Value: encodeScVal(invoiceCreatedPayloadScVal(t)),
	}
	resolved, err := ResolveEvent(event)
	if err != nil {
		t.Fatalf("ResolveEvent: %v", err)
	}
	if resolved.Name != "InvoiceCreated" {
		t.Fatalf("name: got %q, want InvoiceCreated", resolved.Name)
	}
	if resolved.Version != 1 {
		t.Fatalf("version: got %d, want 1", resolved.Version)
	}
	if _, err := DecodeTypedEvent(resolved); err != nil {
		t.Fatalf("DecodeTypedEvent: %v", err)
	}
}

func TestResolveEvent_UnknownVersionValue(t *testing.T) {
	event := SorobanEvent{
		Topic: []string{encodeSymbol("InvoiceCreated")},
		Value: testVersionedMap(t, 2, invoiceCreatedPayloadScVal(t)),
	}
	resolved, err := ResolveEvent(event)
	if resolved == nil {
		t.Fatal("ResolveEvent returned nil resolved event")
	}
	var decodeErr *EventDecodeError
	if !errorsAs(err, &decodeErr) {
		t.Fatalf("ResolveEvent error: got %v, want EventDecodeError", err)
	}
	if decodeErr.Status != db.DecodeStatusUnknownVersion {
		t.Fatalf("status: got %q, want %q", decodeErr.Status, db.DecodeStatusUnknownVersion)
	}
	if resolved.Version != 2 {
		t.Fatalf("version: got %d, want 2", resolved.Version)
	}
}

func TestDecodeTypedEvent_MalformedKnownPayload(t *testing.T) {
	// InvoiceCreated without an id: v1 is known, so this is a malformed known
	// payload rather than an unknown version.
	issuerKey := xdr.ScSymbol("issuer")
	buyerKey := xdr.ScSymbol("buyer")
	entries := xdr.ScMap{
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &issuerKey}, Val: makeAccountAddressScVal(testIssuer)},
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &buyerKey}, Val: makeAccountAddressScVal(testBuyer)},
	}
	inner := &entries
	event := SorobanEvent{
		Topic: []string{encodeSymbol("InvoiceCreated")},
		Value: encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvMap, Map: &inner}),
	}

	resolved, err := ResolveEvent(event)
	if err != nil {
		t.Fatalf("ResolveEvent: %v", err)
	}
	_, err = DecodeTypedEvent(resolved)
	var decodeErr *EventDecodeError
	if !errorsAs(err, &decodeErr) {
		t.Fatalf("DecodeTypedEvent error: got %v, want EventDecodeError", err)
	}
	if decodeErr.Status != db.DecodeStatusMalformed {
		t.Fatalf("status: got %q, want %q", decodeErr.Status, db.DecodeStatusMalformed)
	}
}

// errorsAs is a tiny indirection so this test file does not need to import
// errors solely for one call.
func errorsAs(err error, target **EventDecodeError) bool {
	for err != nil {
		if typed, ok := err.(*EventDecodeError); ok {
			*target = typed
			return true
		}
		unwrapper, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = unwrapper.Unwrap()
	}
	return false
}

func TestHandleEvent_RetainsUnknownVersion(t *testing.T) {
	skipIfNoDB(t)

	l := newTestListener()
	rec := &recordingDispatcher{}
	l.dispatcher = rec
	ctx := context.Background()

	eventID := fmt.Sprintf("event-unknown-version-%d", time.Now().UnixNano())
	event := SorobanEvent{
		ID:             eventID,
		ContractID:     "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS",
		TxHash:         "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
		Ledger:         4321,
		LedgerClosedAt: time.Now().Format(time.RFC3339),
		Topic:          []string{encodeSymbol("InvoiceCreated")},
		Value:          testVersionedMap(t, 2, invoiceCreatedPayloadScVal(t)),
	}
	t.Cleanup(func() {
		if db.Pool != nil {
			_, _ = db.Pool.Exec(ctx, "DELETE FROM events_log WHERE event_id = $1", eventID)
		}
	})

	if err := l.handleEvent(ctx, event); err != nil {
		t.Fatalf("handleEvent(unknown version): %v", err)
	}
	if rec.calls != 0 {
		t.Fatalf("dispatcher calls: got %d, want 0 for an undecoded event", rec.calls)
	}

	retained, err := db.GetUnknownVersionEvents(ctx, 1000)
	if err != nil {
		t.Fatalf("GetUnknownVersionEvents: %v", err)
	}
	var got *db.EventLog
	for _, ev := range retained {
		if ev.EventID == eventID {
			got = ev
			break
		}
	}
	if got == nil {
		t.Fatal("unknown-version event was not retained")
	}
	if got.SchemaVersion != 2 {
		t.Errorf("schema_version: got %d, want 2", got.SchemaVersion)
	}
	if got.DecodeStatus != db.DecodeStatusUnknownVersion {
		t.Errorf("decode_status: got %q, want %q", got.DecodeStatus, db.DecodeStatusUnknownVersion)
	}
	if got.ContractID != event.ContractID {
		t.Errorf("contract_id: got %q, want %q", got.ContractID, event.ContractID)
	}
	if got.TxHash == nil || *got.TxHash != event.TxHash {
		t.Errorf("tx_hash: got %v, want %q", got.TxHash, event.TxHash)
	}
	if got.Ledger != event.Ledger {
		t.Errorf("ledger: got %d, want %d", got.Ledger, event.Ledger)
	}

	var raw retainedRawEvent
	if err := json.Unmarshal(got.RawEvent, &raw); err != nil {
		t.Fatalf("unmarshal raw_event: %v", err)
	}
	if raw.Value != event.Value {
		t.Error("raw_event.value does not match the original payload")
	}
	if len(raw.Topics) != len(event.Topic) || raw.Topics[0] != event.Topic[0] {
		t.Errorf("raw_event.topics: got %v, want %v", raw.Topics, event.Topic)
	}
	if raw.TxHash != event.TxHash || raw.Ledger != event.Ledger {
		t.Error("raw_event lost contract/transaction/ledger metadata")
	}

	undecoded, err := db.GetUndecodedEvents(ctx, 1000)
	if err != nil {
		t.Fatalf("GetUndecodedEvents: %v", err)
	}
	found := false
	for _, ev := range undecoded {
		if ev.EventID == eventID {
			found = true
		}
	}
	if !found {
		t.Error("unknown-version event missing from GetUndecodedEvents")
	}
}

func TestHandleEvent_RetainsMalformedKnownPayload(t *testing.T) {
	skipIfNoDB(t)

	l := newTestListener()
	ctx := context.Background()

	eventID := fmt.Sprintf("event-malformed-known-%d", time.Now().UnixNano())
	// Missing the id field: v1 is known, so the payload is malformed.
	entries := xdr.ScMap{
		{Key: xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: symbolPtr("issuer")}, Val: makeAccountAddressScVal(testIssuer)},
	}
	inner := &entries
	event := SorobanEvent{
		ID:             eventID,
		ContractID:     "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS",
		Ledger:         4322,
		LedgerClosedAt: time.Now().Format(time.RFC3339),
		Topic:          []string{encodeSymbol("InvoiceCreated")},
		Value:          encodeScVal(xdr.ScVal{Type: xdr.ScValTypeScvMap, Map: &inner}),
	}
	t.Cleanup(func() {
		if db.Pool != nil {
			_, _ = db.Pool.Exec(ctx, "DELETE FROM events_log WHERE event_id = $1", eventID)
		}
	})

	if err := l.handleEvent(ctx, event); err == nil {
		t.Fatal("handleEvent(malformed known payload): got nil error, want decode error")
	}

	retained, err := db.GetEventsByDecodeStatus(ctx, db.DecodeStatusMalformed, 1000)
	if err != nil {
		t.Fatalf("GetEventsByDecodeStatus: %v", err)
	}
	var got *db.EventLog
	for _, ev := range retained {
		if ev.EventID == eventID {
			got = ev
			break
		}
	}
	if got == nil {
		t.Fatal("malformed known payload was not retained")
	}
	if got.SchemaVersion != 1 {
		t.Errorf("schema_version: got %d, want 1", got.SchemaVersion)
	}
	if got.DecodeError == nil || *got.DecodeError == "" {
		t.Error("decode_error was not recorded")
	}
	if len(got.RawEvent) == 0 {
		t.Error("raw_event was not recorded")
	}
}

func symbolPtr(s string) *xdr.ScSymbol {
	sym := xdr.ScSymbol(s)
	return &sym
}
