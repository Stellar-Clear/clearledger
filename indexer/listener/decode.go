package listener

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"clearledger/indexer/db"
	"clearledger/indexer/xdrutil"

	"github.com/stellar/go-stellar-sdk/xdr"
)

// Event schema versions understood by the listener. A payload without an
// explicit version is legacy v1: every event the contracts emitted before
// versioning was introduced has the v1 shape.
const (
	EventSchemaVersionV1      = 1
	CurrentEventSchemaVersion = EventSchemaVersionV1
)

// ErrUnhandledEvent is returned for a well-formed event whose name the
// listener does not model. Such events keep their historical behavior: they
// are skipped without writing an events_log row.
var ErrUnhandledEvent = errors.New("listener: unhandled event type")

// EventDecodeError carries the classification the persistence layer needs for
// an event that was not decoded. ResolveEvent returns it together with the
// partial ResolvedEvent it managed to parse so the raw event can still be
// retained.
type EventDecodeError struct {
	Status    string
	Version   int
	EventName string
	Err       error
}

func (e *EventDecodeError) Error() string {
	if e == nil {
		return ""
	}
	msg := e.Err.Error()
	if e.EventName != "" {
		return fmt.Sprintf("event %s (schema version %d): %s", e.EventName, e.Version, msg)
	}
	return fmt.Sprintf("event (schema version %d): %s", e.Version, msg)
}

