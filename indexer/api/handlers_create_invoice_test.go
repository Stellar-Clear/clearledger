package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"clearledger/indexer/soroban"

	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/xdr"
)

func invoiceRequest(t *testing.T, h *APIHandler, issuer, buyer, faceValue string, dueDate int64) *httptest.ResponseRecorder {
	t.Helper()

	body, err := json.Marshal(map[string]interface{}{
		"buyer":      buyer,
		"face_value": faceValue,
		"due_date":   dueDate,
	})
	if err != nil {
		t.Fatalf("marshal invoice request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/invoices", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(WithUserAddress(req.Context(), issuer))

	recorder := httptest.NewRecorder()
	h.HandleCreateInvoice(recorder, req)
	return recorder
}

func TestHandleCreateInvoice_InvalidRequests(t *testing.T) {
	h := newTestHandler(t)
	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}
	buyer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate buyer keypair: %v", err)
	}

	tests := []struct {
		name       string
		body       string
		withIssuer bool
		wantStatus int
	}{
		{
			name:       "malformed JSON",
			body:       "{invalid",
			withIssuer: true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing authentication context",
			body:       `{"buyer":"` + buyer.Address() + `","face_value":"1000","due_date":1700000000}`,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing required fields",
			body:       `{"buyer":"","face_value":"","due_date":0}`,
			withIssuer: true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid buyer address",
			body:       `{"buyer":"not-a-stellar-address","face_value":"1000","due_date":1700000000}`,
			withIssuer: true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid face value",
			body:       `{"buyer":"` + buyer.Address() + `","face_value":"0","due_date":1700000000}`,
			withIssuer: true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "past due date",
			body:       `{"buyer":"` + buyer.Address() + `","face_value":"1000","due_date":1700000000}`,
			withIssuer: true,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/invoices", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			if tt.withIssuer {
				req = req.WithContext(WithUserAddress(req.Context(), issuer.Address()))
			}

			recorder := httptest.NewRecorder()
			h.HandleCreateInvoice(recorder, req)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("got status %d, want %d; body: %s", recorder.Code, tt.wantStatus, recorder.Body.String())
			}
		})
	}
}

func TestHandleCreateInvoice_FaceValueExceedsU128(t *testing.T) {
	h := newTestHandler(t)
	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}
	buyer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate buyer keypair: %v", err)
	}

	recorder := invoiceRequest(t, h, issuer.Address(), buyer.Address(), "340282366920938463463374607431768211456", time.Now().Add(24*time.Hour).Unix())
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want %d; body: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "exceeds the u128 range") {
		t.Fatalf("expected u128 range error, got %q", recorder.Body.String())
	}
}

func TestHandleCreateInvoice_InvalidAddressDoesNotReachBuilder(t *testing.T) {
	h := newTestHandler(t)
	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}
	buyer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate buyer keypair: %v", err)
	}

	var rpcCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rpcCalls.Add(1)
		http.Error(w, "builder should not be reached", http.StatusInternalServerError)
	}))
	defer server.Close()
	h.cfg.SorobanRPCURL = server.URL

	tests := []struct {
		name       string
		issuer     string
		buyer      string
		wantStatus int
	}{
		{
			name:       "contract buyer",
			issuer:     issuer.Address(),
			buyer:      testContractAddress(t),
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "buyer bad checksum",
			issuer:     issuer.Address(),
			buyer:      corruptStrkeyChecksum(buyer.Address()),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "contract issuer",
			issuer:     testContractAddress(t),
			buyer:      buyer.Address(),
			wantStatus: http.StatusUnprocessableEntity,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := invoiceRequest(t, h, tt.issuer, tt.buyer, "1000", futureDueDate())
			if recorder.Code != tt.wantStatus {
				t.Fatalf("got status %d, want %d; body: %s", recorder.Code, tt.wantStatus, recorder.Body.String())
			}
		})
	}

	if rpcCalls.Load() != 0 {
		t.Fatalf("invalid addresses reached the transaction builder: %d RPC calls", rpcCalls.Load())
	}
}

func TestHandleCreateInvoice_WrongVersionBuyerReturns422(t *testing.T) {
	h := newTestHandler(t)
	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}

	recorder := invoiceRequest(t, h, issuer.Address(), testContractAddress(t), "1000", futureDueDate())
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("got status %d, want %d; body: %s", recorder.Code, http.StatusUnprocessableEntity, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "invalid buyer address") {
		t.Fatalf("expected field-specific buyer error, got %q", recorder.Body.String())
	}
}

