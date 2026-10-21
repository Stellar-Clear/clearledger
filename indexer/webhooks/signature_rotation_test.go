package webhooks

import (
	"strconv"
	"testing"
	"time"
)

func TestVerifySignatureRotationWindow(t *testing.T) {
	const (
		activeSecret   = "whsec_new"
		previousSecret = "whsec_old"
	)
	now := time.Unix(1_800_000_000, 0)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	body := []byte(`{"event_id":"evt_rotation"}`)
	overlapExpiry := now.Add(time.Hour)
	shortExpiry := now.Add(time.Minute)
	atNow := now

	activeSignature := "sha256=" + sign(activeSecret, timestamp, body)
	previousSignature := "sha256=" + sign(previousSecret, timestamp, body)

	tests := []struct {
		name      string
		active    string
		previous  string
		expiresAt *time.Time
		body      []byte
		timestamp string
		signature string
		now       time.Time
		want      bool
	}{
		{
			name:      "active key verifies",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: activeSignature,
			now:       now,
			want:      true,
		},
		{
			name:      "previous key verifies during overlap",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: previousSignature,
			now:       now,
			want:      true,
		},
		{
			name:      "previous key rejected after overlap",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &shortExpiry,
			body:      body,
			timestamp: timestamp,
			signature: previousSignature,
			now:       shortExpiry.Add(time.Minute),
			want:      false,
		},
		{
			name:      "previous key rejected exactly at expiry",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &atNow,
			body:      body,
			timestamp: timestamp,
			signature: previousSignature,
			now:       now,
			want:      false,
		},
		{
			name:      "previous key without expiry fails closed",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: nil,
			body:      body,
			timestamp: timestamp,
			signature: previousSignature,
			now:       now,
			want:      false,
		},
		{
			name:      "active key still verifies after overlap",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &shortExpiry,
			body:      body,
			timestamp: timestamp,
			signature: activeSignature,
			now:       shortExpiry.Add(time.Second),
			want:      true,
		},
		{
			name:      "unknown key rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: "sha256=" + sign("whsec_other", timestamp, body),
			now:       now,
			want:      false,
		},
		{
			name:      "malformed signature without prefix rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: sign(activeSecret, timestamp, body),
			now:       now,
			want:      false,
		},
		{
			name:      "missing signature rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: "",
			now:       now,
			want:      false,
		},
		{
			name:      "missing timestamp rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: "",
			signature: activeSignature,
			now:       now,
			want:      false,
		},
		{
			name:      "tampered body rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      append([]byte(" "), body...),
			timestamp: timestamp,
			signature: activeSignature,
			now:       now,
			want:      false,
		},
		{
			name:      "replayed previous signature rejected after expiry",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &shortExpiry,
			body:      body,
			timestamp: timestamp,
			signature: previousSignature,
			now:       shortExpiry.Add(time.Minute),
			want:      false,
		},
		{
			name:      "stale timestamp rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: activeSignature,
			now:       now.Add(SignatureTolerance + time.Second),
			want:      false,
		},
		{
			name:      "future timestamp rejected",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: activeSignature,
			now:       now.Add(-SignatureTolerance - time.Second),
			want:      false,
		},
		{
			name:      "comma separated signatures accept either key",
			active:    activeSecret,
			previous:  previousSecret,
			expiresAt: &overlapExpiry,
			body:      body,
			timestamp: timestamp,
			signature: "sha256=deadbeef, " + previousSignature,
			now:       now,
			want:      true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := VerifySignature(tc.active, tc.previous, tc.expiresAt, tc.body, tc.timestamp, tc.signature, tc.now)
			if got != tc.want {
				t.Errorf("VerifySignature() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSigningHeadersOverlap(t *testing.T) {
	const (
		activeSecret   = "whsec_new"
		previousSecret = "whsec_old"
	)
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"event_id":"evt_headers"}`)
	timestamp := strconv.FormatInt(now.Unix(), 10)

	t.Run("during overlap both keys sign", func(t *testing.T) {
		expiresAt := now.Add(time.Hour)
		headers := signingHeaders(activeSecret, previousSecret, &expiresAt, body, now)

		if got, want := headers[TimestampHeader], timestamp; got != want {
			t.Errorf("timestamp header = %q, want %q", got, want)
		}
		if got, want := headers[SignatureHeader], "sha256="+sign(activeSecret, timestamp, body); got != want {
			t.Errorf("active signature header = %q, want %q", got, want)
		}
		if got, want := headers[PreviousSignatureHeader], "sha256="+sign(previousSecret, timestamp, body); got != want {
			t.Errorf("previous signature header = %q, want %q", got, want)
		}
	})

	t.Run("after overlap only the active key signs", func(t *testing.T) {
		expiresAt := now.Add(-time.Second)
		headers := signingHeaders(activeSecret, previousSecret, &expiresAt, body, now)

		if got, want := headers[SignatureHeader], "sha256="+sign(activeSecret, timestamp, body); got != want {
			t.Errorf("active signature header = %q, want %q", got, want)
		}
		if _, ok := headers[PreviousSignatureHeader]; ok {
			t.Error("previous signature header present after the overlap expired")
		}
	})

	t.Run("unrotated subscription keeps the legacy single header", func(t *testing.T) {
		headers := signingHeaders(activeSecret, "", nil, body, now)

		if got, want := headers[SignatureHeader], "sha256="+sign(activeSecret, timestamp, body); got != want {
			t.Errorf("active signature header = %q, want %q", got, want)
		}
		if _, ok := headers[PreviousSignatureHeader]; ok {
			t.Error("previous signature header present without a rotation")
		}
	})
}

func TestVerificationSecrets(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	expired := now.Add(-time.Second)
	active := now.Add(time.Hour)

	got := VerificationSecrets("active", "previous", &expired, now)
	if len(got) != 1 || got[0] != "active" {
		t.Errorf("expired previous key: got %v, want [active]", got)
	}

	got = VerificationSecrets("active", "previous", &active, now)
	if len(got) != 2 || got[0] != "active" || got[1] != "previous" {
		t.Errorf("open overlap: got %v, want [active previous]", got)
	}
}
