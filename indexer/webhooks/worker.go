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
	headers := signingHeaders(
		delivery.EndpointSecret,
		delivery.EndpointPreviousSecret,
		delivery.EndpointPreviousSecretExpiresAt,
		delivery.Payload,
		time.Now(),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, delivery.EndpointURL, bytes.NewReader(delivery.Payload))
	if err != nil {
		w.handleFailure(ctx, delivery, nil, fmt.Sprintf("build request: %v", err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		req.Header.Set(name, value)
	}

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
		slog.Info("webhook worker: delivered", "delivery_id", delivery.ID, "endpoint", delivery.EndpointURL, "status", resp.StatusCode)
		return
	}

	sc := resp.StatusCode
	w.handleFailure(ctx, delivery, &sc, fmt.Sprintf("non-2xx response: %d", sc))
}

// handleFailure processes a failed delivery attempt, scheduling retry or dead-lettering.
func (w *DeliveryWorker) handleFailure(ctx context.Context, delivery *db.WebhookDelivery, statusCode *int, errMsg string) {
	writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	nextAttempt := delivery.Attempts + 1
	slog.Warn("webhook worker: delivery failed",
		"delivery_id", delivery.ID,
		"attempt", nextAttempt,
		"max_attempts", delivery.MaxAttempts,
		"endpoint", delivery.EndpointURL,
		"error", errMsg,
	)

	if nextAttempt >= delivery.MaxAttempts {
		if err := db.MarkDeliveryDeadLetter(writeCtx, delivery.ID, errMsg); err != nil {
			slog.Error("webhook worker: mark dead_letter failed", "delivery_id", delivery.ID, "error", err)
		}
		slog.Error("webhook worker: delivery dead-lettered", "delivery_id", delivery.ID, "endpoint", delivery.EndpointURL)
		return
	}

	// Exponential backoff: backoffBase * 2^nextAttempt, so 20s, 40s, 80s and
	// 160s after failed attempts 1-4. The failure that reaches max_attempts
	// (the 5th by default) is dead-lettered above without a delay.
	delay := backoffBase * (1 << uint(nextAttempt))
	nextAt := time.Now().Add(delay)
	if err := db.MarkDeliveryRetry(writeCtx, delivery.ID, nextAt, statusCode, errMsg); err != nil {
		slog.Error("webhook worker: mark retry failed", "delivery_id", delivery.ID, "error", err)
	}
}

const (
	backoffBase = 10 * time.Second
)

// sign returns the HMAC-SHA256 hex digest of "<timestamp>.<payload>".
func sign(secret, timestamp string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}
