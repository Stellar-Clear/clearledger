// Package webhook is the enqueue half of the webhook pipeline: the event
// listener hands it contract events and it writes one webhook_deliveries row
// per active subscription, in the same transaction as the event's own state
// change. Delivery — signing, HTTP, retries, backoff and dead-lettering — is
// owned by package webhooks (plural), whose DeliveryWorker polls the rows this
// package writes.
//
// The split keeps exactly one copy of each side's logic: this package never
// learns about retry policy and the worker never learns about envelope
// construction, so a bug fix in one cannot silently drift out of sync with the
// other (issue #879).
package webhook

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"clearledger/indexer/db"
	"clearledger/indexer/webhooks"
)

// Dispatcher converts listener events into webhook payload envelopes and
// enqueues one delivery row per matching subscription. It deliberately holds
// no HTTP client or retry state: webhooks.DeliveryWorker sends whatever has
// been queued here.
type Dispatcher struct{}

func NewDispatcher() *Dispatcher {
	return &Dispatcher{}
}

// Dispatch enqueues a delivery for every active subscription matching eventType.
// It constructs the full webhook envelope (with schema_version, event_id, etc.)
// and writes delivery rows to the database. Non-blocking: failures are logged,
// not returned. Use EnqueueDeliveries when the delivery rows must be written
// atomically with an event's state change.
func (d *Dispatcher) Dispatch(ctx context.Context, eventType string, data map[string]interface{}) {
	if err := d.EnqueueDeliveries(ctx, db.Pool, eventType, data); err != nil {
		slog.Error("webhook: enqueue deliveries failed", "event_type", eventType, "error", err)
	}
}

// EnqueueDeliveries writes one webhook_deliveries row per active subscription
// matching eventType, executing every insert through q. Callers pass db.Pool
// for standalone fan-out, or a pgx.Tx when the rows must commit (or roll back)
// together with the event's state change and events_log row. It returns the
// first error instead of swallowing it so a transactional caller can roll back.
func (d *Dispatcher) EnqueueDeliveries(ctx context.Context, q db.Querier, eventType string, data map[string]interface{}) error {
	subs, err := db.ListActiveWebhookSubscriptionsForEvent(ctx, eventType)
	if err != nil {
		return fmt.Errorf("webhook: list subscriptions: %w", err)
	}
	if len(subs) == 0 {
		return nil
	}

	envelope, err := BuildEnvelope(eventType, data)
	if err != nil {
		return fmt.Errorf("webhook: build envelope: %w", err)
	}
	envelopeBytes, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("webhook: marshal envelope: %w", err)
	}

	for _, sub := range subs {
		if err := db.CreateWebhookDelivery(ctx, q, sub.ID, string(envelope.EventType), envelope.EventID, envelopeBytes); err != nil {
			return fmt.Errorf("webhook: create delivery for subscription %s: %w", sub.ID, err)
		}
	}
	return nil
}

