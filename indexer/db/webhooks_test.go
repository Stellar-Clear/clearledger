package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func skipIfNoDBWebhooks(t *testing.T) {
	t.Helper()
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping DB integration test")
	}
}

func TestWebhookSubscriptionCRUD(t *testing.T) {
	skipIfNoDBWebhooks(t)

	ctx := context.Background()

	// Create
	sub := &WebhookSubscription{
		TargetURL:     "https://example.com/webhook",
		EventTypes:    []string{"invoice.created", "invoice.funded", "invoice.repaid"},
		SigningSecret: "test-secret-123",
		Active:        true,
	}
	if err := CreateWebhookSubscription(ctx, sub); err != nil {
		t.Fatalf("CreateWebhookSubscription: %v", err)
	}
	if sub.ID == uuid.Nil {
		t.Fatal("CreateWebhookSubscription: ID not set")
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_subscriptions WHERE id = $1", sub.ID)
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_deliveries WHERE subscription_id = $1", sub.ID)
		}
	})

	// Get by ID
	got, err := GetWebhookSubscriptionByID(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GetWebhookSubscriptionByID: %v", err)
	}
	if got == nil {
		t.Fatal("GetWebhookSubscriptionByID: returned nil")
	}
	if got.TargetURL != sub.TargetURL {
		t.Errorf("TargetURL: got %q, want %q", got.TargetURL, sub.TargetURL)
	}
	if len(got.EventTypes) != len(sub.EventTypes) {
		t.Errorf("EventTypes length: got %d, want %d", len(got.EventTypes), len(sub.EventTypes))
	}
	for i, et := range sub.EventTypes {
		if got.EventTypes[i] != et {
			t.Errorf("EventTypes[%d]: got %q, want %q", i, got.EventTypes[i], et)
		}
	}
	if got.SigningSecret != sub.SigningSecret {
		t.Errorf("SigningSecret mismatch")
	}
	if !got.Active {
		t.Error("Active: got false, want true")
	}

	// List all
	all, err := ListAllWebhookSubscriptions(ctx)
	if err != nil {
		t.Fatalf("ListAllWebhookSubscriptions: %v", err)
	}
	found := false
	for _, s := range all {
		if s.ID == sub.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("ListAllWebhookSubscriptions: created subscription not found")
	}

	// List by event type
	for _, et := range sub.EventTypes {
		subs, err := ListActiveWebhookSubscriptionsForEvent(ctx, et)
		if err != nil {
			t.Fatalf("ListActiveWebhookSubscriptionsForEvent(%s): %v", et, err)
		}
		found := false
		for _, s := range subs {
			if s.ID == sub.ID {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("ListActiveWebhookSubscriptionsForEvent(%s): subscription not found", et)
		}
	}

	// Update
	sub.TargetURL = "https://updated.example.com/webhook"
	sub.EventTypes = []string{"invoice.created", "invoice.defaulted"}
	sub.Active = false
	if err := UpdateWebhookSubscription(ctx, sub); err != nil {
		t.Fatalf("UpdateWebhookSubscription: %v", err)
	}

	got, err = GetWebhookSubscriptionByID(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GetWebhookSubscriptionByID after update: %v", err)
	}
	if got.TargetURL != "https://updated.example.com/webhook" {
		t.Errorf("TargetURL after update: got %q, want %q", got.TargetURL, "https://updated.example.com/webhook")
	}
	if len(got.EventTypes) != 2 || got.EventTypes[0] != "invoice.created" || got.EventTypes[1] != "invoice.defaulted" {
		t.Errorf("EventTypes after update: got %v, want [invoice.created invoice.defaulted]", got.EventTypes)
	}
	if got.Active {
		t.Error("Active after update: got true, want false")
	}

	// Disable
	sub.Active = true
	if err := UpdateWebhookSubscription(ctx, sub); err != nil {
		t.Fatalf("Re-enable: %v", err)
	}
	if err := DisableWebhookSubscription(ctx, sub.ID); err != nil {
		t.Fatalf("DisableWebhookSubscription: %v", err)
	}
	got, err = GetWebhookSubscriptionByID(ctx, sub.ID)
	if err != nil {
		t.Fatalf("Get after disable: %v", err)
	}
	if got.Active {
		t.Error("Active after disable: got true, want false")
	}

	// List by event type should not return disabled subscription
	subs, err := ListActiveWebhookSubscriptionsForEvent(ctx, "invoice.created")
	if err != nil {
		t.Fatalf("List after disable: %v", err)
	}
	for _, s := range subs {
		if s.ID == sub.ID {
			t.Error("Disabled subscription returned in ListActiveWebhookSubscriptionsForEvent")
		}
	}

	// Delete
	if err := DeleteWebhookSubscription(ctx, sub.ID); err != nil {
		t.Fatalf("DeleteWebhookSubscription: %v", err)
	}
	got, err = GetWebhookSubscriptionByID(ctx, sub.ID)
	if err != nil {
		t.Fatalf("Get after delete: %v", err)
	}
	if got != nil {
		t.Error("DeleteWebhookSubscription: expected nil, got subscription")
	}
}