func (e *EventDecodeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// ResolvedEvent is an event after version detection and payload unwrapping.
// The embedded Event has normalized topics and a Value containing only the
// version's payload, so the existing v1 handlers can consume it unchanged.
type ResolvedEvent struct {
	Name      string
	Canonical string
	Version   int
	Event     SorobanEvent
	Payload   xdr.ScVal
	TopicVals []xdr.ScVal
}

// CanonicalEventName maps every historical and contract-style event name to
// the name used by the version dispatch table.
func CanonicalEventName(name string) (string, bool) {
	switch name {
	case "create", "InvoiceCreated":
		return "InvoiceCreated", true
	case "list_for_financing", "InvoiceListed":
		return "InvoiceListed", true
	case "fund_invoice", "InvoiceFunded":
		return "InvoiceFunded", true
	case "mark_shipped", "InvoiceShipped":
		return "InvoiceShipped", true
	case "confirm_delivery", "DeliveryConfirmed":
		return "DeliveryConfirmed", true
	case "repay", "InvoiceRepaid":
		return "InvoiceRepaid", true
	case "trigger_default", "InvoiceDefaulted":
		return "InvoiceDefaulted", true
	case "submit_attestation", "AttestationSubmitted":
		return "AttestationSubmitted", true
	case "issuer_registered":
		return "IssuerRegistered", true
	case "buyer_registered":
		return "BuyerRegistered", true
	case "deposit", "lp_deposited":
		return "PoolDeposit", true
	case "withdraw", "lp_withdrawn":
		return "PoolWithdrawal", true
	case "receive_repayment", "repayment_received", "yield_distribution":
		return "PoolYieldDistributed", true
	case "handle_default", "invoice_defaulted":
		return "PoolDefault", true
	default:
		return "", false
	}
}

// ResolveEvent parses an event's topic and value XDR, detects its schema
// version, and returns the version's payload. An absent version marker means
// legacy v1. A recognized marker with a version this listener does not know
// is classified as unknown_version; the caller must retain, not apply, it.
func ResolveEvent(event SorobanEvent) (*ResolvedEvent, error) {
	res := &ResolvedEvent{Version: EventSchemaVersionV1}

	if len(event.Topic) == 0 {
		return res, &EventDecodeError{Status: db.DecodeStatusMalformed, Version: res.Version, Err: errors.New("event topic is empty")}
	}

	topicVals := make([]xdr.ScVal, 0, len(event.Topic))
	for i, raw := range event.Topic {
		var val xdr.ScVal
		if err := xdr.SafeUnmarshalBase64(raw, &val); err != nil {
			return res, &EventDecodeError{
				Status:    db.DecodeStatusMalformed,
				Version:   res.Version,
				EventName: res.Name,
				Err:       fmt.Errorf("parse topic %d: %w", i, err),
			}
		}
		topicVals = append(topicVals, val)
	}
	if topicVals[0].Sym == nil {
		return res, &EventDecodeError{Status: db.DecodeStatusMalformed, Version: res.Version, Err: errors.New("first topic is not a symbol")}
	}

	name := string(*topicVals[0].Sym)
	baseName, topicVersion, topicHasVersion := splitEventNameVersion(name)
	res.Name = baseName
	res.Canonical, _ = CanonicalEventName(baseName)
	if topicHasVersion {
		res.Version = topicVersion
	}

	// A version can also be a dedicated topic, either as a bare vN symbol or
	// as a version key followed by an integer. Remove those topics from the
	// normalized event so topic[1] remains the event's first payload topic.
	removeTopics := map[int]bool{}
	if topicHasVersion {
		removeTopics[0] = true
	}
	for i := 1; i < len(topicVals); i++ {
		if removeTopics[i] {
			continue
		}
		ver, ok, consumeNext := versionFromTopicVal(topicVals, i)
		if !ok {
			continue
		}
		if topicHasVersion && ver != res.Version {
			return res, &EventDecodeError{
				Status:    db.DecodeStatusMalformed,
				Version:   res.Version,
				EventName: res.Name,
				Err:       fmt.Errorf("conflicting schema versions: topic name says %d, version topic says %d", res.Version, ver),
			}
		}
		res.Version = ver
		topicHasVersion = true
		removeTopics[i] = true
		if consumeNext {
			removeTopics[i+1] = true
			i++
		}
	}

	// An unknown version is retained verbatim. Do not try to decode its value:
	// a newer version is allowed to use an encoding this build cannot parse.
	if topicHasVersion && res.Version != EventSchemaVersionV1 {
		res.TopicVals = normalizedTopicVals(topicVals, removeTopics, baseName)
		res.Event = event
		res.Event.Topic = normalizedTopics(event.Topic, removeTopics, baseName)
		return res, &EventDecodeError{
			Status:    db.DecodeStatusUnknownVersion,
			Version:   res.Version,
			EventName: res.Name,
			Err:       fmt.Errorf("unsupported event schema version %d", res.Version),
		}
	}

	var value xdr.ScVal
	if err := xdr.SafeUnmarshalBase64(event.Value, &value); err != nil {
		res.TopicVals = normalizedTopicVals(topicVals, removeTopics, baseName)
		res.Event = event
		res.Event.Topic = normalizedTopics(event.Topic, removeTopics, baseName)
		return res, &EventDecodeError{
			Status:    db.DecodeStatusMalformed,
			Version:   res.Version,
			EventName: res.Name,
			Err:       fmt.Errorf("parse value: %w", err),
		}
	}

	payload := value
	valueVersion, valueHasVersion, err := versionFromValue(value)
	if err != nil {
		res.TopicVals = normalizedTopicVals(topicVals, removeTopics, baseName)
		res.Event = event
		res.Event.Topic = normalizedTopics(event.Topic, removeTopics, baseName)
		return res, &EventDecodeError{
			Status:    db.DecodeStatusMalformed,
			Version:   res.Version,
			EventName: res.Name,
			Err:       err,
		}
	}
	if valueHasVersion {
		if topicHasVersion && valueVersion != res.Version {
			res.TopicVals = normalizedTopicVals(topicVals, removeTopics, baseName)
			res.Event = event
			res.Event.Topic = normalizedTopics(event.Topic, removeTopics, baseName)
			return res, &EventDecodeError{
				Status:    db.DecodeStatusMalformed,
				Version:   res.Version,
				EventName: res.Name,
				Err:       fmt.Errorf("conflicting schema versions: topic says %d, value says %d", res.Version, valueVersion),
			}
		}
		res.Version = valueVersion
		if res.Version != EventSchemaVersionV1 {
			res.TopicVals = normalizedTopicVals(topicVals, removeTopics, baseName)
			res.Event = event
			res.Event.Topic = normalizedTopics(event.Topic, removeTopics, baseName)
			return res, &EventDecodeError{
				Status:    db.DecodeStatusUnknownVersion,
				Version:   res.Version,
				EventName: res.Name,
				Err:       fmt.Errorf("unsupported event schema version %d", res.Version),
			}
		}
		payload = unwrapVersionedPayload(value)
	}

	normalized := normalizedTopics(event.Topic, removeTopics, baseName)
	if encoded, err := encodeScValBase64(payload); err == nil {
		event.Value = encoded
	}
	event.Topic = normalized

	res.Payload = payload
	res.TopicVals = normalizedTopicVals(topicVals, removeTopics, baseName)
	res.Event = event
	return res, nil
}

// splitEventNameVersion recognizes the topic-name version suffixes contracts
// can use without changing the payload (InvoiceCreated:v2, InvoiceCreated.v2,
// InvoiceCreated_v2, InvoiceCreated@2, InvoiceCreated/v2).
func splitEventNameVersion(name string) (string, int, bool) {
	for _, sep := range []string{":v", ".v", "_v", "@v", "/v"} {
		idx := strings.LastIndex(strings.ToLower(name), sep)
		if idx <= 0 {
			continue
		}
		version, err := strconv.Atoi(name[idx+2:])
		if err != nil {
			continue
		}
		return name[:idx], version, true
	}
	for _, sep := range []string{"@", "/"} {
		idx := strings.LastIndex(name, sep)
		if idx <= 0 {
			continue
		}
		version, err := strconv.Atoi(name[idx+1:])
		if err != nil {
			continue
		}
		return name[:idx], version, true
	}
	return name, 0, false
}

// versionFromTopicVal recognizes version-only topics. It returns consumeNext
// when the marker is a key (version/schema_version/...) whose value is in the
// following topic.
func versionFromTopicVal(vals []xdr.ScVal, i int) (version int, ok bool, consumeNext bool) {
	text, isText := scValText(vals[i])
	if !isText {
		return 0, false, false
	}
	lower := strings.ToLower(text)
	for _, key := range []string{"version", "schema_version", "event_version", "payload_version"} {
		if lower == key {
			if i+1 < len(vals) {
				if v, ok := scValInt(vals[i+1]); ok {
					return v, true, true
				}
			}
			return 0, false, false
		}
		if strings.HasPrefix(lower, key+"=") || strings.HasPrefix(lower, key+":") {
			if v, err := strconv.Atoi(text[len(key)+1:]); err == nil {
				return v, true, false
			}
			return 0, false, false
		}
	}
	if len(lower) > 1 && lower[0] == 'v' {
		if v, err := strconv.Atoi(lower[1:]); err == nil {
			return v, true, false
		}
	}
	return 0, false, false
}

// versionFromValue looks for an explicit version field in a map payload. Both
// symbol and string keys are accepted because envelopes written by different
// SDKs use both.
func versionFromValue(val xdr.ScVal) (int, bool, error) {
	if val.Type != xdr.ScValTypeScvMap {
		return 0, false, nil
	}
	for _, entry := range mapEntries(val) {
		key, ok := scValText(entry.Key)
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "version", "schema_version", "event_version", "payload_version":
			version, ok := scValInt(entry.Val)
			if !ok {
				return 0, false, fmt.Errorf("schema version field is not an integer")
			}
			return version, true, nil
		}
	}
	return 0, false, nil
}

