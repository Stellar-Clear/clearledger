package api

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"clearledger/indexer/auth"
	"clearledger/indexer/soroban"

	"github.com/stellar/go-stellar-sdk/txnbuild"
	"github.com/stellar/go-stellar-sdk/xdr"
)

// maxPollAttempts bounds how long HandleCreateInvoice waits for a submitted
// transaction to reach a terminal state before giving up.
const maxPollAttempts = 30

// maxFaceValueDigits caps the length of the decimal face_value string accepted
// by validateCreateInvoiceRequest before it is parsed with big.Int. The u128
// range needs at most 39 digits; 40 leaves headroom for leading zeros while
// rejecting arbitrarily long inputs before any big-int work happens.
const maxFaceValueDigits = 40

// maxDueDateHorizonSeconds is the maximum accepted window for due_date, measured
// from the time the request is validated. Anything further in the future is
// rejected with 400 before the server spends fees on simulation/submission.
// 5 years covers realistic trade-finance payment terms.
const maxDueDateHorizonSeconds int64 = 5 * 365 * 24 * 60 * 60

// createInvoicePollDelay is the pause between getTransaction polls.
const createInvoicePollDelay = 1 * time.Second

// createInvoiceRequest is the JSON body accepted by POST /invoices.
type createInvoiceRequest struct {
	Buyer     string `json:"buyer"`
	FaceValue string `json:"face_value"`
	DueDate   int64  `json:"due_date"`
}

// createInvoiceParams holds the validated contract arguments derived from a
// createInvoiceRequest plus the authenticated issuer.
type createInvoiceParams struct {
	Issuer    string
	Buyer     string
	FaceValue *big.Int
	DueDate   uint64
}

// HandleCreateInvoice serves POST /invoices (protected). It is an orchestration
// of three steps: validate the request, build and sign the on-chain
// transaction, then submit it and wait for confirmation.
func (h *APIHandler) HandleCreateInvoice(w http.ResponseWriter, r *http.Request) {
	var body createInvoiceRequest
	if !decodeJSONBody(w, r, &body, maxCreateInvoiceBodyBytes) {
		return
	}

	params, err := validateCreateInvoiceRequest(r.Context(), body)
	if err != nil {
		writeHTTPError(w, r, err)
		return
	}

	signedTx, invoiceID, err := h.buildCreateInvoiceTx(r.Context(), params)
	if err != nil {
		writeHTTPError(w, r, err)
		return
	}

	hash, status, err := h.submitAndConfirm(r.Context(), signedTx)
	if err != nil {
		writeHTTPError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"invoice_id":       invoiceID,
		"transaction_hash": hash,
		"status":           status,
	})
}

// validateCreateInvoiceRequest checks that the caller is authenticated and that
// the request body carries a well-formed buyer address, a positive face value
// within the u128 range, and a due date inside the accepted window. It performs
// no I/O, so it is unit-testable on its own.
func validateCreateInvoiceRequest(ctx context.Context, body createInvoiceRequest) (*createInvoiceParams, error) {
	issuer, ok := GetUserAddress(ctx)
	if !ok || issuer == "" {
		return nil, httpErrorf(http.StatusUnauthorized, "Unauthorized: user address missing from context")
	}
	if err := validateAccountAddressField("issuer address", issuer); err != nil {
		return nil, err
	}

	if body.FaceValue == "" || body.DueDate <= 0 {
		return nil, httpErrorf(http.StatusBadRequest, "missing required invoice parameters")
	}

	if err := validateAccountAddressField("buyer address", body.Buyer); err != nil {
		return nil, err
	}

	// Reject absurdly long decimal strings before parsing so a huge request
	// cannot trigger needless big.Int work; the u128 range needs at most 39
	// digits, so anything beyond maxFaceValueDigits cannot be valid.
	if len(body.FaceValue) > maxFaceValueDigits {
		return nil, httpErrorf(http.StatusBadRequest, "invalid face value: face_value exceeds the u128 range (max 2^128 - 1)")
	}

	faceValueBig, ok := new(big.Int).SetString(body.FaceValue, 10)
	if !ok || faceValueBig.Sign() <= 0 {
		return nil, httpErrorf(http.StatusBadRequest, "invalid face value")
	}
	if faceValueBig.BitLen() > 128 {
		return nil, httpErrorf(http.StatusBadRequest, "invalid face value: face_value exceeds the u128 range (max 2^128 - 1)")
	}

	dueDate, err := validateDueDate(body.DueDate)
	if err != nil {
		return nil, err
	}

	return &createInvoiceParams{
		Issuer:    issuer,
		Buyer:     body.Buyer,
		FaceValue: faceValueBig,
		DueDate:   dueDate,
	}, nil
}