// BuildEnvelope converts the listener's internal event name and its dispatch
// data into the public webhook envelope. Keeping it separate from Dispatch lets
// the field mapping be tested without a database.
func BuildEnvelope(eventType string, data map[string]interface{}) (*webhooks.WebhookEnvelope, error) {
	// Build the envelope data payload
	eventID := ""
	if v, ok := data["event_id"].(string); ok {
		eventID = v
	}
	if eventID == "" {
		eventID = fmt.Sprintf("evt_%d", time.Now().UnixNano())
	}

	contractID := ""
	if v, ok := data["contract_id"].(string); ok {
		contractID = v
	}

	ledger := uint32(0)
	if v, ok := data["ledger"]; ok {
		switch val := v.(type) {
		case int:
			ledger = uint32(val)
		case int32:
			ledger = uint32(val)
		case uint32:
			ledger = val
		case float64:
			ledger = uint32(val)
		}
	}

	// occurred_at is the ledger close time the listener passed in. Wall-clock
	// time is only a fallback for events dispatched without a close time, so
	// historical events re-indexed later keep their original timestamp.
	occurredAt := time.Now()
	if v, ok := data["ledger_closed_at"].(int64); ok {
		occurredAt = time.Unix(v, 0)
	} else if v, ok := data["occurred_at"].(time.Time); ok {
		occurredAt = v
	}

	// The listener records which contract-event schema version produced this
	// data. It is distinct from the webhook envelope's schema_version.
	eventSchemaVersion := getInt(data, "event_schema_version")

	// Map the internal event type to the public webhook event type
	publicEventType := mapInternalEventType(eventType)

	// Build the appropriate data payload based on event type
	var envelope *webhooks.WebhookEnvelope
	switch publicEventType {
	case webhooks.EventInvoiceCreated, webhooks.EventInvoiceFunded, webhooks.EventInvoiceRepaid,
		webhooks.EventInvoiceDefaulted, webhooks.EventInvoiceListed, webhooks.EventInvoiceShipped,
		webhooks.EventInvoiceConfirmed:
		invoiceData := webhooks.InvoiceEventData{
			InvoiceID:        getString(data, "invoice_id"),
			Issuer:           getString(data, "issuer"),
			Buyer:            getString(data, "buyer"),
			FaceValue:        getString(data, "face_value"),
			DiscountBps:      getInt(data, "discount_bps"),
			FundedAmount:     getString(data, "funded_amount"),
			DueDate:          getInt64(data, "due_date"),
			Status:           getString(data, "status"),
			CreatedAt:        getInt64(data, "created_at"),
			FundedAt:         getInt64Ptr(data, "funded_at"),
			ShippedAt:        getInt64Ptr(data, "shipped_at"),
			BuyerConfirmedAt: getInt64Ptr(data, "buyer_confirmed_at"),
			RepaidAt:         getInt64Ptr(data, "repaid_at"),
		}
		var err error
		switch publicEventType {
		case webhooks.EventInvoiceCreated:
			envelope, err = webhooks.NewInvoiceCreatedPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		case webhooks.EventInvoiceFunded:
			envelope, err = webhooks.NewInvoiceFundedPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		case webhooks.EventInvoiceRepaid:
			envelope, err = webhooks.NewInvoiceRepaidPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		case webhooks.EventInvoiceDefaulted:
			envelope, err = webhooks.NewInvoiceDefaultedPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		case webhooks.EventInvoiceListed:
			envelope, err = webhooks.NewInvoiceListedPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		case webhooks.EventInvoiceShipped:
			envelope, err = webhooks.NewInvoiceShippedPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		case webhooks.EventInvoiceConfirmed:
			envelope, err = webhooks.NewInvoiceConfirmedPayload(eventID, contractID, ledger, occurredAt, invoiceData)
		}
		if err != nil {
			return nil, fmt.Errorf("build invoice envelope: %w", err)
		}
	case webhooks.EventPoolDeposit, webhooks.EventPoolWithdrawal, webhooks.EventPoolYieldDistributed:
		poolData := webhooks.PoolEventData{
			Account:     getString(data, "account"),
			Amount:      getString(data, "amount"),
			Shares:      getString(data, "shares"),
			NewBalance:  getString(data, "new_balance"),
			YieldAmount: getString(data, "yield_amount"),
			TotalShares: getString(data, "total_shares"),
		}
		var err error
		switch publicEventType {
		case webhooks.EventPoolDeposit:
			envelope, err = webhooks.NewPoolDepositPayload(eventID, contractID, ledger, occurredAt, poolData)
		case webhooks.EventPoolWithdrawal:
			envelope, err = webhooks.NewPoolWithdrawalPayload(eventID, contractID, ledger, occurredAt, poolData)
		case webhooks.EventPoolYieldDistributed:
			envelope, err = webhooks.NewPoolYieldDistributedPayload(eventID, contractID, ledger, occurredAt, poolData)
		}
		if err != nil {
			return nil, fmt.Errorf("build pool envelope: %w", err)
		}
	default:
		// Fallback for unknown event types - use generic payload
		payloadBytes, err := json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("marshal generic payload: %w", err)
		}
		envelope = &webhooks.WebhookEnvelope{
			SchemaVersion: webhooks.SchemaVersion,
			EventType:     publicEventType,
			EventID:       eventID,
			OccurredAt:    occurredAt,
			Ledger:        ledger,
			ContractID:    contractID,
			Data:          payloadBytes,
		}
	}

	envelope.EventSchemaVersion = eventSchemaVersion
	return envelope, nil
}

// mapInternalEventType maps internal event names to public webhook event types.
func mapInternalEventType(internal string) webhooks.EventType {
	switch internal {
	case "create", "InvoiceCreated":
		return webhooks.EventInvoiceCreated
	case "list_for_financing", "InvoiceListed":
		return webhooks.EventInvoiceListed
	case "fund_invoice", "InvoiceFunded":
		return webhooks.EventInvoiceFunded
	case "mark_shipped", "InvoiceShipped":
		return webhooks.EventInvoiceShipped
	case "confirm_delivery", "DeliveryConfirmed":
		return webhooks.EventInvoiceConfirmed
	case "repay", "InvoiceRepaid":
		return webhooks.EventInvoiceRepaid
	case "trigger_default", "InvoiceDefaulted":
		return webhooks.EventInvoiceDefaulted
	case "deposit", "PoolDeposit", "lp_deposited":
		return webhooks.EventPoolDeposit
	case "withdraw", "PoolWithdrawal", "lp_withdrawn":
		return webhooks.EventPoolWithdrawal
	case "yield_distribution", "PoolYieldDistributed", "receive_repayment", "repayment_received":
		return webhooks.EventPoolYieldDistributed
	default:
		return webhooks.EventType(internal)
	}
}

func getString(data map[string]interface{}, key string) string {
	if v, ok := data[key].(string); ok {
		return v
	}
	return ""
}

func getInt(data map[string]interface{}, key string) int {
	if v, ok := data[key].(int); ok {
		return v
	}
	if v, ok := data[key].(float64); ok {
		return int(v)
	}
	return 0
}

func getInt64(data map[string]interface{}, key string) int64 {
	if v, ok := data[key].(int64); ok {
		return v
	}
	if v, ok := data[key].(float64); ok {
		return int64(v)
	}
	if v, ok := data[key].(int); ok {
		return int64(v)
	}
	return 0
}

func getInt64Ptr(data map[string]interface{}, key string) *int64 {
	// The listener passes nullable invoice columns straight from the DB row,
	// so the pointer case is the common one.
	if v, ok := data[key].(*int64); ok {
		return v
	}
	if v, ok := data[key].(int64); ok {
		return &v
	}
	if v, ok := data[key].(float64); ok {
		val := int64(v)
		return &val
	}
	if v, ok := data[key].(int); ok {
		val := int64(v)
		return &val
	}
	return nil
}
