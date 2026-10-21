package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// Request-body size limits for the JSON write endpoints. Both payloads are a
// handful of short fields, so these are generous while still bounding how much
// an unauthenticated caller can make the server buffer and parse.
const (
	// maxAuthBodyBytes bounds POST /auth. A signed SEP-10 challenge envelope is
	// well under 2 KB of base64 XDR.
	maxAuthBodyBytes int64 = 8 << 10
	// maxCreateInvoiceBodyBytes bounds POST /invoices (buyer, face_value,
	// due_date).
	maxCreateInvoiceBodyBytes int64 = 4 << 10
)

// decodeJSONBody decodes exactly one JSON object from r.Body into dst, reading
// at most maxBytes. Unknown fields and trailing data are rejected.
//
// On failure it writes the error response itself (413 when the body exceeds
// maxBytes, 400 for anything malformed) and returns false; callers should
// simply return. It is intended for every JSON write endpoint, including the
// webhook-subscription endpoints.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	err := dec.Decode(dst)
	if err == nil {
		// Reject a second value (e.g. `{}{}`) so the body is exactly one object.
		if err = dec.Decode(&struct{}{}); errors.Is(err, io.EOF) {
			return true
		}
		if err == nil {
			err = errors.New("trailing data")
		}
	}

	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		writeAPIError(w, r, http.StatusRequestEntityTooLarge, "request body too large")
		return false
	}
	writeAPIError(w, r, http.StatusBadRequest, "invalid request body")
	return false
}
