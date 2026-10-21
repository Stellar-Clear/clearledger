package webhooks

import (
	"crypto/hmac"
	"strconv"
	"strings"
	"time"
)

const (
	// SignatureHeader carries the HMAC of the active signing secret.
	SignatureHeader = "X-ClearLedger-Signature"
	// PreviousSignatureHeader carries the HMAC of the previous signing secret
	// while a rotation overlap window is open. It is omitted once
	// previous_signing_secret_expires_at has passed.
	PreviousSignatureHeader = "X-ClearLedger-Signature-Previous"
	// TimestampHeader carries the Unix second used as the HMAC prefix.
	TimestampHeader = "X-ClearLedger-Timestamp"

	// SignatureTolerance is how far a delivery timestamp may be from the
	// receiver's clock, in either direction. It bounds replay of a captured
	// request; de-duplicating on event_id handles replays inside the window.
	SignatureTolerance = 5 * time.Minute
)

// VerificationSecrets returns the keys a receiver should accept at now: the
// active key plus, while the overlap window is still open, the previous key.
// A previous secret without an expiry is treated as expired (fail closed)
// rather than accepted forever.
func VerificationSecrets(activeSecret, previousSecret string, previousExpiresAt *time.Time, now time.Time) []string {
	secrets := make([]string, 0, 2)
	if activeSecret != "" {
		secrets = append(secrets, activeSecret)
	}
	if previousSecret != "" && previousExpiresAt != nil && now.Before(*previousExpiresAt) {
		secrets = append(secrets, previousSecret)
	}
	return secrets
}

// VerifySignature checks a single X-ClearLedger-Signature value against the
// active key and, during a rotation, the previous key.
//
// A signature is valid only when its timestamp is within SignatureTolerance of
// now and it matches one of the accepted keys. Multiple comma-separated
// signature values are accepted so a receiver can check a header produced by
// either key without choosing one first. Using the previous key after
// previousExpiresAt always fails, even for a signature captured while it was
// still valid.
func VerifySignature(activeSecret, previousSecret string, previousExpiresAt *time.Time, rawBody []byte, timestamp, signature string, now time.Time) bool {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if age := now.Sub(time.Unix(ts, 0)); age > SignatureTolerance || age < -SignatureTolerance {
		return false
	}

	for _, secret := range VerificationSecrets(activeSecret, previousSecret, previousExpiresAt, now) {
		expected := "sha256=" + sign(secret, timestamp, rawBody)
		for _, candidate := range strings.Split(signature, ",") {
			if hmac.Equal([]byte(expected), []byte(strings.TrimSpace(candidate))) {
				return true
			}
		}
	}
	return false
}

// signingHeaders builds the signature headers for one delivery attempt. The
// active key always signs the main header. While the previous key's overlap
// window is open, the previous key also signs a second header so receivers
// that have not installed the new secret yet can still authenticate the
// delivery. The extra header is absent once the overlap expires and for every
// subscription that has never been rotated.
func signingHeaders(activeSecret, previousSecret string, previousExpiresAt *time.Time, payload []byte, now time.Time) map[string]string {
	timestamp := strconv.FormatInt(now.Unix(), 10)
	headers := map[string]string{
		TimestampHeader: timestamp,
		SignatureHeader: "sha256=" + sign(activeSecret, timestamp, payload),
	}
	if previousSecret != "" && previousExpiresAt != nil && now.Before(*previousExpiresAt) {
		headers[PreviousSignatureHeader] = "sha256=" + sign(previousSecret, timestamp, payload)
	}
	return headers
}
