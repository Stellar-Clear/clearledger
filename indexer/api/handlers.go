package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"clearledger/indexer/config"
	"clearledger/indexer/db"
	"clearledger/indexer/soroban"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type APIHandler struct {
	cfg             *config.Config
	serverKP        *keypair.Full
	statsMu         sync.RWMutex
	statsData       *db.ProtocolStats
	statsCached     time.Time
	challengeMu     sync.Mutex
	usedChallenges  map[string]time.Time
	listenerHealth  *ListenerHealth
	dbHealthChecker func(context.Context) error

	// dependency-injectable storage and contract readers. Defaults are wired
	// in NewAPIHandler so production behavior is unchanged; tests in this
	// package can override individual fields to avoid requiring a live DB
	// or Soroban RPC.
	getInvoiceByIDFn      func(context.Context, string) (*db.DbInvoice, error)
	getPoolStatsFn        func(context.Context) (*db.DbPoolStats, error)
	getPoolSnapshotsFn    func(context.Context, int) ([]*db.DbPoolSnapshotHistory, error)
	getRecentEventsFn     func(context.Context, int) ([]*db.EventLog, error)
	getRecentEventsPageFn func(context.Context, int, int64, int) ([]*db.EventLog, error)
	getProtocolStatsFn    func(context.Context) (*db.ProtocolStats, error)
	readContractFn        func(ctx context.Context, rpcURL string, contractID string, method string, args []xdr.ScVal, serverKP *keypair.Full) (xdr.ScVal, error)
}

func NewAPIHandler(cfg *config.Config) (*APIHandler, error) {
	kp, err := GetServerKeypair(cfg.ServerSeed)
	if err != nil {
		return nil, fmt.Errorf("invalid server seed: %w", err)
	}
	return &APIHandler{
		cfg:             cfg,
		serverKP:        kp,
		listenerHealth:  NewListenerHealth(),
		usedChallenges:  make(map[string]time.Time),
		dbHealthChecker: defaultDBHealthChecker,
		getInvoiceByIDFn: func(ctx context.Context, id string) (*db.DbInvoice, error) {
			return db.GetInvoiceByID(ctx, db.Pool, id)
		},
		getPoolStatsFn:        db.GetPoolStats,
		getPoolSnapshotsFn:    db.GetPoolSnapshotHistory,
		getRecentEventsFn:     db.GetRecentEvents,
		getRecentEventsPageFn: db.GetRecentEventsPage,
		getProtocolStatsFn:    db.GetProtocolStats,
		readContractFn:        soroban.ReadContract,
	}, nil
}

// claimChallenge prevents a verified SEP-10 transaction from minting more
// than one session on this API process. Expired fingerprints are discarded so
// the replay cache remains bounded by the challenge lifetime.
func (h *APIHandler) claimChallenge(transaction string) bool {
	fingerprint := sha256.Sum256([]byte(transaction))
	key := hex.EncodeToString(fingerprint[:])
	now := time.Now()
	h.challengeMu.Lock()
	defer h.challengeMu.Unlock()
	for used, expiresAt := range h.usedChallenges {
		if !now.Before(expiresAt) {
			delete(h.usedChallenges, used)
		}
	}
	if _, exists := h.usedChallenges[key]; exists {
		return false
	}
	h.usedChallenges[key] = now.Add(15 * time.Minute)
	return true
}

func GetServerKeypair(seed string) (*keypair.Full, error) {
	if strings.TrimSpace(seed) == "" {
		return nil, fmt.Errorf("empty server seed")
	}
	return keypair.ParseFull(seed)
}

// writeJSON sets the Content-Type header, writes the status code, encodes v as
// JSON, and logs any encoding error at WARN level.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("failed to encode JSON response", "error", err)
	}
}

// httpError pairs a client-facing message with the status code it should be
// served under. It lets the handler helpers in this package report failures
// without holding a http.ResponseWriter, which keeps them unit-testable.
type httpError struct {
	status  int
	message string
}

type apiErrorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	RequestID string `json:"request_id,omitempty"`
}

func apiErrorCode(status int) string {
	switch status {
	case http.StatusBadRequest, http.StatusRequestEntityTooLarge:
		return "bad_request"
	case http.StatusUnauthorized, http.StatusForbidden:
		return "unauthorized"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusTooManyRequests:
		return "rate_limited"
	case http.StatusGatewayTimeout, http.StatusRequestTimeout:
		return "timeout"
	case http.StatusServiceUnavailable:
		return "service_unavailable"
	default:
		if status >= http.StatusInternalServerError {
			return "internal_error"
		}
		return "request_failed"
	}
}

func writeAPIError(w http.ResponseWriter, r *http.Request, status int, message string) {
	var body apiErrorBody
	body.Error.Code = apiErrorCode(status)
	body.Error.Message = message
	if r != nil {
		body.RequestID = middleware.GetReqID(r.Context())
	}
	writeJSON(w, status, body)
}

func (e *httpError) Error() string { return e.message }

// Status returns the HTTP status code this error should be served under.
func (e *httpError) Status() int { return e.status }

// httpErrorf builds an httpError with a formatted message.
func httpErrorf(status int, format string, args ...interface{}) *httpError {
	return &httpError{status: status, message: fmt.Sprintf(format, args...)}
}

// internalError logs the full error server-side and responds with a generic,
// client-safe message. Raw error text from the database, Soroban RPC or any
// other backend can disclose internals (table and constraint names,
// connection strings, or an RPC URL carrying a provider API key), so it must
// never reach the response body — operators correlate via the request ID and
// the log entry instead.
func internalError(w http.ResponseWriter, r *http.Request, msg string, err error) {
	slog.ErrorContext(r.Context(), msg,
		"error", err,
		"request_id", middleware.GetReqID(r.Context()),
		"method", r.Method,
		"path", r.URL.Path,
	)
	writeAPIError(w, r, http.StatusInternalServerError, msg)
}

// writeHTTPError serves err as a plain-text error response, using the status
// code carried by an *httpError. Only httpError values reach the client; any
// other error is a potential leak of backend internals, so it is logged and
// answered with a generic 500 message instead of err.Error().
func writeHTTPError(w http.ResponseWriter, r *http.Request, err error) {
	var he *httpError
	if errors.As(err, &he) {
		writeAPIError(w, r, he.status, he.message)
		return
	}
	internalError(w, r, "internal server error", err)
}

func (h *APIHandler) ListenerHealth() *ListenerHealth {
	if h.listenerHealth == nil {
		h.listenerHealth = NewListenerHealth()
	}
	return h.listenerHealth
}

func (h *APIHandler) CheckHealth(ctx context.Context) error {
	if h.dbHealthChecker != nil {
		if err := h.dbHealthChecker(ctx); err != nil {
			return fmt.Errorf("database health check failed: %w", err)
		}
	}
	if h.ListenerHealth() != nil && !h.ListenerHealth().IsHealthy() {
		return fmt.Errorf("listener is not healthy")
	}
	return nil
}
