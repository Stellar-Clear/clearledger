package api

import (
	"log/slog"
	"net/http"

	"clearledger/indexer/auth"

	"github.com/stellar/go-stellar-sdk/keypair"
)

// GET /auth
func (h *APIHandler) HandleGetAuth(w http.ResponseWriter, r *http.Request) {
	address := r.URL.Query().Get("address")
	if address == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing address parameter")
		return
	}

	_, err := keypair.Parse(address)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid address format")
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
		writeAPIError(w, r, http.StatusBadRequest, "missing transaction parameter")
		return
	}

	clientAddr, err := auth.VerifyChallenge(body.Transaction, h.serverKP, h.cfg.NetworkPassphrase)
	if err != nil {
		slog.WarnContext(r.Context(), "challenge verification failed", "error", err)
		writeAPIError(w, r, http.StatusUnauthorized, "challenge verification failed")
		return
	}

	token, err := auth.GenerateJWT(clientAddr, h.cfg.JWTSecret, h.cfg.JWTExpiryHours)
	if err != nil {
		internalError(w, r, "failed to generate authentication token", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
	})
}
