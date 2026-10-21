package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"clearledger/indexer/db"
)

// WorkerConfig holds configuration for the webhook delivery worker.
type WorkerConfig struct {
	PollInterval time.Duration
	BatchSize    int
	HTTPTimeout  time.Duration
	MaxAttempts  int
	// Concurrency is how many deliveries one batch attempts in parallel. Serial
	// delivery let a single unresponsive subscriber hold up every other endpoint
	// in the batch (batch size x HTTP timeout per tick).
	Concurrency int
	// LockDuration is how long a claimed delivery row is held exclusively by
	// this worker. It must exceed HTTPTimeout so an in-flight attempt is never
	// picked up by a second worker.
	LockDuration time.Duration
}

const (
	defaultConcurrency  = 8
	defaultLockDuration = 60 * time.Second
)

// DefaultWorkerConfig returns sensible defaults for the webhook worker.
func DefaultWorkerConfig() WorkerConfig {
	return WorkerConfig{
		PollInterval: 5 * time.Second,
		BatchSize:    50,
		HTTPTimeout:  10 * time.Second,
		MaxAttempts:  5,
		Concurrency:  defaultConcurrency,
		LockDuration: defaultLockDuration,
	}
}

// DeliveryWorker processes webhook deliveries from the database queue.
// It runs as a background goroutine, claiming batches of pending deliveries and
// attempting HTTP POST to subscriber URLs with HMAC-SHA256 signatures from a
// bounded pool of workers that share one connection-reusing http.Client.
type DeliveryWorker struct {
	cfg WorkerConfig
	// client is shared by every attempt so TCP/TLS connections are reused
	// across deliveries instead of paying a fresh handshake per delivery.
	client *http.Client
	// attempt is the per-delivery seam. It exists so the bounded fan-out can be
	// tested without a database; NewDeliveryWorker always wires it to
	// attemptDelivery.
	attempt func(context.Context, *db.WebhookDelivery)
}

// NewDeliveryWorker creates a new webhook delivery worker. Zero-valued
// concurrency and lock settings fall back to the defaults, because a pool of
// zero workers would claim batches it could never attempt.
func NewDeliveryWorker(cfg WorkerConfig) *DeliveryWorker {
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = defaultConcurrency
	}
	if cfg.LockDuration <= 0 {
		cfg.LockDuration = defaultLockDuration
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.HTTPTimeout > 0 {
		transport.ResponseHeaderTimeout = cfg.HTTPTimeout
	}
	w := &DeliveryWorker{
		cfg: cfg,
		client: &http.Client{
			Timeout:   cfg.HTTPTimeout,
			Transport: transport,
		},
	}
	w.attempt = w.attemptDelivery
	return w
}

// Start begins the worker's delivery loop. It blocks until ctx is cancelled.
func (w *DeliveryWorker) Start(ctx context.Context) error {
	slog.Info("Starting webhook delivery worker",
		"poll_interval", w.cfg.PollInterval,
		"batch_size", w.cfg.BatchSize,
		"concurrency", w.cfg.Concurrency,
		"lock_duration", w.cfg.LockDuration,
	)

	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("Webhook delivery worker stopping")
			return ctx.Err()
		case <-ticker.C:
			w.processBatch(ctx)
		}
	}
}

// processBatch claims a batch of pending deliveries and attempts them from a
// bounded worker pool. The batch is awaited before returning so at most one
// batch is in flight per worker instance even when a tick fires while a slow
// endpoint is still being tried.
func (w *DeliveryWorker) processBatch(ctx context.Context) {
	deliveries, err := db.ClaimPendingDeliveries(ctx, w.cfg.BatchSize, w.cfg.LockDuration)
	if err != nil {
		slog.Error("webhook worker: claim pending deliveries failed", "error", err)
		return
	}

	if len(deliveries) == 0 {
		return
	}

	slog.Debug("webhook worker: processing batch", "count", len(deliveries))
	w.deliverBatch(ctx, deliveries)
}

// deliverBatch attempts the claimed deliveries from a bounded worker pool.
func (w *DeliveryWorker) deliverBatch(ctx context.Context, deliveries []*db.WebhookDelivery) {
	// A slot per concurrent attempt: the send loop blocks once Concurrency
	// deliveries are in flight, so no batch can fan out into unbounded
	// goroutines or DB connections.
	slots := make(chan struct{}, w.cfg.Concurrency)
	var wg sync.WaitGroup
	for _, delivery := range deliveries {
		if ctx.Err() != nil {
			break
		}
		slots <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			w.attempt(ctx, delivery)
		}()
	}
	wg.Wait()
}

