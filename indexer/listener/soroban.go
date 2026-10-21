package listener

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"clearledger/indexer/api"
	"clearledger/indexer/config"
	"clearledger/indexer/db"
	"clearledger/indexer/soroban"

	"github.com/stellar/go-stellar-sdk/keypair"
)

// SorobanEvent represents a normalized event emitted by a Soroban contract
type SorobanEvent struct {
	ID             string   `json:"id"`
	ContractID     string   `json:"contractId"`
	Ledger         int32    `json:"ledger"`
	LedgerClosedAt string   `json:"ledgerClosedAt"`
	Topic          []string `json:"topic"`
	Value          string   `json:"value"` // base64-encoded ScVal XDR
}

// rpcEvent matches the Soroban RPC getEvents response structure
type rpcEvent struct {
	Type           string   `json:"type"`
	Ledger         int32    `json:"ledger"`
	LedgerClosedAt string   `json:"ledgerClosedAt"`
	ContractID     string   `json:"contractId"`
	ID             string   `json:"id"`
	PagingToken    string   `json:"pagingToken"`
	Topic          []string `json:"topic"`
	Value          struct {
		Xdr string `json:"xdr"`
	} `json:"value"`
}

type GetEventsResult struct {
	LatestLedger uint32     `json:"latestLedger"`
	Events       []rpcEvent `json:"events"`
	Cursor       string     `json:"cursor"`
}

type GetLatestLedgerResult struct {
	ID              string `json:"id"`
	Sequence        int32  `json:"sequence"`
	CloseTime       string `json:"closeTime"`
	ProtocolVersion int    `json:"protocolVersion"`
}

// LedgerHeader is the subset of a getLedgers result entry the listener needs
// to compare a ledger against a previously observed one.
type LedgerHeader struct {
	Hash     string `json:"hash"`
	Sequence int32  `json:"sequence"`
}

// GetLedgersParams mirrors the getLedgers request: it starts at startLedger
// and returns pages of headers (limit 1 is enough to fetch one ledger).
type GetLedgersParams struct {
	StartLedger int32             `json:"startLedger"`
	Pagination  *PaginationParams `json:"pagination,omitempty"`
}

// GetLedgersResult is the getLedgers response the listener consumes.
type GetLedgersResult struct {
	Ledgers []LedgerHeader `json:"ledgers"`
}

type EventFilter struct {
	Type        string   `json:"type"`
	ContractIDs []string `json:"contractIds,omitempty"`
	Topics      []string `json:"topics,omitempty"`
}

type PaginationParams struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

type GetEventsParams struct {
	StartLedger int32             `json:"startLedger"`
	Filters     []EventFilter     `json:"filters,omitempty"`
	Pagination  *PaginationParams `json:"pagination,omitempty"`
}

// WebhookDispatcher is the interface the listener uses to fan out events.
// The concrete implementation lives in the webhook package.
type WebhookDispatcher interface {
	// Dispatch fans out an event without any transaction (pool events and
	// other non-invoice fan-out paths). Failures are logged, not returned.
	Dispatch(ctx context.Context, eventType string, data map[string]interface{})

	// EnqueueDeliveries writes the webhook_deliveries rows for an event
	// through q so the listener can commit them atomically with the event's
	// state change (issue #925). It returns the first error encountered.
	EnqueueDeliveries(ctx context.Context, q db.Querier, eventType string, data map[string]interface{}) error
}

