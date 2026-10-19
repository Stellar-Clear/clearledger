package api

import (
	"fmt"
	"net/http"

	"clearledger/indexer/auth"
)

// GET /auth
func (h *APIHandler) HandleGetAuth(w http.ResponseWriter, r *http.Request) {
	address := r.URL.Query().Get("address")
	if address == "" {
		http.Error(w, "missing address parameter", http.StatusBadRequest)
		return
	}

	if err := validateAccountAddressField("address", address); err != nil {
		writeHTTPError(w, r, err)
		return
	}

	xdrString, err := auth.GenerateChallenge(h.serverKP, address, h.cfg.NetworkPassphrase)
	if err != nil {
		// The raw error can disclose signing internals; log it and return a
		// generic message (issue #921).
		internalError(w, r, "failed to generate challenge", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"transaction":        xdrString,
		"network_passphrase": h.cfg.NetworkPassphrase,
	})
}

// POST /auth
func (h *APIHandler) HandlePostAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Transaction string `json:"transaction"`
	}
	if !decodeJSONBody(w, r, &body, maxAuthBodyBytes) {
		return
	}

	if body.Transaction == "" {
		http.Error(w, "missing transaction parameter", http.StatusBadRequest)
		return
	}

	clientAddr, err := auth.VerifyChallenge(body.Transaction, h.serverKP, h.cfg.NetworkPassphrase)
	if err != nil {
		http.Error(w, fmt.Sprintf("challenge verification failed: %s", err.Error()), http.StatusUnauthorized)
		return
	}

	token, err := auth.GenerateJWT(clientAddr, h.cfg.JWTSecret, h.cfg.JWTExpiryHours)
	if err != nil {
		http.Error(w, "failed to generate authentication token", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
	})
}
