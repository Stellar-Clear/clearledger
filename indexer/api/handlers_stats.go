package api

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"clearledger/indexer/db"
	"clearledger/indexer/soroban"
	"clearledger/indexer/xdrutil"

	"github.com/go-chi/chi/v5"
	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/xdr"
)

// GET /stats
func (h *APIHandler) HandleGetStats(w http.ResponseWriter, r *http.Request) {
	// Try to read the cache with a read lock
	h.statsMu.RLock()
	if h.statsData != nil && time.Since(h.statsCached) < 30*time.Second {
		data := h.statsData
		h.statsMu.RUnlock()
		writeJSON(w, http.StatusOK, data)
		return
	}
	h.statsMu.RUnlock()

	// Cache is missing or expired, we need to update it.
	// Take a write lock (but first we must release the read lock, which we did above).
	h.statsMu.Lock()
	// Double-check the cache after acquiring the write lock.
	if h.statsData != nil && time.Since(h.statsCached) < 30*time.Second {
		data := h.statsData
		h.statsMu.Unlock()
		writeJSON(w, http.StatusOK, data)
		return
	}

	// Cache is still invalid, fetch from DB and update.
	stats, err := h.getProtocolStatsFn(r.Context())
	if err != nil {
		h.statsMu.Unlock()
		// The raw DB error can disclose table/column names; log it and return
		// a generic message (issue #921).
		internalError(w, r, "failed to retrieve protocol stats", err)
		return
	}

	h.statsData = stats
	h.statsCached = time.Now()
	h.statsMu.Unlock()

	writeJSON(w, http.StatusOK, stats)
}

// GET /pool/stats
func (h *APIHandler) HandleGetPoolStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.getPoolStatsFn(r.Context())
	if err != nil {
		// The raw DB error can disclose table/column names; log it and return
		// a generic message (issue #921).
		internalError(w, r, "failed to retrieve pool statistics", err)
		return
	}

	if stats == nil {
		stats = &db.DbPoolStats{
			TotalDeposits:         "0",
			TotalFunded:           "0",
			AvailableLiquidity:    "0",
			UtilizationRateBps:    0,
			TotalYieldDistributed: "0",
			ActiveInvoiceCount:    0,
			UpdatedAt:             time.Now(),
		}
	}

	writeJSON(w, http.StatusOK, stats)
}

// GET /events
func (h *APIHandler) HandleGetEvents(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 {
			http.Error(w, "invalid limit parameter: must be a positive integer", http.StatusBadRequest)
			return
		}
		limit = parsed
		if limit > 100 {
			limit = 100
		}
	}

	var events []*db.EventLog
	var err error
	if encoded := r.URL.Query().Get("cursor"); encoded != "" {
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(encoded)
		stamp, idText, ok := strings.Cut(string(decoded), ":")
		if decodeErr != nil || !ok {
			http.Error(w, "invalid cursor parameter", http.StatusBadRequest)
			return
		}
		timestamp, timeErr := strconv.ParseInt(stamp, 10, 64)
		id, idErr := strconv.Atoi(idText)
		if timeErr != nil || idErr != nil || id < 1 {
			http.Error(w, "invalid cursor parameter", http.StatusBadRequest)
			return
		}
		events, err = h.getRecentEventsPageFn(r.Context(), limit+1, timestamp, id)
	} else {
		events, err = h.getRecentEventsFn(r.Context(), limit+1)
	}
	if err != nil {
		// The raw DB error can disclose table/column names; log it and return
		// a generic message (issue #921).
		internalError(w, r, "failed to retrieve events", err)
		return
	}

	if events == nil {
		events = []*db.EventLog{}
	}
	if len(events) > limit {
		last := events[limit-1]
		cursor := base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(last.LedgerClosedAt, 10) + ":" + strconv.Itoa(last.ID)))
		w.Header().Set("X-Next-Cursor", cursor)
		events = events[:limit]
	}

	writeJSON(w, http.StatusOK, events)
}

// GET /pool/snapshots
func (h *APIHandler) HandleGetPoolSnapshots(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if s := r.URL.Query().Get("limit"); s != "" {
		if parsed, err := strconv.Atoi(s); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	history, err := h.getPoolSnapshotsFn(r.Context(), limit)
	if err != nil {
		internalError(w, r, "failed to retrieve pool snapshots", err)
		return
	}

	// Response shape matches apps/web/types/index.ts PoolSnapshot:
	// { timestamp, utilizationRateBps, totalYieldDistributed }
	type poolSnapshot struct {
		Timestamp             int64  `json:"timestamp"`
		UtilizationRateBps    int    `json:"utilizationRateBps"`
		TotalYieldDistributed string `json:"totalYieldDistributed"`
	}

	snapshots := make([]poolSnapshot, 0, len(history))
	for _, h := range history {
		snapshots = append(snapshots, poolSnapshot{
			Timestamp:             h.RecordedAt,
			UtilizationRateBps:    h.UtilizationRateBps,
			TotalYieldDistributed: h.TotalYieldDistributed,
		})
	}

	writeJSON(w, http.StatusOK, snapshots)
}

// GET /pool/position/{address}
func (h *APIHandler) HandleGetLPPosition(w http.ResponseWriter, r *http.Request) {
	address := chi.URLParam(r, "address")
	if address == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing address parameter")
		return
	}

	if _, err := keypair.Parse(address); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid address format")
		return
	}

	addrVal, err := soroban.MakeAddressScVal(address)
	if err != nil {
		internalError(w, r, "failed to build address ScVal", err)
		return
	}

	scValResult, err := h.readContractFn(r.Context(), h.cfg.SorobanRPCURL, h.cfg.PoolContractID, "get_lp_position", []xdr.ScVal{addrVal}, h.serverKP)
	if err != nil {
		// The RPC error can embed the full RPC URL (and any API key in it);
		// log it and return a generic message (issue #921).
		internalError(w, r, "failed to read LP position from pool", err)
		return
	}

	shares := "0"
	usdcValue := "0"
	yieldEarned := "0"
	depositCount := 0

	if val, ok := xdrutil.GetMapVal(scValResult, "shares"); ok {
		shares = xdrutil.ParseU128(val)
	}
	if val, ok := xdrutil.GetMapVal(scValResult, "usdc_value"); ok {
		usdcValue = xdrutil.ParseU128(val)
	}
	if val, ok := xdrutil.GetMapVal(scValResult, "yield_earned"); ok {
		yieldEarned = xdrutil.ParseU128(val)
	}
	if val, ok := xdrutil.GetMapVal(scValResult, "deposit_count"); ok {
		depositCount = int(xdrutil.ParseU32(val))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"shares":        shares,
		"usdc_value":    usdcValue,
		"yield_earned":  yieldEarned,
		"deposit_count": depositCount,
	})
}