func TestWebhookDeliveryLifecycle(t *testing.T) {
	skipIfNoDBWebhooks(t)

	ctx := context.Background()

	// Create a subscription first
	sub := &WebhookSubscription{
		TargetURL:     "https://example.com/webhook",
		EventTypes:    []string{"invoice.created"},
		SigningSecret: "test-secret-123",
		Active:        true,
	}
	if err := CreateWebhookSubscription(ctx, sub); err != nil {
		t.Fatalf("CreateWebhookSubscription: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_subscriptions WHERE id = $1", sub.ID)
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_deliveries WHERE subscription_id = $1", sub.ID)
		}
	})

	// Create delivery
	payload := json.RawMessage(`{"test": "data"}`)
	eventType := "invoice.created"
	eventID := "evt_test_123"
	if err := CreateWebhookDelivery(ctx, Pool, sub.ID, eventType, eventID, payload); err != nil {
		t.Fatalf("CreateWebhookDelivery: %v", err)
	}

	// Get pending deliveries
	deliveries, err := GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("GetPendingDeliveries: expected 1, got %d", len(deliveries))
	}
	d := deliveries[0]
	if d.SubscriptionID != sub.ID {
		t.Errorf("SubscriptionID: got %v, want %v", d.SubscriptionID, sub.ID)
	}
	if d.EventType != eventType {
		t.Errorf("EventType: got %q, want %q", d.EventType, eventType)
	}
	if d.EventID != eventID {
		t.Errorf("EventID: got %q, want %q", d.EventID, eventID)
	}
	if string(d.Payload) != string(payload) {
		t.Errorf("Payload mismatch")
	}
	if d.Attempts != 0 {
		t.Errorf("Attempts: got %d, want 0", d.Attempts)
	}
	if d.MaxAttempts != 5 {
		t.Errorf("MaxAttempts: got %d, want 5", d.MaxAttempts)
	}
	if d.Status != "pending" {
		t.Errorf("Status: got %q, want pending", d.Status)
	}
	if d.EndpointURL != sub.TargetURL {
		t.Errorf("EndpointURL: got %q, want %q", d.EndpointURL, sub.TargetURL)
	}
	if d.EndpointSecret != sub.SigningSecret {
		t.Errorf("EndpointSecret mismatch")
	}

	// Mark success
	if err := MarkDeliverySuccess(ctx, d.ID, 200, "OK"); err != nil {
		t.Fatalf("MarkDeliverySuccess: %v", err)
	}
	deliveries, err = GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries after success: %v", err)
	}
	if len(deliveries) != 0 {
		t.Errorf("GetPendingDeliveries after success: expected 0, got %d", len(deliveries))
	}

	// Create another delivery for retry test
	if err := CreateWebhookDelivery(ctx, Pool, sub.ID, eventType, eventID+"_2", payload); err != nil {
		t.Fatalf("CreateWebhookDelivery 2: %v", err)
	}
	deliveries, err = GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries 2: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("Expected 1 pending delivery, got %d", len(deliveries))
	}
	d2 := deliveries[0]

	// Mark retry
	nextAt := time.Now().Add(10 * time.Second)
	statusCode := 500
	if err := MarkDeliveryRetry(ctx, d2.ID, nextAt, &statusCode, "internal server error"); err != nil {
		t.Fatalf("MarkDeliveryRetry: %v", err)
	}
	// Delivery is still pending but scheduled for future, so not returned by GetPendingDeliveries
	// Verify by querying directly
	var attempts int
	var statusStr string
	err = Pool.QueryRow(ctx, "SELECT attempts, status FROM webhook_deliveries WHERE id = $1", d2.ID).Scan(&attempts, &statusStr)
	if err != nil {
		t.Fatalf("Query delivery after retry: %v", err)
	}
	if attempts != 1 {
		t.Errorf("Attempts after retry: got %d, want 1", attempts)
	}
	if statusStr != "pending" {
		t.Errorf("Status after retry: got %q, want pending", statusStr)
	}
	// GetPendingDeliveries should not return it since next_attempt_at is in the future
	deliveries, err = GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries after retry: %v", err)
	}
	if len(deliveries) != 0 {
		t.Errorf("Expected 0 pending deliveries (next_attempt_at in future), got %d", len(deliveries))
	}

	// Create another for dead letter test
	if err := CreateWebhookDelivery(ctx, Pool, sub.ID, eventType, eventID+"_3", payload); err != nil {
		t.Fatalf("CreateWebhookDelivery 3: %v", err)
	}
	deliveries, err = GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries 3: %v", err)
	}
	d3 := deliveries[0]

	// Simulate max attempts reached by setting attempts to maxAttempts-1
	_, err = Pool.Exec(ctx, "UPDATE webhook_deliveries SET attempts = $1 WHERE id = $2", 4, d3.ID)
	if err != nil {
		t.Fatalf("Setup max attempts: %v", err)
	}

	// Mark retry again should dead letter (attempt 5 >= maxAttempts 5)
	if err := MarkDeliveryRetry(ctx, d3.ID, time.Now().Add(10*time.Second), nil, "max retries"); err != nil {
		t.Fatalf("MarkDeliveryRetry for dead letter: %v", err)
	}
	deliveries, err = GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries after dead letter: %v", err)
	}
	if len(deliveries) != 0 {
		t.Errorf("Expected 0 pending after dead letter, got %d", len(deliveries))
	}

	// Verify dead letter status by querying directly
	var status string
	err = Pool.QueryRow(ctx, "SELECT status FROM webhook_deliveries WHERE id = $1", d3.ID).Scan(&status)
	if err != nil {
		t.Fatalf("Check dead letter status: %v", err)
	}
	if status != "dead_letter" {
		t.Errorf("Dead letter status: got %q, want dead_letter", status)
	}
}