// validateAccountAddressField decodes a public-key field as a Stellar account
// StrKey (G...) and reports a field-specific client error. A well-formed
// StrKey with the wrong version (for example a contract C...) is semantically
// unprocessable and gets 422; malformed input, including a bad checksum, gets
// 400. Decoder errors stay server-side so no implementation details leak.
func validateAccountAddressField(field, value string) error {
	return validateAddressField(field, value, auth.ValidateAccountAddress, "account address (G...)")
}

func validateAddressField(field, value string, validate func(string) error, expected string) error {
	err := validate(value)
	switch {
	case errors.Is(err, auth.ErrAddressEmpty):
		return httpErrorf(http.StatusBadRequest, "invalid %s: value is required", field)
	case errors.Is(err, auth.ErrAddressWrongVersion):
		return httpErrorf(http.StatusUnprocessableEntity, "invalid %s: expected a Stellar %s", field, expected)
	case err != nil:
		return httpErrorf(http.StatusBadRequest, "invalid %s: malformed Stellar StrKey", field)
	default:
		return nil
	}
}

// validateDueDate ensures due_date is a future timestamp below the maximum
// horizon. Timestamps in the past or beyond maxDueDateHorizonSeconds are
// rejected before the server spends fees simulating and submitting the
// transaction.
func validateDueDate(dueDate int64) (uint64, error) {
	now := time.Now().Unix()
	if dueDate <= now {
		return 0, httpErrorf(http.StatusBadRequest, "invalid due date: due_date must be a future Unix timestamp")
	}
	if dueDate > now+maxDueDateHorizonSeconds {
		return 0, httpErrorf(http.StatusBadRequest, "invalid due date: due_date exceeds the maximum horizon of %d days from now", maxDueDateHorizonSeconds/(24*60*60))
	}
	return uint64(dueDate), nil
}

// buildCreateInvoiceTx fetches the server account sequence, assembles the
// invoke-host-function transaction, simulates it to obtain the Soroban resource
// footprint and the generated invoice ID, and returns the signed envelope.
func (h *APIHandler) buildCreateInvoiceTx(ctx context.Context, params *createInvoiceParams) (signedTx string, invoiceID string, err error) {
	seq, err := h.fetchServerSequence(ctx)
	if err != nil {
		return "", "", err
	}

	op, err := buildCreateInvoiceOp(h.cfg.InvoiceContractID, params)
	if err != nil {
		return "", "", err
	}

	tx, err := txnbuild.NewTransaction(txnbuild.TransactionParams{
		SourceAccount: &txnbuild.SimpleAccount{
			AccountID: h.serverKP.Address(),
			Sequence:  seq,
		},
		IncrementSequenceNum: true,
		BaseFee:              txnbuild.MinBaseFee,
		Preconditions: txnbuild.Preconditions{
			TimeBounds: txnbuild.NewTimebounds(0, time.Now().Add(1*time.Hour).Unix()),
		},
		Operations: []txnbuild.Operation{op},
	})
	if err != nil {
		return "", "", httpErrorf(http.StatusInternalServerError, "failed to construct transaction")
	}

	txBase64, err := tx.Base64()
	if err != nil {
		return "", "", httpErrorf(http.StatusInternalServerError, "failed to encode transaction to base64")
	}

	simResp, invoiceID, err := h.simulateCreateInvoiceTx(ctx, txBase64)
	if err != nil {
		return "", "", err
	}

	signedTx, err = h.signCreateInvoiceTx(tx, txBase64, simResp)
	if err != nil {
		return "", "", err
	}

	return signedTx, invoiceID, nil
}

