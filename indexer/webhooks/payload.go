package webhooks

import (
	"encoding/json"
	"time"
)

// SchemaVersion is the current webhook payload schema version.
const SchemaVersion = "1.0"

// EventType represents the set of supported webhook event types.
type EventType string

const (
	// Invoice lifecycle events
	EventInvoiceCreated   EventType = "invoice.created"
	EventInvoiceFunded    EventType = "invoice.funded"
	EventInvoiceRepaid    EventType = "invoice.repaid"
	EventInvoiceDefaulted EventType = "invoice.defaulted"
	EventInvoiceListed    EventType = "invoice.listed"
	EventInvoiceShipped   EventType = "invoice.shipped"
	EventInvoiceConfirmed EventType = "invoice.confirmed"

	// Pool events
	EventPoolDeposit          EventType = "pool.deposit"
	EventPoolWithdrawal       EventType = "pool.withdrawal"
	EventPoolYieldDistributed EventType = "pool.yield_distributed"
)

// AllEventTypes returns the complete list of supported event types.
func AllEventTypes() []EventType {
	return []EventType{
		EventInvoiceCreated,
		EventInvoiceFunded,
		EventInvoiceRepaid,
		EventInvoiceDefaulted,
		EventInvoiceListed,
		EventInvoiceShipped,
		EventInvoiceConfirmed,
		EventPoolDeposit,
		EventPoolWithdrawal,
		EventPoolYieldDistributed,
	}
}

// WebhookEnvelope is the top-level payload delivered to subscribers.
type WebhookEnvelope struct {
	SchemaVersion string `json:"schema_version"`
	// EventSchemaVersion is the contract event payload version the listener
	// decoded (the schema_version above versions the webhook envelope itself).
	EventSchemaVersion int             `json:"event_schema_version,omitempty"`
	EventType          EventType       `json:"event_type"`
	EventID            string          `json:"event_id"`
	OccurredAt         time.Time       `json:"occurred_at"`
	Ledger             uint32          `json:"ledger"`
	ContractID         string          `json:"contract_id"`
	Data               json.RawMessage `json:"data"`
}

// InvoiceEventData is the payload for invoice lifecycle events.
type InvoiceEventData struct {
	InvoiceID        string `json:"invoice_id"`
	Issuer           string `json:"issuer"`
	Buyer            string `json:"buyer"`
	FaceValue        string `json:"face_value"`
	DiscountBps      int    `json:"discount_bps,omitempty"`
	FundedAmount     string `json:"funded_amount,omitempty"`
	DueDate          int64  `json:"due_date"`
	Status           string `json:"status"`
	CreatedAt        int64  `json:"created_at,omitempty"`
	FundedAt         *int64 `json:"funded_at,omitempty"`
	ShippedAt        *int64 `json:"shipped_at,omitempty"`
	BuyerConfirmedAt *int64 `json:"buyer_confirmed_at,omitempty"`
	RepaidAt         *int64 `json:"repaid_at,omitempty"`
}

// PoolEventData is the payload for pool events.
type PoolEventData struct {
	Account     string `json:"account"`
	Amount      string `json:"amount"`
	Shares      string `json:"shares,omitempty"`
	NewBalance  string `json:"new_balance,omitempty"`
	YieldAmount string `json:"yield_amount,omitempty"`
	TotalShares string `json:"total_shares,omitempty"`
}

// NewInvoiceCreatedPayload creates a WebhookEnvelope for invoice.created events.
func NewInvoiceCreatedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceCreated, eventID, contractID, ledger, occurredAt, data)
}

// NewInvoiceFundedPayload creates a WebhookEnvelope for invoice.funded events.
func NewInvoiceFundedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceFunded, eventID, contractID, ledger, occurredAt, data)
}

// NewInvoiceRepaidPayload creates a WebhookEnvelope for invoice.repaid events.
func NewInvoiceRepaidPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceRepaid, eventID, contractID, ledger, occurredAt, data)
}

// NewInvoiceDefaultedPayload creates a WebhookEnvelope for invoice.defaulted events.
func NewInvoiceDefaultedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceDefaulted, eventID, contractID, ledger, occurredAt, data)
}