func TestWebhookSubscriptionEventTypesIndex(t *testing.T) {
	skipIfNoDBWebhooks(t)

	ctx := context.Background()

	// Create multiple subscriptions with different event types
	subs := []*WebhookSubscription{
		{TargetURL: "https://a.com", EventTypes: []string{"invoice.created", "invoice.funded"}, SigningSecret: "s1", Active: true},
		{TargetURL: "https://b.com", EventTypes: []string{"invoice.funded", "invoice.repaid"}, SigningSecret: "s2", Active: true},
		{TargetURL: "https://c.com", EventTypes: []string{"pool.deposit"}, SigningSecret: "s3", Active: true},
		{TargetURL: "https://d.com", EventTypes: []string{"invoice.created"}, SigningSecret: "s4", Active: false}, // inactive
	}
	for _, sub := range subs {
		if err := CreateWebhookSubscription(ctx, sub); err != nil {
			t.Fatalf("Create subscription: %v", err)
		}
		defer func(id uuid.UUID) {
			if Pool != nil {
				_, _ = Pool.Exec(ctx, "DELETE FROM webhook_subscriptions WHERE id = $1", id)
				_, _ = Pool.Exec(ctx, "DELETE FROM webhook_deliveries WHERE subscription_id = $1", id)
			}
		}(sub.ID)
	}

	// Test invoice.created - should get subs 0 and 3 (but 3 is inactive)
	createdSubs, err := ListActiveWebhookSubscriptionsForEvent(ctx, "invoice.created")
	if err != nil {
		t.Fatalf("List for invoice.created: %v", err)
	}
	if len(createdSubs) != 1 {
		t.Errorf("invoice.created: expected 1 active sub, got %d", len(createdSubs))
	}
	if createdSubs[0].TargetURL != "https://a.com" {
		t.Errorf("invoice.created: got %q, want https://a.com", createdSubs[0].TargetURL)
	}

	// Test invoice.funded - should get subs 0 and 1
	fundedSubs, err := ListActiveWebhookSubscriptionsForEvent(ctx, "invoice.funded")
	if err != nil {
		t.Fatalf("List for invoice.funded: %v", err)
	}
	if len(fundedSubs) != 2 {
		t.Errorf("invoice.funded: expected 2 active subs, got %d", len(fundedSubs))
	}

	// Test pool.deposit - should get sub 2
	depositSubs, err := ListActiveWebhookSubscriptionsForEvent(ctx, "pool.deposit")
	if err != nil {
		t.Fatalf("List for pool.deposit: %v", err)
	}
	if len(depositSubs) != 1 {
		t.Errorf("pool.deposit: expected 1 active sub, got %d", len(depositSubs))
	}
	if depositSubs[0].TargetURL != "https://c.com" {
		t.Errorf("pool.deposit: got %q, want https://c.com", depositSubs[0].TargetURL)
	}

	// Test non-existent event type
	noneSubs, err := ListActiveWebhookSubscriptionsForEvent(ctx, "nonexistent.event")
	if err != nil {
		t.Fatalf("List for nonexistent: %v", err)
	}
	if len(noneSubs) != 0 {
		t.Errorf("nonexistent: expected 0, got %d", len(noneSubs))
	}
}

