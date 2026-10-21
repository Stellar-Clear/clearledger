package api

import (
	"encoding/base64"
	"encoding/json"
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
	buyer := r.URL.Query().Get("buyer")
	var dueDate *int64
	if dueDateString := r.URL.Query().Get("due_date"); dueDateString != "" {
		value, err := strconv.ParseInt(dueDateString, 10, 64)
		if err != nil {
			http.Error(w, "invalid due_date parameter: must be a Unix timestamp", http.StatusBadRequest)
			return
		}
		dueDate = &value
	}

	// Parse pagination params
	page := 1
	limit := 20
	var cursor *db.InvoiceCursor
	if cursorToken := r.URL.Query().Get("cursor"); cursorToken != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursorToken)
		if err != nil || len(cursorToken) > 256 || json.Unmarshal(decoded, &cursor) != nil || cursor == nil || cursor.ID == "" || len(cursor.ID) > 64 {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}
		if r.URL.Query().Get("page") != "" {
			http.Error(w, "cursor cannot be combined with page", http.StatusBadRequest)
			return
		}
	}

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
	if page > 1 && offset/limit != page-1 {
		http.Error(w, "page parameter is too large", http.StatusBadRequest)
		return
	}

	invoices, total, hasMore, err := h.getInvoicesPageFn(r.Context(), status, issuer, buyer, dueDate, limit, offset, cursor)
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

	nextCursor := ""
	if hasMore && len(invoices) > 0 {
		last := invoices[len(invoices)-1]
		encoded, err := json.Marshal(db.InvoiceCursor{CreatedAt: last.CreatedAt, ID: last.ID})
		if err != nil {
			internalError(w, r, "failed to encode invoice cursor", err)
			return
		}
		nextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}

	resp := map[string]interface{}{
		"data":        invoices,
		"total":       total,
		"page":        page,
		"limit":       limit,
		"totalPages":  totalPages,
		"next_cursor": nextCursor,
	}

	writeJSON(w, http.StatusOK, resp)
}