// fetchServerSequence reads the current sequence number of the server account
// from Soroban RPC.
func (h *APIHandler) fetchServerSequence(ctx context.Context) (int64, error) {
	var accResp soroban.GetAccountResponse
	if err := soroban.CallSorobanRPC(ctx, h.cfg.SorobanRPCURL, "getAccount", map[string]string{"address": h.serverKP.Address()}, &accResp); err != nil {
		// err may embed the full RPC URL (and any API key in it); log it and
		// return a client-safe message instead of interpolating it (issue #921).
		slog.ErrorContext(ctx, "failed to fetch server account", "error", err)
		return 0, httpErrorf(http.StatusInternalServerError, "failed to fetch server account")
	}

	seq, err := strconv.ParseInt(accResp.Sequence, 10, 64)
	if err != nil {
		return 0, httpErrorf(http.StatusInternalServerError, "failed to parse sequence number")
	}
	return seq, nil
}

// buildCreateInvoiceOp converts the validated params into the invoice
// contract's `create` invocation.
func buildCreateInvoiceOp(contractID string, params *createInvoiceParams) (*txnbuild.InvokeHostFunction, error) {
	// The contract ID comes from server configuration rather than the request,
	// so a bad value is an operator error, never a client error. Validate it
	// as a contract (C...) StrKey before shaping any operation.
	if err := auth.ValidateContractAddress(contractID); err != nil {
		return nil, httpErrorf(http.StatusInternalServerError, "invalid invoice contract configuration")
	}

	issuerVal, err := soroban.MakeAddressScVal(params.Issuer)
	if err != nil {
		return nil, httpErrorf(http.StatusInternalServerError, "failed to build issuer address")
	}
	buyerVal, err := soroban.MakeAddressScVal(params.Buyer)
	if err != nil {
		return nil, httpErrorf(http.StatusInternalServerError, "failed to build buyer address")
	}
	// Validation guarantees face value fits a u128, so a failure here would
	// indicate a programming error rather than bad client input.
	faceValueVal, err := soroban.MakeU128ScVal(params.FaceValue)
	if err != nil {
		return nil, httpErrorf(http.StatusBadRequest, "invalid face value: %s", err.Error())
	}
	dueDateVal := soroban.MakeU64ScVal(params.DueDate)

	op, err := soroban.BuildInvokeContractOp(contractID, "create", []xdr.ScVal{issuerVal, buyerVal, faceValueVal, dueDateVal})
	if err != nil {
		return nil, httpErrorf(http.StatusInternalServerError, "failed to build contract operation")
	}
	return op, nil
}

// simulateCreateInvoiceTx simulates txBase64 and returns the simulation
// response together with the invoice ID the contract would generate.
func (h *APIHandler) simulateCreateInvoiceTx(ctx context.Context, txBase64 string) (*soroban.SimulateResponse, string, error) {
	var simResp soroban.SimulateResponse
	if err := soroban.CallSorobanRPC(ctx, h.cfg.SorobanRPCURL, "simulateTransaction", map[string]string{"transaction": txBase64}, &simResp); err != nil {
		// err may embed the full RPC URL (and any API key in it); log it and
		// return a client-safe message instead of interpolating it (issue #921).
		slog.ErrorContext(ctx, "invoice simulation failed", "error", err)
		return nil, "", httpErrorf(http.StatusInternalServerError, "simulation failed")
	}

	if len(simResp.Results) == 0 {
		return nil, "", httpErrorf(http.StatusInternalServerError, "simulation did not yield a result")
	}

	invoiceID, err := soroban.ParseInvoiceIDFromResult(simResp.Results[0].Xdr)
	if err != nil {
		return nil, "", httpErrorf(http.StatusInternalServerError, "failed to parse generated invoice id: %s", err.Error())
	}

	return &simResp, invoiceID, nil
}