// Reorg exposure and how this listener guards against it (issue #882).
//
// Soroban RPC serves the current chain tip: getEvents and getLatestLedger can
// return ledgers that have only just closed, so "the RPC returned it" does not
// mean "it can no longer be reorganized". Stellar consensus offers fast
// *probabilistic* finality rather than absolute finality: a ledger accepted by
// a quorum can still be replaced by a different ledger at the same sequence if
// that quorum's view diverges (network partition, conflicting closes). The
// window is a few seconds in practice, but it is not zero, and no RPC provider
// documents serving only finalized history — exposure is therefore treated as
// real rather than assumed away. Three mechanisms cover it:
//
//  1. Confirmation depth (INDEXER_CONFIRMATION_DEPTH, default 3 ledgers, about
//     15s at the usual 5s close time): pollEvents only hands an event to
//     handleEvent once its ledger is at least `depth` ledgers behind the RPC's
//     latestLedger, and the checkpoint is never advanced past that boundary.
//     Ledgers inside the window are re-fetched on the next poll, where
//     events_log de-duplication re-checks them before anything is applied.
//  2. Ledger-hash verification: once a poll finalizes a boundary ledger, its
//     header hash (getLedgers) is recorded; every later poll re-reads that
//     hash before the checkpoint may advance again. A mismatch means a ledger
//     we already indexed was reorganized out of the chain.
//  3. Defined recovery action on mismatch: indexing halts. Start returns a
//     reorg error, which main logs and turns into a non-zero exit, instead of
//     checkpointing on top of a rewritten chain. Recovery is deliberately
//     manual: inspect events_log / invoices / pool_snapshots rows with ledger
//     >= the reported sequence, replay them from the authoritative chain, then
//     restart the listener.
//
// Assumptions and limits: hashes live in memory only (no schema change), so a
// reorg that happened while the process was down cannot be detected at startup
// — that would require persisting per-ledger hashes; the same applies to the
// short interval between fetching events and recording the boundary hash,
// which is exactly the gap the confirmation depth makes negligible. If the RPC
// has pruned the ledger being verified, verification degrades to a logged
// warning instead of a halt.
//
// EventListener runs Start on a single goroutine, so the verification state
// below needs no locking.
type EventListener struct {
	cfg        *config.Config
	health     *api.ListenerHealth
	dispatcher WebhookDispatcher

	// retryBackoff is the delay applied after the first failed poll. It
	// doubles on every consecutive failure up to maxRetryBackoff and resets
	// once a poll succeeds. Production leaves it at defaultRetryBackoff;
	// tests shorten it so the retry loop can be exercised quickly.
	retryBackoff time.Duration

	// dependency-injectable storage helpers. Defaults are wired in
	// NewEventListener so production behavior is unchanged; tests in this
	// package can override individual fields to avoid requiring a live DB
	// for the bookkeeping paths.
	getCheckpointFn            func(context.Context) (int32, error)
	getLatestProcessedLedgerFn func(context.Context) (int32, error)
	upsertCheckpointFn         func(context.Context, int32) error
	areEventsProcessedFn       func(context.Context, []string) (map[string]bool, error)
	getLedgerHashFn            func(context.Context, int32) (string, error)

	// finalizedLedger is the newest ledger the checkpoint has advanced past
	// (i.e. treated as final), and finalizedHash the header hash it had when
	// first observed. Both are verified against the RPC before the next
	// checkpoint write; zero finalizedLedger means nothing recorded yet.
	finalizedLedger int32
	finalizedHash   string
}

const (
	// defaultRetryBackoff is the initial delay before retrying a failed poll.
	defaultRetryBackoff = time.Second
	// maxRetryBackoff caps the exponential backoff between failed polls.
	maxRetryBackoff = 30 * time.Second
)

func NewEventListener(cfg *config.Config, health *api.ListenerHealth, dispatcher WebhookDispatcher) *EventListener {
	l := &EventListener{
		cfg:                        cfg,
		health:                     health,
		dispatcher:                 dispatcher,
		retryBackoff:               defaultRetryBackoff,
		getCheckpointFn:            db.GetCheckpoint,
		getLatestProcessedLedgerFn: db.GetLatestProcessedLedger,
		upsertCheckpointFn:         db.UpsertCheckpoint,
		areEventsProcessedFn:       db.AreEventsProcessed,
	}
	l.getLedgerHashFn = l.getLedgerHash
	return l
}

