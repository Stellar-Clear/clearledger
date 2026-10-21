package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

// readAttemptState reads the persisted retry state in one query so the
// assertions do not depend on column ordering or on the claiming scan.
func readAttemptState(t *testing.T, ctx context.Context, deliveryID int64) (attemptCount, attempts int, status string, terminal *string, lastError *string, nextAttemptAt time.Time) {
	t.Helper()
	if err := Pool.QueryRow(ctx, `
		SELECT attempt_count, attempts, status, terminal_status, last_error, next_attempt_at
		FROM webhook_deliveries WHERE id = $1`, deliveryID,
	).Scan(&attemptCount, &attempts, &status, &terminal, &lastError, &nextAttemptAt); err != nil {
		t.Fatalf("read delivery attempt state: %v", err)
	}
	return
}

// TestDeliverySuccessIsTerminal: a 2xx ends the lifecycle. The counter records
// the successful attempt once, terminal_status is delivered, and neither a
// duplicate success nor a retry can put the row back in the queue.
func TestDeliverySuccessIsTerminal(t *testing.T) {
	skipIfNoDB(t)
	ctx := context.Background()

	sub := newClaimTestSubscription(t, ctx, "attempt-success")
	queued := queueClaimTestDeliveries(t, ctx, sub, "attempt-success", 1)

	claimed, err := GetPendingDeliveries(ctx, 50)
	if err != nil {
		t.Fatalf("GetPendingDeliveries: %v", err)
	}
	mine := filterMine(claimed, sub.ID)
	if len(mine) != 1 || mine[0].ID != queued[0] {
		t.Fatalf("claim: got %v, want delivery %d", deliveryIDs(mine), queued[0])
	}

	if err := MarkDeliverySuccess(ctx, queued[0], 204, "ok"); err != nil {
		t.Fatalf("MarkDeliverySuccess: %v", err)
	}

	count, legacy, status, terminal, lastError, _ := readAttemptState(t, ctx, queued[0])
	if count != 1 || legacy != 1 {
		t.Errorf("attempt counters: got attempt_count=%d attempts=%d, want 1/1", count, legacy)
	}
	if status != "delivered" {
		t.Errorf("status: got %q, want delivered", status)
	}
	if terminal == nil || *terminal != "delivered" {
		t.Errorf("terminal_status: got %v, want delivered", terminal)
	}
	if lastError != nil {
		t.Errorf("last_error after success: got %q, want NULL", *lastError)
	}

	// Idempotent success and a late failure must not change terminal state.
	if err := MarkDeliverySuccess(ctx, queued[0], 204, "ok again"); err != nil {
		t.Fatalf("duplicate MarkDeliverySuccess: %v", err)
	}
	code := 500
	if err := MarkDeliveryRetry(ctx, queued[0], time.Now().Add(time.Second), &code, "late failure"); err != nil {
		t.Fatalf("MarkDeliveryRetry after success: %v", err)
	}
	count, legacy, status, terminal, _, _ = readAttemptState(t, ctx, queued[0])
	if count != 1 || legacy != 1 {
		t.Errorf("duplicate outcome incremented attempts: got %d/%d, want 1/1", count, legacy)
	}
	if status != "delivered" || terminal == nil || *terminal != "delivered" {
		t.Errorf("terminal state changed after duplicate outcome: status=%q terminal=%v", status, terminal)
	}

	again, err := GetPendingDeliveries(ctx, 50)
	if err != nil {
		t.Fatalf("GetPendingDeliveries after success: %v", err)
	}
	if got := filterMine(again, sub.ID); len(got) != 0 {
		t.Errorf("delivered row was reclaimed for retry: %v", deliveryIDs(got))
	}
}