// unwrapVersionedPayload returns the nested data/payload value when a
// versioned envelope wraps the version's fields; otherwise it returns the
// envelope itself (version plus fields in the same map).
func unwrapVersionedPayload(val xdr.ScVal) xdr.ScVal {
	for _, entry := range mapEntries(val) {
		key, ok := scValText(entry.Key)
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "data", "payload", "event":
			return entry.Val
		}
	}
	return val
}

func mapEntries(val xdr.ScVal) []xdr.ScMapEntry {
	if val.Type != xdr.ScValTypeScvMap || val.Map == nil || *val.Map == nil {
		return nil
	}
	return **val.Map
}

func scValText(val xdr.ScVal) (string, bool) {
	switch val.Type {
	case xdr.ScValTypeScvSymbol:
		if val.Sym != nil {
			return string(*val.Sym), true
		}
	case xdr.ScValTypeScvString:
		if val.Str != nil {
			return string(*val.Str), true
		}
	}
	return "", false
}

func scValInt(val xdr.ScVal) (int, bool) {
	switch val.Type {
	case xdr.ScValTypeScvU32:
		if val.U32 != nil {
			return int(*val.U32), true
		}
	case xdr.ScValTypeScvI32:
		if val.I32 != nil {
			return int(*val.I32), true
		}
	case xdr.ScValTypeScvU64:
		if val.U64 != nil {
			return int(*val.U64), true
		}
	case xdr.ScValTypeScvI64:
		if val.I64 != nil {
			return int(*val.I64), true
		}
	case xdr.ScValTypeScvTimepoint:
		if val.Timepoint != nil {
			return int(*val.Timepoint), true
		}
	case xdr.ScValTypeScvDuration:
		if val.Duration != nil {
			return int(*val.Duration), true
		}
	case xdr.ScValTypeScvSymbol, xdr.ScValTypeScvString:
		if text, ok := scValText(val); ok {
			text = strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(text), "v"), "=")
			if dot := strings.IndexByte(text, '.'); dot > 0 {
				text = text[:dot]
			}
			if v, err := strconv.Atoi(text); err == nil {
				return v, true
			}
		}
	}
	return 0, false
}