// getLedgerHash reads a single ledger header hash through Soroban RPC.
func (l *EventListener) getLedgerHash(ctx context.Context, sequence int32) (string, error) {
	params := GetLedgersParams{
		StartLedger: sequence,
		Pagination:  &PaginationParams{Limit: 1},
	}
	var res GetLedgersResult
	if err := soroban.CallSorobanRPC(ctx, l.cfg.SorobanRPCURL, "getLedgers", params, &res); err != nil {
		return "", fmt.Errorf("call getLedgers (sequence=%d): %w", sequence, err)
	}
	for _, header := range res.Ledgers {
		if header.Sequence == sequence {
			if header.Hash == "" {
				return "", fmt.Errorf("getLedgers returned an empty hash for ledger %d", sequence)
			}
			return header.Hash, nil
		}
	}
	return "", fmt.Errorf("ledger %d missing from getLedgers response", sequence)
}

// verifyFinalizedLedger re-reads the hash of the last ledger the checkpoint
// advanced past. A mismatch means that ledger was reorganized out of the chain
// after we indexed it, so a reorg error is returned: Start propagates it and
// the listener stops instead of writing a checkpoint derived from a rewritten
// chain. A transient RPC failure is only logged — absence of proof of a reorg
// must not halt indexing — and the check resumes on the next poll.
func (l *EventListener) verifyFinalizedLedger(ctx context.Context) error {
	if l.finalizedLedger <= 0 || l.finalizedHash == "" {
		return nil // nothing recorded yet (first poll or fresh start)
	}

	hash, err := l.getLedgerHashFn(ctx, l.finalizedLedger)
	if err != nil {
		slog.Warn("Ledger hash verification skipped",
			"ledger", l.finalizedLedger, "error", err)
		return nil
	}
	if hash != l.finalizedHash {
		return newReorgError(l.finalizedLedger, l.finalizedHash, hash)
	}
	return nil
}

// recordFinalizedLedger stores the header hash of the newest ledger the
// checkpoint has advanced past, so the next poll can detect a reorg of it.
// Failures are logged and leave the previous record in place (still valid to
// verify) rather than aborting the poll.
func (l *EventListener) recordFinalizedLedger(ctx context.Context, sequence int32) {
	if sequence <= l.finalizedLedger || sequence <= 0 {
		return
	}
	hash, err := l.getLedgerHashFn(ctx, sequence)
	if err != nil {
		slog.Warn("Could not record finalized ledger hash",
			"ledger", sequence, "error", err)
		return
	}
	l.finalizedLedger = sequence
	l.finalizedHash = hash
}

// newReorgError builds the halt-and-replay error for a detected ledger hash
// mismatch. The message carries the recovery steps because Start returning is
// the alert: main logs it and exits non-zero.
func newReorgError(sequence int32, expected, actual string) error {
	return fmt.Errorf(
		"reorg detected at ledger %d: hash changed from %s to %s after it was indexed; "+
			"halting the event listener so the checkpoint does not advance over a rewritten chain; "+
			"inspect events_log/invoices/pool_snapshots rows with ledger >= %d, "+
			"replay that range from the authoritative chain, then restart the listener",
		sequence, expected, actual, sequence)
}

func (l *EventListener) getLatestLedgerSequence(ctx context.Context) (int32, error) {
	var res GetLatestLedgerResult
	if err := soroban.CallSorobanRPC(ctx, l.cfg.SorobanRPCURL, "getLatestLedger", nil, &res); err != nil {
		return 0, fmt.Errorf("call getLatestLedger: %w", err)
	}
	return res.Sequence, nil
}