// NewInvoiceListedPayload creates a WebhookEnvelope for invoice.listed events.
func NewInvoiceListedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceListed, eventID, contractID, ledger, occurredAt, data)
}

// NewInvoiceShippedPayload creates a WebhookEnvelope for invoice.shipped events.
func NewInvoiceShippedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceShipped, eventID, contractID, ledger, occurredAt, data)
}

// NewInvoiceConfirmedPayload creates a WebhookEnvelope for invoice.confirmed events.
func NewInvoiceConfirmedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data InvoiceEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventInvoiceConfirmed, eventID, contractID, ledger, occurredAt, data)
}

// NewPoolDepositPayload creates a WebhookEnvelope for pool.deposit events.
func NewPoolDepositPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data PoolEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventPoolDeposit, eventID, contractID, ledger, occurredAt, data)
}

// NewPoolWithdrawalPayload creates a WebhookEnvelope for pool.withdrawal events.
func NewPoolWithdrawalPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data PoolEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventPoolWithdrawal, eventID, contractID, ledger, occurredAt, data)
}

// NewPoolYieldDistributedPayload creates a WebhookEnvelope for pool.yield_distributed events.
func NewPoolYieldDistributedPayload(eventID, contractID string, ledger uint32, occurredAt time.Time, data PoolEventData) (*WebhookEnvelope, error) {
	return newEnvelope(EventPoolYieldDistributed, eventID, contractID, ledger, occurredAt, data)
}

func newEnvelope[T any](eventType EventType, eventID, contractID string, ledger uint32, occurredAt time.Time, data T) (*WebhookEnvelope, error) {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return &WebhookEnvelope{
		SchemaVersion: SchemaVersion,
		EventType:     eventType,
		EventID:       eventID,
		OccurredAt:    occurredAt,
		Ledger:        ledger,
		ContractID:    contractID,
		Data:          dataBytes,
	}, nil
}

// MarshalJSON implements custom JSON marshaling for WebhookEnvelope.
func (e *WebhookEnvelope) MarshalJSON() ([]byte, error) {
	type Alias WebhookEnvelope
	return json.Marshal(&struct {
		*Alias
		OccurredAt string `json:"occurred_at"`
	}{
		Alias:      (*Alias)(e),
		OccurredAt: e.OccurredAt.UTC().Format(time.RFC3339),
	})
}

// UnmarshalJSON implements custom JSON unmarshaling for WebhookEnvelope.
func (e *WebhookEnvelope) UnmarshalJSON(data []byte) error {
	type Alias WebhookEnvelope
	aux := &struct {
		*Alias
		OccurredAt string `json:"occurred_at"`
	}{
		Alias: (*Alias)(e),
	}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	var err error
	e.OccurredAt, err = time.Parse(time.RFC3339, aux.OccurredAt)
	return err
}

// ExampleInvoiceCreatedPayload returns an example invoice.created payload for documentation.
func ExampleInvoiceCreatedPayload() string {
	data := InvoiceEventData{
		InvoiceID: "INV1234567890abcdef",
		Issuer:    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
		Buyer:     "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
		FaceValue: "1000000000",
		DueDate:   1735689600,
		Status:    "Created",
		CreatedAt: 1735516800,
	}
	env, _ := NewInvoiceCreatedPayload(
		"evt_abc123",
		"CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C",
		1234567,
		time.Unix(1735516800, 0),
		data,
	)
	jsonBytes, _ := json.MarshalIndent(env, "", "  ")
	return string(jsonBytes)
}

// ExamplePoolDepositPayload returns an example pool.deposit payload for documentation.
func ExamplePoolDepositPayload() string {
	data := PoolEventData{
		Account:     "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
		Amount:      "5000000000",
		Shares:      "5000000000",
		NewBalance:  "10000000000",
		TotalShares: "10000000000",
	}
	env, _ := NewPoolDepositPayload(
		"evt_def456",
		"CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C",
		1234568,
		time.Unix(1735516900, 0),
		data,
	)
	jsonBytes, _ := json.MarshalIndent(env, "", "  ")
	return string(jsonBytes)
}