func TestWebhookDeliveryPendingFilter(t *testing.T) {
	skipIfNoDBWebhooks(t)

	ctx := context.Background()

	sub := &WebhookSubscription{
		TargetURL:     "https://example.com/webhook",
		EventTypes:    []string{"invoice.created"},
		SigningSecret: "test-secret",
		Active:        true,
	}
	if err := CreateWebhookSubscription(ctx, sub); err != nil {
		t.Fatalf("CreateWebhookSubscription: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_subscriptions WHERE id = $1", sub.ID)
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_deliveries WHERE subscription_id = $1", sub.ID)
		}
	})

	// Delivery with next_attempt_at in future - should not appear in pending
	futurePayload := json.RawMessage(`{"future": true}`)
	if err := CreateWebhookDelivery(ctx, Pool, sub.ID, "invoice.created", "evt_future", futurePayload); err != nil {
		t.Fatalf("Create future delivery: %v", err)
	}
	// Manually update next_attempt_at to future
	_, err := Pool.Exec(ctx, "UPDATE webhook_deliveries SET next_attempt_at = $1 WHERE event_id = $2", time.Now().Add(1*time.Hour), "evt_future")
	if err != nil {
		t.Fatalf("Update future delivery time: %v", err)
	}

	// Delivery with next_attempt_at in past - should appear
	pastPayload := json.RawMessage(`{"past": true}`)
	if err := CreateWebhookDelivery(ctx, Pool, sub.ID, "invoice.created", "evt_past", pastPayload); err != nil {
		t.Fatalf("Create past delivery: %v", err)
	}
	_, err = Pool.Exec(ctx, "UPDATE webhook_deliveries SET next_attempt_at = $1 WHERE event_id = $2", time.Now().Add(-1*time.Hour), "evt_past")
	if err != nil {
		t.Fatalf("Update past delivery time: %v", err)
	}

	// Delivery with non-pending status - should not appear
	donePayload := json.RawMessage(`{"done": true}`)
	if err := CreateWebhookDelivery(ctx, Pool, sub.ID, "invoice.created", "evt_done", donePayload); err != nil {
		t.Fatalf("Create done delivery: %v", err)
	}
	_, err = Pool.Exec(ctx, "UPDATE webhook_deliveries SET status = 'delivered' WHERE event_id = $1", "evt_done")
	if err != nil {
		t.Fatalf("Update done delivery status: %v", err)
	}

	// Delivery for inactive subscription - should not appear
	inactiveSub := &WebhookSubscription{
		TargetURL:     "https://inactive.com/webhook",
		EventTypes:    []string{"invoice.created"},
		SigningSecret: "inactive-secret",
		Active:        false,
	}
	if err := CreateWebhookSubscription(ctx, inactiveSub); err != nil {
		t.Fatalf("Create inactive subscription: %v", err)
	}
	if err := CreateWebhookDelivery(ctx, Pool, inactiveSub.ID, "invoice.created", "evt_inactive", json.RawMessage(`{}`)); err != nil {
		t.Fatalf("Create inactive delivery: %v", err)
	}

	// Get pending - should only get the past delivery
	deliveries, err := GetPendingDeliveries(ctx, 10)
	if err != nil {
		t.Fatalf("GetPendingDeliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Errorf("GetPendingDeliveries: expected 1 (past), got %d", len(deliveries))
	}
	if deliveries[0].EventID != "evt_past" {
		t.Errorf("Got wrong delivery: %s", deliveries[0].EventID)
	}
}

