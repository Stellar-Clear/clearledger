package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"clearledger/indexer/config"

	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/txnbuild"
)

const testNetworkPassphrase = "Test SDF Network ; September 2015"

// newTestHandler creates an APIHandler backed by a deterministic test keypair.
func newTestHandler(t *testing.T) *APIHandler {
	t.Helper()
	serverKP, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate test keypair: %v", err)
	}
	cfg := &config.Config{
		NetworkPassphrase: testNetworkPassphrase,
		JWTSecret:         "test-jwt-secret-for-unit-tests",
		JWTExpiryHours:    24,
		ServerSeed:        serverKP.Seed(),
	}
	h, err := NewAPIHandler(cfg)
	if err != nil {
		t.Fatalf("newTestHandler: %v", err)
	}
	return h
}

// TestHandleGetAuth_MissingAddress expects 400 when address is absent.
func TestHandleGetAuth_MissingAddress(t *testing.T) {
	h := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/auth", nil)
	w := httptest.NewRecorder()
	h.HandleGetAuth(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("missing address: got status %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestHandleGetAuth_InvalidAddress expects 400 for a non-Stellar address.
func TestHandleGetAuth_InvalidAddress(t *testing.T) {
	h := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/auth?address=not-a-stellar-address", nil)
	w := httptest.NewRecorder()
	h.HandleGetAuth(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid address: got status %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestHandleGetAuth_RejectsWrongVersionAddress expects 422 when a valid StrKey
// uses the wrong version for a signing account (C... contract or S... seed).
func TestHandleGetAuth_RejectsWrongVersionAddress(t *testing.T) {
	h := newTestHandler(t)
	seedKP, _ := keypair.Random()

	for name, address := range map[string]string{
		"contract": testContractAddress(t),
		"seed":     seedKP.Seed(),
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/auth?address="+address, nil)
			w := httptest.NewRecorder()
			h.HandleGetAuth(w, req)

			if w.Code != http.StatusUnprocessableEntity {
				t.Errorf("got status %d, want %d; body: %s", w.Code, http.StatusUnprocessableEntity, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "invalid address") {
				t.Errorf("expected field-specific address error, got %q", w.Body.String())
			}
		})
	}
}

// TestHandleGetAuth_ValidAddress expects 200 and a JSON body with "transaction" and
// "network_passphrase" fields.
func TestHandleGetAuth_ValidAddress(t *testing.T) {
	h := newTestHandler(t)

	clientKP, _ := keypair.Random()
	req := httptest.NewRequest(http.MethodGet, "/auth?address="+clientKP.Address(), nil)
	w := httptest.NewRecorder()
	h.HandleGetAuth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("valid address: got status %d, want %d; body: %s", w.Code, http.StatusOK, w.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp["transaction"] == "" {
		t.Error("response missing 'transaction' field")
	}
	if resp["network_passphrase"] != testNetworkPassphrase {
		t.Errorf("network_passphrase: got %q, want %q", resp["network_passphrase"], testNetworkPassphrase)
	}
}

// TestHandlePostAuth_EmptyBody expects 400 for an empty request body.
func TestHandlePostAuth_EmptyBody(t *testing.T) {
	h := newTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.HandlePostAuth(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("empty body: got status %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestHandlePostAuth_InvalidJSON expects 400 for malformed JSON.
func TestHandlePostAuth_InvalidJSON(t *testing.T) {
	h := newTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader("{invalid"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.HandlePostAuth(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid json: got status %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestHandlePostAuth_MissingTransaction expects 400 when JSON has no "transaction" key.
func TestHandlePostAuth_MissingTransaction(t *testing.T) {
	h := newTestHandler(t)

	body, _ := json.Marshal(map[string]string{"other": "value"})
	req := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.HandlePostAuth(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("missing transaction: got status %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestHandlePostAuth_ValidChallenge performs the full challenge→sign→verify round-trip
// using in-process crypto (no network required).
func TestHandlePostAuth_ValidChallenge(t *testing.T) {
	h := newTestHandler(t)
	clientKP, _ := keypair.Random()

	// Step 1: fetch challenge via the handler
	getReq := httptest.NewRequest(http.MethodGet, "/auth?address="+clientKP.Address(), nil)
	getW := httptest.NewRecorder()
	h.HandleGetAuth(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("generating challenge: got %d: %s", getW.Code, getW.Body.String())
	}

	var challengeResp map[string]string
	if err := json.NewDecoder(getW.Body).Decode(&challengeResp); err != nil {
		t.Fatalf("decode challenge response: %v", err)
	}
	txXDR := challengeResp["transaction"]

	// Step 2: sign with client keypair
	genericTx, err := txnbuild.TransactionFromXDR(txXDR)
	if err != nil {
		t.Fatalf("parse challenge XDR: %v", err)
	}
	tx, ok := genericTx.Transaction()
	if !ok {
		t.Fatal("expected regular transaction")
	}
	tx, err = tx.Sign(testNetworkPassphrase, clientKP)
	if err != nil {
		t.Fatalf("sign challenge: %v", err)
	}
	signedXDR, err := tx.Base64()
	if err != nil {
		t.Fatalf("encode signed tx: %v", err)
	}

	// Step 3: verify via the handler
	body, _ := json.Marshal(map[string]string{"transaction": signedXDR})
	postReq := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewBuffer(body))
	postReq.Header.Set("Content-Type", "application/json")
	postW := httptest.NewRecorder()
	h.HandlePostAuth(postW, postReq)

	if postW.Code != http.StatusOK {
		t.Fatalf("verify challenge: got %d: %s", postW.Code, postW.Body.String())
	}

	var tokenResp struct {
		Token     string `json:"token"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.NewDecoder(postW.Body).Decode(&tokenResp); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	if tokenResp.Token == "" {
		t.Error("response missing 'token' field")
	}
	if tokenResp.ExpiresIn <= 0 {
		t.Errorf("response missing a positive 'expires_in' field, got %d", tokenResp.ExpiresIn)
	}
}

// TestHandlePostAuth_ExpiredChallenge expects 401 for a challenge with timebounds in the past.
func TestHandlePostAuth_ExpiredChallenge(t *testing.T) {
	h := newTestHandler(t)
	clientKP, _ := keypair.Random()

	// Build an expired challenge manually (MaxTime in the past).
	// ManageData.Value can be any bytes; VerifyChallenge only checks Name and SourceAccount.
	tx, err := txnbuild.NewTransaction(txnbuild.TransactionParams{
		SourceAccount: &txnbuild.SimpleAccount{
			AccountID: h.serverKP.Address(),
			Sequence:  0,
		},
		IncrementSequenceNum: false,
		BaseFee:              txnbuild.MinBaseFee,
		Preconditions: txnbuild.Preconditions{
			TimeBounds: txnbuild.NewTimebounds(
				time.Now().Add(-2*time.Hour).Unix(),
				time.Now().Add(-1*time.Hour).Unix(), // expired
			),
		},
		Operations: []txnbuild.Operation{
			&txnbuild.ManageData{
				SourceAccount: clientKP.Address(),
				Name:          "clearledger auth",
				Value:         []byte("expired-test-nonce"),
			},
		},
	})
	if err != nil {
		t.Fatalf("build expired tx: %v", err)
	}

	// Sign with server and client
	tx, err = tx.Sign(testNetworkPassphrase, h.serverKP, clientKP)
	if err != nil {
		t.Fatalf("sign expired tx: %v", err)
	}
	txXDR, err := tx.Base64()
	if err != nil {
		t.Fatalf("encode expired tx: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"transaction": txXDR})
	req := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.HandlePostAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expired challenge: got status %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// TestHandlePostAuth_OversizedBody expects 413 for a body over
// maxAuthBodyBytes, before the transaction is handed to the XDR parser (which
// would otherwise answer 401).
func TestHandlePostAuth_OversizedBody(t *testing.T) {
	h := newTestHandler(t)

	body := `{"transaction":"` + strings.Repeat("A", int(maxAuthBodyBytes)) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.HandlePostAuth(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: got status %d, want %d", w.Code, http.StatusRequestEntityTooLarge)
	}
}

// TestHandlePostAuth_RejectsUnknownFieldsAndTrailingData expects 400 when the
// body has a misspelled field or more than one JSON value.
func TestHandlePostAuth_RejectsUnknownFieldsAndTrailingData(t *testing.T) {
	h := newTestHandler(t)

	for name, body := range map[string]string{
		"unknown field": `{"transaction":"AAAA","transction":"AAAA"}`,
		"trailing data": `{"transaction":"AAAA"}{}`,
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.HandlePostAuth(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("got status %d, want %d", w.Code, http.StatusBadRequest)
			}
		})
	}
}