// signCreateInvoiceTx grafts the simulated Soroban transaction data and
// resource fee onto the envelope, then signs it with the server keypair.
func (h *APIHandler) signCreateInvoiceTx(tx *txnbuild.Transaction, txBase64 string, simResp *soroban.SimulateResponse) (string, error) {
	// Read and modify the envelope for Soroban Data and Fee
	var env xdr.TransactionEnvelope
	if err := xdr.SafeUnmarshalBase64(txBase64, &env); err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to unmarshal tx envelope")
	}

	var txData xdr.SorobanTransactionData
	if err := xdr.SafeUnmarshalBase64(simResp.TransactionData, &txData); err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to unmarshal simulation transaction data")
	}

	env.V1.Tx.Ext.V = 1
	env.V1.Tx.Ext.SorobanData = &txData

	resFee, err := strconv.ParseInt(simResp.MinResourceFee, 10, 64)
	if err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to parse resource fee")
	}
	env.V1.Tx.Fee = xdr.Uint32(tx.BaseFee() + resFee)

	// Marshal env back to base64
	envBytes, err := env.MarshalBinary()
	if err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to marshal modified envelope")
	}
	envBase64 := base64.StdEncoding.EncodeToString(envBytes)

	// Parse back as a Transaction to sign
	genericTx, err := txnbuild.TransactionFromXDR(envBase64)
	if err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to parse modified transaction envelope")
	}
	assembled, ok := genericTx.Transaction()
	if !ok {
		return "", httpErrorf(http.StatusInternalServerError, "invalid transaction envelope")
	}

	assembled, err = assembled.Sign(h.cfg.NetworkPassphrase, h.serverKP)
	if err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to sign transaction")
	}

	signedBase64, err := assembled.Base64()
	if err != nil {
		return "", httpErrorf(http.StatusInternalServerError, "failed to encode signed transaction")
	}

	return signedBase64, nil
}

// submitAndConfirm sends the signed transaction to the network and polls
// getTransaction until it reaches a terminal state, returning the transaction
// hash and final status.
func (h *APIHandler) submitAndConfirm(ctx context.Context, signedTx string) (hash string, status string, err error) {
	var submitResp struct {
		Hash   string `json:"hash"`
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := soroban.CallSorobanRPC(ctx, h.cfg.SorobanRPCURL, "sendTransaction", map[string]string{"transaction": signedTx}, &submitResp); err != nil {
		// err may embed the full RPC URL (and any API key in it); log it and
		// return a client-safe message instead of interpolating it (issue #921).
		slog.ErrorContext(ctx, "failed to send transaction", "error", err)
		return "", "", httpErrorf(http.StatusInternalServerError, "failed to send transaction")
	}

	if submitResp.Status == "ERROR" {
		return "", "", httpErrorf(http.StatusInternalServerError, "transaction submission rejected: %s", submitResp.Error)
	}

	finalStatus, err := h.awaitTransaction(ctx, submitResp.Hash)
	if err != nil {
		return "", "", err
	}

	return submitResp.Hash, finalStatus, nil
}

// awaitTransaction polls getTransaction for hash until it succeeds, fails, or
// the attempt budget / request context runs out.
func (h *APIHandler) awaitTransaction(ctx context.Context, hash string) (string, error) {
	type getTransactionResult struct {
		Hash   string `json:"hash"`
		Status string `json:"status"`
		Error  string `json:"error"`
	}

	var txResult getTransactionResult
	pollAttempts := 0

	for {
		if err := soroban.CallSorobanRPC(ctx, h.cfg.SorobanRPCURL, "getTransaction", map[string]string{"hash": hash}, &txResult); err != nil {
			// err may embed the full RPC URL (and any API key in it); log it and
			// return a client-safe message instead of interpolating it (issue #921).
			slog.ErrorContext(ctx, "failed to poll transaction", "error", err)
			return "", httpErrorf(http.StatusInternalServerError, "failed to poll transaction")
		}

		if txResult.Status == "SUCCESS" {
			return txResult.Status, nil
		}

		if txResult.Status == "FAILED" {
			if txResult.Error != "" {
				return "", httpErrorf(http.StatusInternalServerError, "transaction failed on-chain: %s", txResult.Error)
			}
			return "", httpErrorf(http.StatusInternalServerError, "transaction failed on-chain")
		}

		pollAttempts++
		if pollAttempts >= maxPollAttempts {
			return "", httpErrorf(http.StatusGatewayTimeout, "transaction confirmation timed out after %d attempts: %s", maxPollAttempts, hash)
		}

		select {
		case <-ctx.Done():
			return "", httpErrorf(http.StatusGatewayTimeout, "request cancelled: %s", ctx.Err().Error())
		case <-time.After(createInvoicePollDelay):
		}
	}
}