func TestHandleCreateInvoice_SorobanRPCFailure(t *testing.T) {
	h := newTestHandler(t)
	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}
	buyer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate buyer keypair: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"upstream unavailable"}}`))
	}))
	defer server.Close()
	h.cfg.SorobanRPCURL = server.URL

	recorder := invoiceRequest(t, h, issuer.Address(), buyer.Address(), "1000", time.Now().Add(24*time.Hour).Unix())
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("got status %d, want %d; body: %s", recorder.Code, http.StatusInternalServerError, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "failed to fetch server account") {
		t.Fatalf("expected account-fetch error, got %q", recorder.Body.String())
	}
}

func TestHandleCreateInvoice_HappyPath(t *testing.T) {
	h := newTestHandler(t)
	// newTestHandler intentionally creates only the common test configuration.
	// HandleCreateInvoice also requires a valid invoice contract address.
	h.cfg.InvoiceContractID = "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS"

	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}
	buyer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate buyer keypair: %v", err)
	}

	invoiceID := []byte("invoice-1")
	invoiceIDVal := xdr.ScBytes(invoiceID)
	invoiceIDScVal := xdr.ScVal{Type: xdr.ScValTypeScvBytes, Bytes: &invoiceIDVal}
	invoiceIDXDR, err := invoiceIDScVal.MarshalBinary()
	if err != nil {
		t.Fatalf("marshal invoice id ScVal: %v", err)
	}

	transactionData, err := (xdr.SorobanTransactionData{}).MarshalBinary()
	if err != nil {
		t.Fatalf("marshal transaction data: %v", err)
	}

	var simulateCalls atomic.Int32
	var transactionCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request soroban.JsonRpcRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		var response string
		switch request.Method {
		case "getAccount":
			response = `{"jsonrpc":"2.0","id":1,"result":{"id":"` + h.serverKP.Address() + `","sequence":"1"}}`
		case "simulateTransaction":
			simulateCalls.Add(1)
			response = `{"jsonrpc":"2.0","id":1,"result":{"transactionData":"` + base64.StdEncoding.EncodeToString(transactionData) + `","minResourceFee":"100","results":[{"xdr":"` + base64.StdEncoding.EncodeToString(invoiceIDXDR) + `"}]}}`
		case "sendTransaction":
			transactionCalls.Add(1)
			response = `{"jsonrpc":"2.0","id":1,"result":{"hash":"test-hash","status":"PENDING"}}`
		case "getTransaction":
			response = `{"jsonrpc":"2.0","id":1,"result":{"status":"SUCCESS","hash":"test-hash"}}`
		default:
			response = `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}`
		}
		_, _ = w.Write([]byte(response))
	}))
	defer server.Close()
	h.cfg.SorobanRPCURL = server.URL

	recorder := invoiceRequest(t, h, issuer.Address(), buyer.Address(), "1000", time.Now().Add(24*time.Hour).Unix())
	if recorder.Code != http.StatusOK && recorder.Code != http.StatusCreated {
		t.Fatalf("got status %d, want 200 or 201; body: %s", recorder.Code, recorder.Body.String())
	}
	if simulateCalls.Load() != 1 {
		t.Fatalf("simulateTransaction calls: got %d, want 1", simulateCalls.Load())
	}
	if transactionCalls.Load() != 1 {
		t.Fatalf("sendTransaction calls: got %d, want 1", transactionCalls.Load())
	}
	if !strings.Contains(recorder.Body.String(), "invoice") {
		t.Fatalf("response does not contain invoice data: %s", recorder.Body.String())
	}
}

// TestHandleCreateInvoice_OversizedBody expects 413 for a body over
// maxCreateInvoiceBodyBytes. The request carries no authenticated issuer, so
// reaching validation would answer 401 instead; 413 proves the limit is
// enforced first.
func TestHandleCreateInvoice_OversizedBody(t *testing.T) {
	h := newTestHandler(t)

	body := `{"buyer":"` + strings.Repeat("G", int(maxCreateInvoiceBodyBytes)) + `","face_value":"1000","due_date":1700000000}`
	req := httptest.NewRequest(http.MethodPost, "/invoices", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	h.HandleCreateInvoice(recorder, req)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: got status %d, want %d", recorder.Code, http.StatusRequestEntityTooLarge)
	}
}