// TestDeliveryRetryIncrementsAndSchedules: a failed attempt increments both
// counters, records a sanitized diagnostic, keeps the row pending, and makes it
// claimable only once the scheduled time arrives.
func TestDeliveryRetryIncrementsAndSchedules(t *testing.T) {
	skipIfNoDB(t)
	ctx := context.Background()

	sub := newClaimTestSubscription(t, ctx, "attempt-retry")
	queued := queueClaimTestDeliveries(t, ctx, sub, "attempt-retry", 1)

	claimed, err := GetPendingDeliveries(ctx, 50)
	if err != nil {
		t.Fatalf("GetPendingDeliveries: %v", err)
	}
	if mine := filterMine(claimed, sub.ID); len(mine) != 1 {
		t.Fatalf("claim: got %d of this test's rows, want 1", len(mine))
	}

	nextAt := time.Now().Add(20 * time.Second).Truncate(time.Second)
	code := 503
	// The worker sanitizes with the endpoint URL and signing secret; the DB
	// helper independently strips bare URLs as a second line of defense.
	rawError := "non-2xx response: 503 from " + sub.TargetURL + "?api_key=super-secret"
	if err := MarkDeliveryRetryIfAttempt(ctx, queued[0], 0, nextAt, &code, rawError); err != nil {
		t.Fatalf("MarkDeliveryRetryIfAttempt: %v", err)
	}

	count, legacy, status, terminal, lastError, scheduled := readAttemptState(t, ctx, queued[0])
	if count != 1 || legacy != 1 {
		t.Errorf("attempt counters: got attempt_count=%d attempts=%d, want 1/1", count, legacy)
	}
	if status != "pending" {
		t.Errorf("status: got %q, want pending", status)
	}
	if terminal != nil {
		t.Errorf("terminal_status: got %q, want NULL", *terminal)
	}
	if lastError == nil {
		t.Fatal("last_error not persisted")
	}
	if strings.Contains(*lastError, "super-secret") || strings.Contains(*lastError, sub.SigningSecret) {
		t.Errorf("last_error leaked credentials: %q", *lastError)
	}
	if diff := scheduled.Sub(nextAt); diff < -2*time.Second || diff > 2*time.Second {
		t.Errorf("next_attempt_at: got %v, want about %v", scheduled, nextAt)
	}

	// The retry is not due yet.
	again, err := GetPendingDeliveries(ctx, 50)
	if err != nil {
		t.Fatalf("GetPendingDeliveries before retry is due: %v", err)
	}
	if got := filterMine(again, sub.ID); len(got) != 0 {
		t.Errorf("retry claimed before next_attempt_at: %v", deliveryIDs(got))
	}

	// Make it due; the reclaimed row must carry the persisted attempt count.
	if _, err := Pool.Exec(ctx, "UPDATE webhook_deliveries SET next_attempt_at = CURRENT_TIMESTAMP - interval '1 second' WHERE id = $1", queued[0]); err != nil {
		t.Fatalf("make retry due: %v", err)
	}
	due, err := GetPendingDeliveries(ctx, 50)
	if err != nil {
		t.Fatalf("GetPendingDeliveries when due: %v", err)
	}
	mine := filterMine(due, sub.ID)
	if len(mine) != 1 {
		t.Fatalf("reclaimed %d rows, want 1", len(mine))
	}
	if mine[0].AttemptCount != 1 || mine[0].Attempts != 1 {
		t.Errorf("reclaimed attempt counters: got %d/%d, want 1/1", mine[0].AttemptCount, mine[0].Attempts)
	}

	// A stale duplicate outcome for attempt 0 must not increment again.
	if err := MarkDeliveryRetryIfAttempt(ctx, queued[0], 0, time.Now().Add(time.Minute), &code, "duplicate"); err != nil {
		t.Fatalf("duplicate retry: %v", err)
	}
	count, _, _, _, _, _ = readAttemptState(t, ctx, queued[0])
	if count != 1 {
		t.Errorf("duplicate retry changed attempt_count to %d, want 1", count)
	}
}