func ExampleCreateWebhookSubscription() {
	ctx := context.Background()
	sub := &WebhookSubscription{
		TargetURL:     "https://myapp.com/webhooks/clearledger",
		EventTypes:    []string{"invoice.created", "invoice.funded", "invoice.repaid", "pool.deposit"},
		SigningSecret: "whsec_abcdef123456",
		Active:        true,
	}
	if err := CreateWebhookSubscription(ctx, sub); err != nil {
		_, _ = fmt.Printf("Error: %v\n", err)
		return
	}
	_, _ = fmt.Printf("Created subscription: %s\n", sub.ID)
}

func TestRotateWebhookSigningSecret(t *testing.T) {
	skipIfNoDBWebhooks(t)

	ctx := context.Background()
	sub := &WebhookSubscription{
		TargetURL:     "https://example.com/webhook-rotation",
		EventTypes:    []string{"invoice.created"},
		SigningSecret: "old-secret",
		Active:        true,
	}
	if err := CreateWebhookSubscription(ctx, sub); err != nil {
		t.Fatalf("CreateWebhookSubscription: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_deliveries WHERE subscription_id = $1", sub.ID)
			_, _ = Pool.Exec(ctx, "DELETE FROM webhook_subscriptions WHERE id = $1", sub.ID)
		}
	})

	rotated, err := RotateWebhookSigningSecret(ctx, sub.ID, "", "new-secret", time.Hour)
	if err != nil {
		t.Fatalf("RotateWebhookSigningSecret: %v", err)
	}
	if rotated.SigningSecret != "new-secret" {
		t.Errorf("active secret = %q, want new-secret", rotated.SigningSecret)
	}
	if rotated.PreviousSigningSecret != "old-secret" {
		t.Errorf("previous secret = %q, want old-secret", rotated.PreviousSigningSecret)
	}
	if rotated.PreviousSigningSecretExpiresAt == nil || !rotated.PreviousSigningSecretExpiresAt.After(time.Now()) {
		t.Errorf("previous expiry = %v, want a future timestamp", rotated.PreviousSigningSecretExpiresAt)
	}

	// A second rotation while the previous key is still valid would discard a
	// key the subscriber may still be using.
	if _, err := RotateWebhookSigningSecret(ctx, sub.ID, "", "third-secret", time.Hour); !errors.Is(err, ErrWebhookRotationInProgress) {
		t.Errorf("second rotation error = %v, want ErrWebhookRotationInProgress", err)
	}

	// The API scopes rotations to the authenticated owner.
	if _, err := RotateWebhookSigningSecret(ctx, sub.ID, "GNOTTHEOWNER", "third-secret", time.Hour); !errors.Is(err, ErrWebhookSubscriptionNotFound) {
		t.Errorf("owner mismatch error = %v, want ErrWebhookSubscriptionNotFound", err)
	}

	// Once the overlap expires, rotating again promotes the key that was
	// active during the previous window and keeps "new-secret" as previous.
	if _, err := Pool.Exec(ctx,
		"UPDATE webhook_subscriptions SET previous_signing_secret_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
		sub.ID,
	); err != nil {
		t.Fatalf("expire overlap: %v", err)
	}
	rotated, err = RotateWebhookSigningSecret(ctx, sub.ID, "", "third-secret", time.Hour)
	if err != nil {
		t.Fatalf("rotation after expiry: %v", err)
	}
	if rotated.SigningSecret != "third-secret" || rotated.PreviousSigningSecret != "new-secret" {
		t.Errorf("rotation after expiry = (active %q, previous %q), want (third-secret, new-secret)",
			rotated.SigningSecret, rotated.PreviousSigningSecret)
	}
}