func (l *EventListener) Start(ctx context.Context) error {
	if l.health != nil {
		l.health.MarkStarted()
	}

	if l.cfg.ServerSeed == "" {
		return fmt.Errorf("ServerSeed is required when event listener is enabled")
	}
	if _, err := keypair.ParseFull(l.cfg.ServerSeed); err != nil {
		return fmt.Errorf("invalid ServerSeed configuration: %w", err)
	}

	// 1. Determine start ledger sequence
	// Prefer checkpoint for accurate resume across empty-ledger ranges
	currentLedger, err := l.getCheckpointFn(ctx)
	if err != nil {
		return fmt.Errorf("failed to get checkpoint: %w", err)
	}
	if currentLedger > 0 {
		slog.Info("Resuming event indexing from checkpoint", "startLedger", currentLedger)
	} else {
		// Fallback: use MAX(ledger) from events_log for backward compatibility
		startLedger, err := l.getLatestProcessedLedgerFn(ctx)
		if err != nil {
			return fmt.Errorf("failed to get latest processed ledger: %w", err)
		}
		if startLedger > 0 {
			currentLedger = startLedger + 1
			slog.Info("Resuming event indexing from events_log", "startLedger", currentLedger)
		} else {
			latest, err := l.getLatestLedgerSequence(ctx)
			if err != nil {
				return fmt.Errorf("failed to get latest ledger sequence: %w", err)
			}
			currentLedger = latest
			slog.Info("Starting event indexing from latest chain ledger", "startLedger", currentLedger)
		}
	}

	pollInterval := time.Duration(l.cfg.IndexerPollIntervalMs) * time.Millisecond
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	initialBackoff := l.retryBackoff
	if initialBackoff <= 0 {
		initialBackoff = defaultRetryBackoff
	}
	backoff := initialBackoff
	for {
		select {
		case <-ctx.Done():
			slog.Info("Event listener stopping...")
			if l.health != nil {
				l.health.MarkStopped()
			}
			return nil
		case <-ticker.C:
			// Reorg guard (issue #882): a ledger the checkpoint already
			// advanced past must still hash the same before anything new is
			// written on top of it. A mismatch returns a reorg error, which
			// halts the listener instead of indexing on a rewritten chain.
			if err := l.verifyFinalizedLedger(ctx); err != nil {
				if l.health != nil {
					l.health.MarkStopped()
				}
				return err
			}
			nextLedger, err := l.pollEvents(ctx, currentLedger)
			if err != nil {
				// A single Soroban RPC hiccup must not take down the
				// listener: report degraded health, back off, and retry.
				slog.Error("Error polling events; retrying with backoff", "error", err, "backoff", backoff)
				if l.health != nil {
					l.health.MarkStopped()
				}
				select {
				case <-ctx.Done():
					slog.Info("Event listener stopping...")
					return nil
				case <-time.After(backoff):
				}
				backoff *= 2
				if backoff > maxRetryBackoff {
					backoff = maxRetryBackoff
				}
				continue
			}
			// Persist before advancing in-memory state. If this write fails, the
			// next poll replays the same range; event-log uniqueness makes that
			// recovery safe after a restart or transient database failure.
			if err := l.upsertCheckpointFn(ctx, nextLedger); err != nil {
				slog.Error("Failed to save checkpoint; will replay ledger range", "ledger", nextLedger, "error", err)
				if l.health != nil {
					l.health.MarkStopped()
				}
				continue
			}

			backoff = initialBackoff
			currentLedger = nextLedger
			if l.health != nil {
				if l.health.IsHealthy() {
					l.health.MarkHeartbeat()
				} else {
					l.health.MarkStarted()
				}
			}

			// Remember the durable checkpoint boundary for the reorg guard.
			l.recordFinalizedLedger(ctx, currentLedger-1)
		}
	}
}