// attemptDelivery performs a single HTTP delivery attempt with signing.
func (w *DeliveryWorker) attemptDelivery(ctx context.Context, delivery *db.WebhookDelivery) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	sig := sign(delivery.EndpointSecret, ts, delivery.Payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, delivery.EndpointURL, bytes.NewReader(delivery.Payload))
	if err != nil {
		w.handleFailure(ctx, delivery, nil, fmt.Sprintf("build request: %v", err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClearLedger-Timestamp", ts)
	req.Header.Set("X-ClearLedger-Signature", "sha256="+sig)

	resp, err := w.client.Do(req)
	if err != nil {
		w.handleFailure(ctx, delivery, nil, fmt.Sprintf("http: %v", err))
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	bodyStr := string(body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if dbErr := db.MarkDeliverySuccess(writeCtx, delivery.ID, resp.StatusCode, bodyStr); dbErr != nil {
			slog.Error("webhook worker: mark success failed", "delivery_id", delivery.ID, "error", dbErr)
		}
		// The delivery URL may contain provider credentials, so logs identify
		// the subscription instead of echoing the endpoint.
		slog.Info("webhook worker: delivered", "delivery_id", delivery.ID, "subscription_id", delivery.SubscriptionID, "status", resp.StatusCode)
		return
	}

	sc := resp.StatusCode
	w.handleFailure(ctx, delivery, &sc, failureReason(sc))
}

// failureReason is deliberately limited to the HTTP status. Subscriber
// response bodies are untrusted and may contain credentials or arbitrary
// binary data, so they are never copied into last_error.
func failureReason(statusCode int) string {
	return fmt.Sprintf("non-2xx response: %d", statusCode)
}

// handleFailure processes a failed delivery attempt, scheduling retry or dead-lettering.
func (w *DeliveryWorker) handleFailure(ctx context.Context, delivery *db.WebhookDelivery, statusCode *int, errMsg string) {
	writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Never persist (or log) the endpoint URL or signing secret. Transport
	// errors from net/http embed the request URL, which may carry an API key.
	errMsg = db.SanitizeDeliveryError(errMsg, delivery.EndpointURL, delivery.EndpointSecret)
	attemptsMade := deliveryAttempts(delivery)
	maxAttempts := effectiveMaxAttempts(delivery, w.cfg.MaxAttempts)
	nextAttempt := attemptsMade + 1
	slog.Warn("webhook worker: delivery failed",
		"delivery_id", delivery.ID,
		"subscription_id", delivery.SubscriptionID,
		"attempt", nextAttempt,
		"max_attempts", maxAttempts,
		"error", errMsg,
	)

	if nextAttempt >= maxAttempts {
		if err := db.MarkDeliveryDeadLetterWithStatusIfAttempt(writeCtx, delivery.ID, attemptsMade, statusCode, errMsg); err != nil {
			slog.Error("webhook worker: mark dead_letter failed", "delivery_id", delivery.ID, "error", err)
		}
		slog.Error("webhook worker: delivery dead-lettered", "delivery_id", delivery.ID, "subscription_id", delivery.SubscriptionID)
		return
	}

	nextAt := time.Now().Add(backoffDelay(nextAttempt))
	if err := db.MarkDeliveryRetryIfAttempt(writeCtx, delivery.ID, attemptsMade, nextAt, statusCode, errMsg); err != nil {
		slog.Error("webhook worker: mark retry failed", "delivery_id", delivery.ID, "error", err)
	}
}

const (
	backoffBase = 10 * time.Second
	maxBackoff  = 15 * time.Minute
)

// deliveryAttempts reads the persisted attempt count, tolerating callers that
// only populated the legacy field (the claiming query keeps both equal).
func deliveryAttempts(delivery *db.WebhookDelivery) int {
	if delivery.AttemptCount > delivery.Attempts {
		return delivery.AttemptCount
	}
	return delivery.Attempts
}

// effectiveMaxAttempts applies the configured fallback and the hard bound. A
// malformed row (max_attempts <= 0) must not turn a delivery into an infinite
// retry loop.
func effectiveMaxAttempts(delivery *db.WebhookDelivery, fallback int) int {
	maxAttempts := delivery.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = fallback
	}
	if maxAttempts <= 0 {
		maxAttempts = DefaultWorkerConfig().MaxAttempts
	}
	if maxAttempts > db.MaxDeliveryAttempts {
		maxAttempts = db.MaxDeliveryAttempts
	}
	return maxAttempts
}

// backoffDelay returns the bounded exponential delay before retry
// nextAttempt: 20s, 40s, 80s, 160s, ... capped at maxBackoff. The cap keeps a
// long-lived row's schedule finite even if its max_attempts is raised.
func backoffDelay(nextAttempt int) time.Duration {
	if nextAttempt <= 0 {
		return backoffBase
	}
	if nextAttempt >= 32 {
		return maxBackoff
	}
	delay := backoffBase * (1 << uint(nextAttempt))
	if delay <= 0 || delay > maxBackoff {
		return maxBackoff
	}
	return delay
}

// sign returns the HMAC-SHA256 hex digest of "<timestamp>.<payload>".
func sign(secret, timestamp string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}