func normalizedTopics(raw []string, remove map[int]bool, baseName string) []string {
	out := make([]string, 0, len(raw))
	for i, topic := range raw {
		if i == 0 {
			if encoded, err := encodeSymbolBase64(baseName); err == nil {
				out = append(out, encoded)
				continue
			}
		}
		if remove[i] {
			continue
		}
		out = append(out, topic)
	}
	return out
}

func normalizedTopicVals(raw []xdr.ScVal, remove map[int]bool, baseName string) []xdr.ScVal {
	out := make([]xdr.ScVal, 0, len(raw))
	for i, val := range raw {
		if i == 0 {
			sym := xdr.ScSymbol(baseName)
			out = append(out, xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &sym})
			continue
		}
		if remove[i] {
			continue
		}
		out = append(out, val)
	}
	return out
}

func encodeSymbolBase64(sym string) (string, error) {
	value := xdr.ScSymbol(sym)
	val := xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &value}
	return encodeScValBase64(val)
}

func encodeScValBase64(val xdr.ScVal) (string, error) {
	raw, err := val.MarshalBinary()
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// --- typed v1 decoders ------------------------------------------------------
//
// The decoders below are the explicit version dispatch. decodeTypedEvent only
// runs after ResolveEvent has established the version, so adding a future
// version means adding a new switch arm rather than changing the handlers.
// Each decoder validates the shape before the transaction is opened; the
// handlers then apply the already-normalized payload to the database.

type InvoiceCreatedV1 struct {
	InvoiceID string
	Issuer    string
	Buyer     string
	FaceValue string
	DueDate   int64
}

type InvoiceListedV1 struct {
	InvoiceID   string
	DiscountBps uint32
}

type InvoiceFundedV1 struct {
	InvoiceID    string
	FundedAmount string
}

type InvoiceReferenceV1 struct {
	InvoiceID string
}

type AttestationSubmittedV1 struct {
	InvoiceID    string
	AgentID      string
	RiskScoreBps uint32
}

type RegistrationV1 struct {
	Address string
}

type PoolLPEventV1 struct {
	Account string
	Amount  string
	Shares  string
}

type PoolYieldDistributedV1 struct {
	Amount      string
	YieldAmount string
}

type PoolDefaultV1 struct {
	Amount string
}

// DecodeTypedEvent validates and decodes a resolved event with the decoder
// registered for its canonical name and schema version.
func DecodeTypedEvent(res *ResolvedEvent) (any, error) {
	if res == nil {
		return nil, ErrUnhandledEvent
	}
	canonical, ok := CanonicalEventName(res.Name)
	if !ok {
		return nil, ErrUnhandledEvent
	}
	switch res.Version {
	case EventSchemaVersionV1:
		return decodeV1(canonical, res)
	default:
		return nil, &EventDecodeError{
			Status:    db.DecodeStatusUnknownVersion,
			Version:   res.Version,
			EventName: res.Name,
			Err:       fmt.Errorf("unsupported event schema version %d", res.Version),
		}
	}
}

func decodeV1(canonical string, res *ResolvedEvent) (any, error) {
	switch canonical {
	case "InvoiceCreated":
		return decodeInvoiceCreatedV1(res)
	case "InvoiceListed":
		return decodeInvoiceListedV1(res)
	case "InvoiceFunded":
		return decodeInvoiceFundedV1(res)
	case "InvoiceShipped", "DeliveryConfirmed", "InvoiceRepaid", "InvoiceDefaulted":
		id, err := invoiceIDFromTopic(res)
		if err != nil {
			return nil, err
		}
		return &InvoiceReferenceV1{InvoiceID: id}, nil
	case "AttestationSubmitted":
		id, err := invoiceIDFromTopic(res)
		if err != nil {
			return nil, err
		}
		agentID := ""
		if len(res.TopicVals) >= 3 {
			if text, ok := scValText(res.TopicVals[2]); ok {
				agentID = text
			}
		}
		risk := uint32(0)
		if res.Payload.Type != xdr.ScValTypeScvVoid {
			v, ok := scValInt(res.Payload)
			if !ok {
				return nil, malformedDecode(res, errors.New("attestation risk_score is not an integer"))
			}
			risk = uint32(v)
		}
		return &AttestationSubmittedV1{InvoiceID: id, AgentID: agentID, RiskScoreBps: risk}, nil
	case "IssuerRegistered", "BuyerRegistered":
		if len(res.TopicVals) < 2 {
			return nil, malformedDecode(res, errors.New("registration event is missing its address topic"))
		}
		address := xdrutil.ParseAddress(res.TopicVals[1])
		if address == "" {
			return nil, malformedDecode(res, errors.New("registration topic is not a valid address"))
		}
		return &RegistrationV1{Address: address}, nil
	case "PoolDeposit", "PoolWithdrawal":
		if len(res.TopicVals) < 2 {
			return nil, malformedDecode(res, errors.New("pool LP event is missing its address topic"))
		}
		account := xdrutil.ParseAddress(res.TopicVals[1])
		if account == "" {
			return nil, malformedDecode(res, errors.New("pool LP topic is not a valid address"))
		}
		amount, shares, err := decodeU128Pair(res)
		if err != nil {
			return nil, err
		}
		return &PoolLPEventV1{Account: account, Amount: amount, Shares: shares}, nil
	case "PoolYieldDistributed":
		amount, yieldAmount, err := decodeU128Pair(res)
		if err != nil {
			return nil, err
		}
		return &PoolYieldDistributedV1{Amount: amount, YieldAmount: yieldAmount}, nil
	case "PoolDefault":
		amount, _, err := decodeU128Pair(res)
		if err != nil {
			return nil, err
		}
		return &PoolDefaultV1{Amount: amount}, nil
	default:
		return nil, ErrUnhandledEvent
	}
}

func decodeInvoiceCreatedV1(res *ResolvedEvent) (any, error) {
	if res.Payload.Type != xdr.ScValTypeScvMap {
		return nil, malformedDecode(res, errors.New("InvoiceCreated value is not a map"))
	}
	idVal, ok := xdrutil.GetMapVal(res.Payload, "id")
	if !ok {
		return nil, malformedDecode(res, errors.New("InvoiceCreated is missing id"))
	}
	issuerVal, ok := xdrutil.GetMapVal(res.Payload, "issuer")
	if !ok {
		return nil, malformedDecode(res, errors.New("InvoiceCreated is missing issuer"))
	}
	buyerVal, ok := xdrutil.GetMapVal(res.Payload, "buyer")
	if !ok {
		return nil, malformedDecode(res, errors.New("InvoiceCreated is missing buyer"))
	}
	invoice := &InvoiceCreatedV1{
		InvoiceID: xdrutil.ParseBytes(idVal),
		Issuer:    xdrutil.ParseAddress(issuerVal),
		Buyer:     xdrutil.ParseAddress(buyerVal),
	}
	if invoice.InvoiceID == "" {
		return nil, malformedDecode(res, errors.New("InvoiceCreated id is not bytes"))
	}
	if invoice.Issuer == "" {
		return nil, malformedDecode(res, errors.New("InvoiceCreated issuer is not an address"))
	}
	if invoice.Buyer == "" {
		return nil, malformedDecode(res, errors.New("InvoiceCreated buyer is not an address"))
	}
	if val, ok := xdrutil.GetMapVal(res.Payload, "face_value"); ok {
		invoice.FaceValue = xdrutil.ParseU128(val)
	}
	if val, ok := xdrutil.GetMapVal(res.Payload, "due_date"); ok {
		invoice.DueDate = xdrutil.ParseU64(val)
	}
	return invoice, nil
}

func decodeInvoiceListedV1(res *ResolvedEvent) (any, error) {
	id, err := invoiceIDFromTopic(res)
	if err != nil {
		return nil, err
	}
	if res.Payload.Type != xdr.ScValTypeScvU32 || res.Payload.U32 == nil {
		return nil, malformedDecode(res, errors.New("InvoiceListed discount is not a u32"))
	}
	return &InvoiceListedV1{InvoiceID: id, DiscountBps: uint32(*res.Payload.U32)}, nil
}

func decodeInvoiceFundedV1(res *ResolvedEvent) (any, error) {
	id, err := invoiceIDFromTopic(res)
	if err != nil {
		return nil, err
	}
	if res.Payload.Type != xdr.ScValTypeScvU128 || res.Payload.U128 == nil {
		return nil, malformedDecode(res, errors.New("InvoiceFunded amount is not a u128"))
	}
	return &InvoiceFundedV1{InvoiceID: id, FundedAmount: xdrutil.ParseU128(res.Payload)}, nil
}

func invoiceIDFromTopic(res *ResolvedEvent) (string, error) {
	if len(res.TopicVals) < 2 {
		return "", malformedDecode(res, errors.New("event is missing its invoice_id topic"))
	}
	id := xdrutil.ParseBytes(res.TopicVals[1])
	if id == "" {
		return "", malformedDecode(res, errors.New("invoice_id topic is not bytes"))
	}
	return id, nil
}

func decodeU128Pair(res *ResolvedEvent) (string, string, error) {
	val := res.Payload
	if val.Type == xdr.ScValTypeScvU128 && val.U128 != nil {
		return xdrutil.ParseU128(val), "", nil
	}
	if val.Type != xdr.ScValTypeScvVec || val.Vec == nil || *val.Vec == nil {
		return "", "", malformedDecode(res, errors.New("event value is not a u128 or a u128 tuple"))
	}
	elems := **val.Vec
	if len(elems) == 0 || elems[0].Type != xdr.ScValTypeScvU128 || elems[0].U128 == nil {
		return "", "", malformedDecode(res, errors.New("event tuple does not start with a u128"))
	}
	primary := xdrutil.ParseU128(elems[0])
	secondary := ""
	if len(elems) > 1 {
		if elems[1].Type != xdr.ScValTypeScvU128 || elems[1].U128 == nil {
			return "", "", malformedDecode(res, errors.New("event tuple's second value is not a u128"))
		}
		secondary = xdrutil.ParseU128(elems[1])
	}
	return primary, secondary, nil
}

func malformedDecode(res *ResolvedEvent, err error) error {
	version := EventSchemaVersionV1
	name := ""
	if res != nil {
		version = res.Version
		name = res.Name
	}
	return &EventDecodeError{Status: db.DecodeStatusMalformed, Version: version, EventName: name, Err: err}
}