// TestDeliveryExhaustionIsTerminal: reaching max_attempts records the terminal
// attempt and dead-letters the row so it can never be claimed again.
func TestDeliveryExhaustionIsTerminal(t *testing.T) {
	skipIfNoDB(t)
	ctx := context.Background()

	t.Run("retry helper at the boundary", func(t *testing.T) {
		sub := newClaimTestSubscription(t, ctx, "attempt-exhaust")
		queued := queueClaimTestDeliveries(t, ctx, sub, "attempt-exhaust", 1)
		if _, err := Pool.Exec(ctx,
			"UPDATE webhook_deliveries SET max_attempts = 2, attempts = 1 WHERE id = $1", queued[0],
		); err != nil {
			t.Fatalf("set near-exhausted state: %v", err)
		}

		code := 500
		if err := MarkDeliveryRetryIfAttempt(ctx, queued[0], 1, time.Now().Add(time.Minute), &code, "still failing"); err != nil {
			t.Fatalf("MarkDeliveryRetryIfAttempt: %v", err)
		}
		count, legacy, status, terminal, _, _ := readAttemptState(t, ctx, queued[0])
		if count != 2 || legacy != 2 {
			t.Errorf("attempt counters: got %d/%d, want 2/2", count, legacy)
		}
		if status != "dead_letter" || terminal == nil || *terminal != "dead_letter" {
			t.Errorf("terminal state: status=%q terminal=%v, want dead_letter", status, terminal)
		}
	})

	t.Run("explicit dead letter", func(t *testing.T) {
		sub := newClaimTestSubscription(t, ctx, "attempt-dead")
		queued := queueClaimTestDeliveries(t, ctx, sub, "attempt-dead", 1)
		if _, err := Pool.Exec(ctx,
			"UPDATE webhook_deliveries SET max_attempts = 3, attempts = 2 WHERE id = $1", queued[0],
		); err != nil {
			t.Fatalf("set near-exhausted state: %v", err)
		}

		if err := MarkDeliveryDeadLetterIfAttempt(ctx, queued[0], 2, "exhausted"); err != nil {
			t.Fatalf("MarkDeliveryDeadLetterIfAttempt: %v", err)
		}
		count, legacy, status, terminal, lastError, _ := readAttemptState(t, ctx, queued[0])
		if count != 3 || legacy != 3 {
			t.Errorf("attempt counters: got %d/%d, want 3/3", count, legacy)
		}
		if status != "dead_letter" || terminal == nil || *terminal != "dead_letter" {
			t.Errorf("terminal state: status=%q terminal=%v, want dead_letter", status, terminal)
		}
		if lastError == nil || *lastError != "exhausted" {
			t.Errorf("last_error: got %v, want exhausted", lastError)
		}

		// Idempotent: a duplicate terminal write is a no-op.
		if err := MarkDeliveryDeadLetterIfAttempt(ctx, queued[0], 2, "duplicate"); err != nil {
			t.Fatalf("duplicate dead letter: %v", err)
		}
		count, _, _, _, lastError, _ = readAttemptState(t, ctx, queued[0])
		if count != 3 {
			t.Errorf("duplicate dead letter incremented attempt_count to %d, want 3", count)
		}
		if lastError == nil || *lastError != "exhausted" {
			t.Errorf("duplicate dead letter rewrote last_error: got %v", lastError)
		}

		again, err := GetPendingDeliveries(ctx, 50)
		if err != nil {
			t.Fatalf("GetPendingDeliveries: %v", err)
		}
		if got := filterMine(again, sub.ID); len(got) != 0 {
			t.Errorf("dead-lettered row was reclaimed: %v", deliveryIDs(got))
		}
	})
}

// TestDeliveryRestartRecovery: claiming is not an attempt. If a worker dies
// after claiming, the expired lock makes the row claimable again with the
// persisted attempt count unchanged.
func TestDeliveryRestartRecovery(t *testing.T) {
	skipIfNoDB(t)
	ctx := context.Background()

	sub := newClaimTestSubscription(t, ctx, "attempt-restart")
	queued := queueClaimTestDeliveries(t, ctx, sub, "attempt-restart", 1)

	first, err := ClaimPendingDeliveries(ctx, 50, time.Minute)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if mine := filterMine(first, sub.ID); len(mine) != 1 {
		t.Fatalf("first claim: got %d of this test's rows, want 1", len(mine))
	}

	if _, err := Pool.Exec(ctx,
		"UPDATE webhook_deliveries SET locked_until = CURRENT_TIMESTAMP - interval '1 second' WHERE id = $1",
		queued[0],
	); err != nil {
		t.Fatalf("expire claim: %v", err)
	}

	recovered, err := ClaimPendingDeliveries(ctx, 50, time.Minute)
	if err != nil {
		t.Fatalf("claim after restart: %v", err)
	}
	mine := filterMine(recovered, sub.ID)
	if len(mine) != 1 {
		t.Fatalf("recovered %d rows, want 1", len(mine))
	}
	if mine[0].AttemptCount != 0 || mine[0].Attempts != 0 {
		t.Errorf("claiming counted as an attempt: got %d/%d, want 0/0", mine[0].AttemptCount, mine[0].Attempts)
	}

	// Recording the interrupted attempt afterwards schedules exactly one retry.
	code := 500
	if err := MarkDeliveryRetryIfAttempt(ctx, queued[0], 0, time.Now().Add(time.Minute), &code, "worker restarted"); err != nil {
		t.Fatalf("MarkDeliveryRetryIfAttempt: %v", err)
	}
	count, _, status, _, _, _ := readAttemptState(t, ctx, queued[0])
	if count != 1 || status != "pending" {
		t.Errorf("state after interrupted attempt: attempt_count=%d status=%q, want 1/pending", count, status)
	}
}
