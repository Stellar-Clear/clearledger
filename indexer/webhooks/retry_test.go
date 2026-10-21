package webhooks

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"clearledger/indexer/db"
)

func TestBackoffDelayIsBounded(t *testing.T) {
	cases := []struct {
		nextAttempt int
		want        time.Duration
	}{
		{0, backoffBase},
		{1, 20 * time.Second},
		{2, 40 * time.Second},
		{3, 80 * time.Second},
		{4, 160 * time.Second},
		{7, maxBackoff},
		{32, maxBackoff},
		{1000, maxBackoff},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("attempt=%d", tc.nextAttempt), func(t *testing.T) {
			if got := backoffDelay(tc.nextAttempt); got != tc.want {
				t.Errorf("backoffDelay(%d): got %v, want %v", tc.nextAttempt, got, tc.want)
			}
		})
	}
}

// TestEffectiveMaxAttemptsIsBounded stops a malformed row (max_attempts <= 0)
// or an unreasonably large configured ceiling from scheduling retries forever.
func TestEffectiveMaxAttemptsIsBounded(t *testing.T) {
	cases := []struct {
		name     string
		rowMax   int
		fallback int
		want     int
	}{
		{"row value wins", 3, 9, 3},
		{"zero row falls back", 0, 4, 4},
		{"zero row and zero fallback use default", 0, 0, DefaultWorkerConfig().MaxAttempts},
		{"negative row falls back", -1, 6, 6},
		{"oversized row is capped", 1000, 5, db.MaxDeliveryAttempts},
		{"oversized fallback is capped", 0, 1000, db.MaxDeliveryAttempts},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &db.WebhookDelivery{MaxAttempts: tc.rowMax}
			if got := effectiveMaxAttempts(d, tc.fallback); got != tc.want {
				t.Errorf("effectiveMaxAttempts(max=%d, fallback=%d): got %d, want %d",
					tc.rowMax, tc.fallback, got, tc.want)
			}
		})
	}
}

// TestSanitizeDeliveryErrorRedactsTrustBoundary pins the promise that a
// persisted last_error never contains the endpoint URL or signing secret.
func TestSanitizeDeliveryErrorRedactsTrustBoundary(t *testing.T) {
	const (
		endpoint = "https://hooks.example.invalid/deliver?api_key=super-secret"
		secret   = "whsec_do_not_store"
	)
	raw := fmt.Sprintf(`Post %q: dial tcp: secret=%s`, endpoint, secret)

	got := db.SanitizeDeliveryError(raw, endpoint, secret)

	if strings.Contains(got, "super-secret") || strings.Contains(got, "api_key") {
		t.Errorf("last_error leaked URL credentials: %q", got)
	}
	if strings.Contains(got, secret) {
		t.Errorf("last_error leaked signing secret: %q", got)
	}
	if !strings.Contains(got, "dial tcp") {
		t.Errorf("last_error lost the useful diagnostic: %q", got)
	}
}

func TestSanitizeDeliveryErrorStripsBareURLsAndCapsLength(t *testing.T) {
	raw := "request to https://user:pass@example.invalid/hook failed" + strings.Repeat("x", 5000)

	got := db.SanitizeDeliveryError(raw)

	if strings.Contains(got, "user:pass") || strings.Contains(got, "https://") {
		t.Errorf("bare URL survived sanitization: %q", got)
	}
	if len(got) > db.MaxDeliveryErrorLength+len("…") {
		t.Errorf("sanitized error length %d exceeds cap %d", len(got), db.MaxDeliveryErrorLength)
	}
}

// TestFailureReasonIgnoresMalformedResponseBody: a subscriber can return
// arbitrary bytes, including malformed JSON. Only the status code belongs in
// the diagnostic; the body is never part of last_error on failure.
func TestFailureReasonIgnoresMalformedResponseBody(t *testing.T) {
	got := failureReason(502)
	if got != "non-2xx response: 502" {
		t.Errorf("failureReason: got %q", got)
	}
	if strings.Contains(got, "{") || strings.Contains(got, "error") {
		t.Errorf("failureReason included response-body material: %q", got)
	}
}
