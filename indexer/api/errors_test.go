package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"clearledger/indexer/db"
)

func TestAPIErrorEnvelopeIncludesStableCodeAndRequestID(t *testing.T) {
	h := newTestHandler(t)
	h.cfg.RateLimitRPS = 1000
	h.getInvoiceByIDFn = func(context.Context, string) (*db.DbInvoice, error) {
		return nil, errors.New("database password and schema detail")
	}
	router, stop := NewRouter(h)
	t.Cleanup(stop)

	req := httptest.NewRequest(http.MethodGet, "/invoices/invoice-1", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
	if rr.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", rr.Header().Get("Content-Type"))
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != "internal_error" || body.Error.Message != "failed to retrieve invoice" {
		t.Fatalf("error = %+v, want safe internal_error", body.Error)
	}
	if body.RequestID == "" {
		t.Fatal("request_id is missing from error response")
	}
	if strings.Contains(rr.Body.String(), "database password") {
		t.Fatalf("response leaked internal error: %s", rr.Body.String())
	}
}

func TestValidationErrorEnvelope(t *testing.T) {
	h := newTestHandler(t)
	h.cfg.RateLimitRPS = 1000
	router, stop := NewRouter(h)
	t.Cleanup(stop)

	req := httptest.NewRequest(http.MethodGet, "/invoices?page=invalid", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), `"code":"bad_request"`) || !strings.Contains(rr.Body.String(), `"request_id":"`) {
		t.Fatalf("unexpected validation envelope: %s", rr.Body.String())
	}
}
