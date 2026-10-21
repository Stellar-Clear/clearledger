package api

import (
	"net/http"
	"strconv"

	"clearledger/indexer/db"

	"github.com/go-chi/chi/v5"
)

// GET /invoices/{id}
func (h *APIHandler) HandleGetInvoiceByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing invoice id")
		return
	}

	invoice, err := h.getInvoiceByIDFn(r.Context(), id)
	if err != nil {
		// The raw DB error can disclose table/column names; log it and return
		// a generic message (issue #921).
		internalError(w, r, "failed to retrieve invoice", err)
		return
	}

	if invoice == nil {
		writeAPIError(w, r, http.StatusNotFound, "invoice not found")
		return
	}

	writeJSON(w, http.StatusOK, invoice)
}

// GET /invoices
func (h *APIHandler) HandleGetInvoices(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	issuer := r.URL.Query().Get("issuer")

	// Parse pagination params
	page := 1
	limit := 20

	if pageStr := r.URL.Query().Get("page"); pageStr != "" {
		if v, err := strconv.Atoi(pageStr); err == nil && v >= 1 {
			page = v
		} else {
			writeAPIError(w, r, http.StatusBadRequest, "invalid page parameter: must be a positive integer")
			return
		}
	}

	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v >= 1 {
			if v > 100 {
				limit = 100
			} else {
				limit = v
			}
		} else {
			writeAPIError(w, r, http.StatusBadRequest, "invalid limit parameter: must be a positive integer")
			return
		}
	}

	offset := (page - 1) * limit

	invoices, total, err := db.GetInvoicesPage(r.Context(), status, issuer, limit, offset)
	if err != nil {
		// The raw DB error can disclose table/column names; log it and return
		// a generic message (issue #921).
		internalError(w, r, "failed to retrieve invoices", err)
		return
	}

	// Ensure data is always a JSON array, never null
	if invoices == nil {
		invoices = []*db.DbInvoice{}
	}

	totalPages := (total + limit - 1) / limit
	if totalPages < 1 {
		totalPages = 1
	}

	resp := map[string]interface{}{
		"data":       invoices,
		"total":      total,
		"page":       page,
		"limit":      limit,
		"totalPages": totalPages,
	}

	writeJSON(w, http.StatusOK, resp)
}
