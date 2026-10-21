package api

import (
	"context"
	"fmt"
	"sync"
	"time"

	"clearledger/indexer/db"
	"clearledger/indexer/soroban"
	"github.com/prometheus/client_golang/prometheus"
)

// ListenerHealth tracks whether the background listener is still alive.
type ListenerHealth struct {
	mu            sync.RWMutex
	running       bool
	stopped       bool
	lastHeartbeat time.Time
	Lag           int
}

var LedgerLag = prometheus.NewGauge(prometheus.GaugeOpts{
	Name: "stellar_ledger_lag",
	Help: "Ledger lag between horizon and local.",
})

func init() {
	prometheus.MustRegister(LedgerLag)
}

func NewListenerHealth() *ListenerHealth {
	return &ListenerHealth{}
}

func (h *ListenerHealth) MarkStarted() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.running = true
	h.stopped = false
	h.lastHeartbeat = time.Now()
}

func (h *ListenerHealth) MarkHeartbeat() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopped {
		return
	}
	h.running = true
	h.lastHeartbeat = time.Now()
}

func (h *ListenerHealth) MarkStopped() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.running = false
	h.stopped = true
	h.lastHeartbeat = time.Time{}
}

func (h *ListenerHealth) IsHealthy() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.stopped {
		return false
	}
	return h.running && !h.lastHeartbeat.IsZero()
}

func defaultDBHealthChecker(ctx context.Context) error {
	if db.Pool == nil {
		return fmt.Errorf("database pool not initialized")
	}
	return db.Pool.Ping(ctx)
}

func defaultSorobanHealthChecker(rpcURL string) func(context.Context) error {
	return func(ctx context.Context) error {
		var result struct {
			LatestLedger int64 `json:"latestLedger"`
		}
		return soroban.CallSorobanRPC(ctx, rpcURL, "getLatestLedger", map[string]interface{}{}, &result)
	}
}