func (l *EventListener) pollEvents(ctx context.Context, startLedger int32) (int32, error) {
	var contractIDs []string
	if l.cfg.RegistryContractID != "" {
		contractIDs = append(contractIDs, l.cfg.RegistryContractID)
	}
	if l.cfg.InvoiceContractID != "" {
		contractIDs = append(contractIDs, l.cfg.InvoiceContractID)
	}
	if l.cfg.PoolContractID != "" {
		contractIDs = append(contractIDs, l.cfg.PoolContractID)
	}
	if l.cfg.EscrowContractID != "" {
		contractIDs = append(contractIDs, l.cfg.EscrowContractID)
	}

	if len(contractIDs) == 0 {
		slog.Warn("No contract IDs configured for indexing. Advancing start ledger sequence to chain tip.")
		latest, err := l.getLatestLedgerSequence(ctx)
		if err != nil {
			return startLedger, err
		}
		api.SetListenerLedgerMetrics(latest, startLedger-1)
		return latest + 1, nil
	}

	filters := []EventFilter{{Type: "contract", ContractIDs: contractIDs}}
	cursor := ""
	var latestLedgerSeq int32
	depth := l.confirmationDepth()
	for {
		params := GetEventsParams{
			StartLedger: startLedger,
			Filters:     filters,
			Pagination:  &PaginationParams{Limit: 100, Cursor: cursor},
		}
		var res GetEventsResult
		if err := soroban.CallSorobanRPC(ctx, l.cfg.SorobanRPCURL, "getEvents", params, &res); err != nil {
			return startLedger, fmt.Errorf("call getEvents (startLedger=%d, cursor=%s): %w", startLedger, cursor, err)
		}
		if res.LatestLedger != 0 {
			latestLedgerSeq = int32(res.LatestLedger)
		}
		if len(res.Events) == 0 {
			break
		}

		// Confirmation-depth buffer (issue #882): an event from a ledger that
		// has not aged `confirmationDepth` ledgers past the RPC tip is not
		// final yet, so it is deferred. The next poll restarts at
		// safeLedger+1 and re-fetches the window, where events_log
		// de-duplication decides what is still new. Later pages only contain
		// newer ledgers, so an entirely deferred page ends this poll.
		pending := res.Events
		if depth > 0 && latestLedgerSeq > 0 {
			safeLedger := latestLedgerSeq - int32(depth)
			confirmed := make([]rpcEvent, 0, len(res.Events))
			for _, ev := range res.Events {
				if ev.Ledger <= safeLedger {
					confirmed = append(confirmed, ev)
				}
			}
			pending = confirmed
			if len(pending) == 0 {
				slog.Debug("Deferring events until they clear the confirmation window",
					"startLedger", startLedger, "latestLedger", latestLedgerSeq,
					"confirmationDepth", depth)
				break
			}
		}

		// One de-duplication query per getEvents page instead of one per event.
		// A failed lookup is fatal for this poll: `processed` would be unknown,
		// and re-applying already-indexed events is exactly what de-duplication
		// exists to prevent. Returning the error makes Start back off and retry
		// the same ledger range instead of double-applying.
		ids := make([]string, len(pending))
		for i, ev := range pending {
			ids[i] = ev.ID
		}
		processed, err := l.areEventsProcessedFn(ctx, ids)
		if err != nil {
			return startLedger, fmt.Errorf("check processed events (startLedger=%d, cursor=%s): %w", startLedger, cursor, err)
		}

		for _, ev := range pending {
			if processed[ev.ID] {
				continue
			}

			sorobanEv := SorobanEvent{
				ID:             ev.ID,
				ContractID:     ev.ContractID,
				Ledger:         ev.Ledger,
				LedgerClosedAt: ev.LedgerClosedAt,
				Topic:          ev.Topic,
				Value:          ev.Value.Xdr,
			}

			// Once an event has entered processing, cancellation only stops new
			// polls; the transaction and webhook enqueue may finish atomically.
			if err := l.handleEvent(context.WithoutCancel(ctx), sorobanEv); err != nil {
				return startLedger, fmt.Errorf("handle event %s: %w", sorobanEv.ID, err)
			}
		}
		if res.Cursor != "" {
			cursor = res.Cursor
		} else {
			break
		}
	}

	if latestLedgerSeq < startLedger {
		return startLedger, nil
	}
	next := latestLedgerSeq + 1
	if depth > 0 {
		// The checkpoint may never pass the newest ledger that cleared the
		// confirmation window; when none has, retry the same range next poll
		// instead of checkpointing ledgers that could still be reorganized.
		safeLedger := latestLedgerSeq - int32(depth)
		if safeLedger < startLedger {
			return startLedger, nil
		}
		next = safeLedger + 1
	}
	api.SetListenerLedgerMetrics(latestLedgerSeq, next-1)
	return next, nil
}

// confirmationDepth is how many ledgers behind the RPC tip an event's ledger
// must be before it is treated as final. It is read from
// INDEXER_CONFIRMATION_DEPTH (clamped at load time); an unset or zero value
// disables the buffer, which is also what an unset config.Config produces, so
// existing tests and deployments keep their prior behavior.
func (l *EventListener) confirmationDepth() int {
	if l.cfg == nil || l.cfg.IndexerConfirmationDepth <= 0 {
		return 0
	}
	return l.cfg.IndexerConfirmationDepth
}
