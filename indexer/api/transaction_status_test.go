package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestSubmitAndConfirmReturnsPendingAfterRequestDeadline(t *testing.T) {
	h := newTestHandler(t)
	h.callSorobanRPCFn = func(ctx context.Context, _ string, method string, _ interface{}, result interface{}) error {
		switch method {
		case "sendTransaction":
			response := result.(*struct {
				Hash   string `json:"hash"`
				Status string `json:"status"`
				Error  string `json:"error"`
			})
			response.Hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
			response.Status = "PENDING"
			return nil
		case "getTransaction":
			return context.DeadlineExceeded
		default:
			return errors.New("unexpected RPC method")
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	hash, status, err := h.submitAndConfirm(ctx, "signed")
	if err != nil {
		t.Fatalf("submitAndConfirm returned error: %v", err)
	}
	if status != "PENDING" {
		t.Fatalf("status = %q, want PENDING", status)
	}
	if hash == "" {
		t.Fatal("submitted transaction hash is empty")
	}
}

func TestHandleGetTransactionStatus(t *testing.T) {
	h := newTestHandler(t)
	h.callSorobanRPCFn = func(_ context.Context, _ string, method string, _ interface{}, result interface{}) error {
		if method != "getTransaction" {
			t.Fatalf("method = %q, want getTransaction", method)
		}
		response := result.(*struct {
			Hash   string `json:"hash"`
			Status string `json:"status"`
		})
		response.Status = "SUCCESS"
		return nil
	}

	r := chi.NewRouter()
	r.Get("/transactions/{hash}", h.HandleGetTransactionStatus)
	req := httptest.NewRequest(http.MethodGet, "/transactions/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status code = %d, body = %s", rr.Code, rr.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["status"] != "SUCCESS" {
		t.Fatalf("status = %q, want SUCCESS", body["status"])
	}
}

func TestHandleGetTransactionStatusRejectsInvalidHash(t *testing.T) {
	h := newTestHandler(t)
	r := chi.NewRouter()
	r.Get("/transactions/{hash}", h.HandleGetTransactionStatus)
	req := httptest.NewRequest(http.MethodGet, "/transactions/not-a-hash", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status code = %d, want 400", rr.Code)
	}
}
