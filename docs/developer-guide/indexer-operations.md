# Indexer Operations: Recovery, Backfill, and Webhook Replay

Operational runbook for the Go indexer: the Soroban event listener, PostgreSQL
checkpoint/event tables, and the webhook delivery queue. It covers RPC outages,
database restores, ledger gaps, and failed subscriber endpoints.

> **Testnet only.** ClearLedger is a Stellar Testnet prototype. This runbook
> makes no Mainnet availability, finality, or data-loss guarantees. Testnet can
> reset or reorganize, RPC providers prune history, and delivery is not
> exactly-once. Do not use these procedures for real funds.

## 1. Code and state to know

| Concern | Source | Key names |
| --- | --- | --- |
| Listener, checkpointing, reorg guard | [`indexer/listener/soroban.go`](../../indexer/listener/soroban.go) | `EventListener.Start`, `pollEvents`, `verifyFinalizedLedger` |
| Event application/dedupe | [`indexer/listener/handlers.go`](../../indexer/listener/handlers.go) | `handleEvent`, `db.WithTx` |
| RPC retries | [`indexer/soroban/rpc.go`](../../indexer/soroban/rpc.go) | `CallSorobanRPC`, `RPCMaxRetries`, `RPCRetryBaseDelay`, `RPCRetryMaxDelay` |
| Checkpoint/event SQL | [`indexer/db/queries.go`](../../indexer/db/queries.go) | `GetCheckpoint`, `UpsertCheckpoint`, `LogEvent`, `AreEventsProcessed`, `GetLatestProcessedLedger` |
| Webhook queue | [`indexer/db/webhooks.go`](../../indexer/db/webhooks.go) | `ClaimPendingDeliveries`, `MarkDeliveryRetry`, `MarkDeliveryDeadLetter` |
| Delivery worker | [`indexer/webhooks/worker.go`](../../indexer/webhooks/worker.go) | `DeliveryWorker.Start`, `attemptDelivery`, `handleFailure` |
| Enqueue/payload | [`indexer/webhook/dispatcher.go`](../../indexer/webhook/dispatcher.go) | `EnqueueDeliveries`, `BuildEnvelope` |
| Process lifecycle | [`indexer/main.go`](../../indexer/main.go) | graceful shutdown, non-zero exit on listener failure |
| Schema | [`indexer/db/migrations/`](../../indexer/db/migrations/) | `events_log`, `indexer_checkpoint`, `webhook_subscriptions`, `webhook_deliveries` |

See also [Architecture](../ARCHITECTURE.md), [Webhooks](../webhooks.md),
[Troubleshooting](troubleshooting.md), and
[Environment variables](environment-variables.md).

### Checkpoint semantics

`indexer_checkpoint` has one row, key `latest_processed_ledger`. Despite the
name, the value is the **next ledger to request** (`EventListener.Start` passes
it directly as `startLedger`); `UpsertCheckpoint` writes it after a successful
poll.

Startup order:

1. `GetCheckpoint`; a value `> 0` is the resume ledger.
2. Otherwise `GetLatestProcessedLedger` (`MAX(events_log.ledger)`) plus one.
3. Otherwise the RPC chain tip — **a fresh or empty database does not backfill
   history**.

The checkpoint is written after the event transaction. A crash between them
leaves it behind; the ledger is fetched again and `events_log.event_id`
de-duplication skips events already applied. Lowering the checkpoint is safe for
already-logged events; raising it skips ledgers permanently. Never edit it while
the listener runs.

`INDEXER_CONFIRMATION_DEPTH` (default `3`, max `20`, `0` disables) delays
processing until a ledger is that far behind the RPC tip, and the checkpoint
cannot pass that boundary. `verifyFinalizedLedger` re-reads the last finalized
ledger hash each poll; a mismatch halts the listener with a non-zero exit.
Hashes are **in memory only**, so a reorg during downtime is not detected at
startup.

`events_log.event_id` is unique (`ON CONFLICT DO NOTHING`).
`webhook_deliveries` is unique on `(subscription_id, event_id)` (migration
[`013_unique_webhook_delivery_per_event.sql`](../../indexer/db/migrations/013_unique_webhook_delivery_per_event.sql)),
so re-indexing an event does not create a second delivery row. HTTP delivery is
at-least-once; subscribers must dedupe on `event_id`.

## 2. Soroban RPC outage

### Detect

- `GET /health` returns `503 {"status":"degraded",...}` when the DB ping or
  listener health fails (`CheckHealth` in `indexer/api/router.go`).
- Logs: `Error polling events; retrying with backoff`, `call getEvents` /
  `call getLatestLedger`, or `reorg detected at ledger ...` (which exits `1`).
- HTTP `429`, `5xx`, or network errors. Error text omits the RPC URL so provider
  API keys do not leak (issue #921).
- `GET /metrics` exists, but in this checkout the app-specific meters
  (`clearledger_listener_last_ledger`, `clearledger_invoices_indexed_total`,
  `clearledger_webhook_deliveries_total`, `stellar_ledger_lag`) are registered
  but never updated. **Do not alert on them yet**; use `/health`, logs, and SQL.

Check the provider independently:

```bash
curl -sS https://soroban-testnet.stellar.org/health
```

### Retry behavior

There are two layers:

1. `CallSorobanRPC` retries network errors, `429`, and `5xx` up to
   `RPCMaxRetries` (default `3`, four attempts total), backing off
   `100ms * 2^(attempt-1)` capped at `5s`. Other HTTP statuses, JSON-RPC error
   envelopes, decode errors, and cancelled contexts fail immediately.
2. A failed poll marks health stopped, then `EventListener.Start` waits an
   exponential backoff from `1s` to a `30s` cap and retries the same checkpoint.
   Success resets backoff and health.

No checkpoint is written on a failed poll. A transient RPC error does not lose
events.

### Safe restart

During a pure RPC outage a restart is optional; the listener keeps retrying.
If the process exited:

```bash
docker compose logs --tail=200 indexer
docker compose restart indexer
# Non-Compose: sudo systemctl restart <your-indexer-service>
```

`SIGINT`/`SIGTERM` cancels the listener, drains background components for up to
5 seconds, shuts down HTTP, and closes the DB pool. Listener/HTTP failures exit
non-zero so restart-on-failure recycles the process; a normal signal exits zero.

Do not move the checkpoint forward to "fix" an outage, and do not restart in a
loop while the RPC is still down. After recovery verify `/health`, look for
`Resuming event indexing from checkpoint`, and confirm the checkpoint advances
(section 6).

### Reorg halt is not an outage

A `reorg detected at ledger N` error is deliberate. Keep the indexer stopped,
do not advance the checkpoint, inspect rows derived from `ledger >= N`, replay
the authoritative range (section 4), then restart. If the RPC no longer serves
the range, restore a snapshot from before `N` (section 3).

## 3. Database restore

### Before restoring

1. Stop the indexer (the same process serves the API and listener).
2. Take a fresh backup and record state:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=clearledger-pre-restore.dump

psql "$DATABASE_URL" <<'SQL'
SELECT value AS next_ledger FROM indexer_checkpoint WHERE key = 'latest_processed_ledger';
SELECT MIN(ledger), MAX(ledger), COUNT(*) FROM events_log;
SELECT status, COUNT(*) FROM invoices GROUP BY status ORDER BY status;
SELECT status, COUNT(*) FROM webhook_deliveries GROUP BY status ORDER BY status;
SELECT version, applied_at FROM schema_migrations ORDER BY version;
SQL
```

3. Restore with your provider's snapshot/PITR or `pg_restore`. Use the direct
   connection where required (`DATABASE_URL_UNPOOLED` is the documented direct
   Neon string); do not restore through a transaction pooler.

Migrations are forward-only and run on startup, recorded in
`schema_migrations`. Do not edit applied migrations; see
[Local Setup](local-setup.md#database-migrations) and
[Troubleshooting](troubleshooting.md#a-migration-fails).

### Checkpoint consistency

A full database snapshot restores checkpoint and events together (a
table-level restore may not). Check before starting:

```sql
SELECT value AS next_ledger FROM indexer_checkpoint WHERE key = 'latest_processed_ledger';
SELECT COALESCE(MAX(ledger), 0) AS max_event_ledger, COUNT(*) AS events FROM events_log;
```

- **Checkpoint present with `events_log`:** resume normally. A checkpoint lower
  than `MAX(ledger)` is expected after a crash between event commit and
  checkpoint write; replay is deduped.
- **Checkpoint missing/`0`, `events_log` not empty:** startup uses
  `MAX(ledger) + 1`. This resumes at the tail but cannot fill earlier gaps.
- **Both missing/empty:** startup uses the chain tip. Correct for a new
  deployment, **wrong for a restored database that should re-index history**.
  Seed the checkpoint before starting.

Seeding sets the next ledger to request (inclusive):

```sql
INSERT INTO indexer_checkpoint (key, value)
VALUES ('latest_processed_ledger', :from_ledger)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Choose a deployment or known-good ledger. Lower is safe; never raise it over
unindexed history. Restored webhook locks belong to a dead process; each claim
lasts 60 seconds, or release them while stopped:

```sql
UPDATE webhook_deliveries SET locked_until = NULL WHERE locked_until IS NOT NULL;
```

Start the indexer and verify (section 6). If the snapshot predates the RPC's
retained history, the missing range cannot be reconstructed from that provider.

### Rollback a restore

Stop the indexer, restore the pre-restore dump, fix the checkpoint only if the
restored copy is inconsistent, clear webhook locks, and restart. Never reverse a
restore by raising the checkpoint or hand-editing `events_log`.

## 4. Backfilling ledger gaps

Kinds of gaps:

- **Tail gap:** the indexer was down while the chain advanced. Restart; it
  resumes from the checkpoint. No SQL.
- **Interior gap:** the checkpoint already passed an unapplied range (manual
  edits, partial restore, bug). Restarting alone will not fix it.
- **Empty/new database:** startup begins at the chain tip, so seed the
  checkpoint (section 3) before first start.

`events_log` only contains ledgers that emitted events; a missing ledger number
is not proof of a gap. Confirm with the checkpoint, the provider's `getEvents`
for the range, and expected invoice/state rows.

### `cmd/backfill` is a stub

`indexer/cmd/backfill/main.go` parses `-from-ledger` and `-to-ledger`, loads
config, prints `Starting backfill from <from> to <to> using DB: ...`, and exits.
It does **not** fetch events, write `events_log`, update invoices, or move the
checkpoint. Do not use it during an incident; use checkpoint-driven replay.

### Replay from a ledger

Stop the indexer and back up first. Replace `:from_ledger` with an integer.

**A. Re-fetch and skip already-logged events** (tail gap, or events absent from
`events_log`):

```sql
BEGIN;
UPDATE indexer_checkpoint SET value = :from_ledger
WHERE key = 'latest_processed_ledger';
COMMIT;
```

Restart. The listener fetches from `:from_ledger` inclusive and
`AreEventsProcessed` skips existing `event_id`s.

**B. Re-apply a range already present in `events_log`:** remove the dedupe rows
and reset the checkpoint, then replay in ledger order:

```sql
BEGIN;
DELETE FROM events_log WHERE ledger >= :from_ledger;
UPDATE indexer_checkpoint SET value = :from_ledger
WHERE key = 'latest_processed_ledger';
COMMIT;
```

Restart and let it run to the tip. Existing invoice rows are updated again, but
webhook rows are not recreated because of the `(subscription_id, event_id)`
constraint; replay webhooks separately (section 5).

Before deleting, confirm the RPC still serves `:from_ledger`. If it has pruned
the range, deleting the markers creates a permanent gap; restore a snapshot from
before the range instead.

### Verify the backfill

```sql
SELECT value AS next_ledger FROM indexer_checkpoint WHERE key = 'latest_processed_ledger';
SELECT MIN(ledger), MAX(ledger), COUNT(*) FROM events_log;
SELECT ledger, COUNT(*) FROM events_log
WHERE ledger >= :from_ledger GROUP BY ledger ORDER BY ledger;
SELECT status, COUNT(*) FROM invoices GROUP BY status ORDER BY status;
```

Then confirm the RPC tip and watch the checkpoint advance across two or three
polls:

```bash
curl -sS "$SOROBAN_RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}'
```

**Rollback:** stop, restore the pre-backfill backup (including deleted
`events_log` rows). Lowering the checkpoint again replays; it does not undo
applied invoice state.

## 5. Webhook replay for failed subscribers

### Automatic behavior

`DeliveryWorker` claims due rows with `FOR UPDATE SKIP LOCKED`, stamps
`locked_until` (60s), and attempts up to 50 rows per 5-second poll with
`WEBHOOK_WORKER_CONCURRENCY` (default 8) in parallel and a 10-second HTTP
timeout. Any `2xx` succeeds. Failures retry until the row's `max_attempts`
(default 5):

| Failed attempt | Delay |
| --- | --- |
| 1 | 20s |
| 2 | 40s |
| 3 | 80s |
| 4 | 160s |
| 5 | no retry; `dead_letter` |

`dead_letter` rows are never retried automatically. Rows whose subscription is
`active = FALSE` are never claimed.

### Inspect

```sql
SELECT id, subscription_id, event_type, event_id, attempts, max_attempts,
       status, next_attempt_at, locked_until, last_status,
       left(last_error, 160) AS last_error
FROM webhook_deliveries
WHERE status <> 'delivered'
ORDER BY created_at DESC LIMIT 50;

SELECT id, target_url, active, event_types
FROM webhook_subscriptions WHERE id = :subscription_id;
```

**Retry** is automatic for `pending` rows with `next_attempt_at <= now` and
`locked_until` null/expired. **Manual replay** resets `dead_letter` rows (or
deliberately `delivered` rows); it reuses the stored payload and `event_id`.

### Replay

One delivery:

```sql
UPDATE webhook_deliveries
SET status = 'pending', attempts = 0, next_attempt_at = CURRENT_TIMESTAMP,
    locked_until = NULL, last_status = NULL, last_response = NULL,
    last_error = NULL, updated_at = CURRENT_TIMESTAMP
WHERE id = :delivery_id
RETURNING id, subscription_id, event_type, event_id, status;
```

All dead letters for one subscription (reactivate it first):

```sql
UPDATE webhook_subscriptions
SET active = TRUE, updated_at = CURRENT_TIMESTAMP
WHERE id = :subscription_id;

UPDATE webhook_deliveries
SET status = 'pending', attempts = 0, next_attempt_at = CURRENT_TIMESTAMP,
    locked_until = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
WHERE subscription_id = :subscription_id AND status = 'dead_letter';
```

By event ID (all subscriptions):

```sql
UPDATE webhook_deliveries
SET status = 'pending', attempts = 0, next_attempt_at = CURRENT_TIMESTAMP,
    locked_until = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
WHERE event_id = :event_id;
```

There is no replay API. The worker picks rows up on its next ~5-second poll. If
a row stays `pending`, check that the subscription is active, `next_attempt_at`
is past, and `locked_until` is not held. To allow more automatic attempts:

```sql
UPDATE webhook_deliveries SET max_attempts = 10 WHERE id = :delivery_id;
```

Do not bulk-reset rows until the subscriber is healthy; each replay consumes the
attempt budget again.

### Idempotency and signatures

- Dedupe key: the on-chain `event_id` (also the envelope `event_id`). One row
  per `(subscription_id, event_id)`; replays reuse the same value.
- `occurred_at` is the ledger close time, so historical replays keep their
  original time; order with `ledger`/`occurred_at`.
- Every attempt uses the **current** subscription secret and a fresh
  `X-ClearLedger-Timestamp`:
  `HMAC_SHA256(secret, timestamp + "." + raw_body)`. Update an old secret before
  replaying. See [Webhooks](../webhooks.md#delivery-guarantees).
- A sent HTTP request cannot be recalled. To undo an accidental bulk reset, stop
  the worker, return unwanted `pending` rows to `dead_letter`, clear locks, and
  restart.

### Verify

```sql
SELECT status, COUNT(*) FROM webhook_deliveries GROUP BY status ORDER BY status;

SELECT id, attempts, status, last_status, left(last_error, 160) AS last_error,
       next_attempt_at, locked_until
FROM webhook_deliveries
WHERE subscription_id = :subscription_id
ORDER BY created_at DESC LIMIT 20;
```

Expect `delivered`, increasing `attempts`, a 2xx `last_status`, and
`locked_until IS NULL` after each attempt.

## 6. Verification checklist

1. `GET /health` returns `200 {"status":"ok"}`.
2. Logs show `Resuming event indexing from checkpoint` after a planned restart,
   with no repeating poll errors or reorg errors.
3. Checkpoint advances over two or three polls and does not move backwards:

   ```sql
   SELECT value FROM indexer_checkpoint WHERE key = 'latest_processed_ledger';
   ```

4. `MAX(events_log.ledger)` is at or behind the RPC tip and catching up.
5. Invoice status counts and recent `events_log` rows match expectations
   (empty ledgers legitimately have no rows).
6. The webhook queue has no unintended backlog:

   ```sql
   SELECT status, COUNT(*) FROM webhook_deliveries GROUP BY status;
   SELECT COUNT(*) FROM webhook_deliveries
   WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP
     AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP);
   ```

7. After a restore, confirm `schema_migrations` contains every expected version.

## 7. Rollback and limits

**Operational rollback:** stop the indexer; restore the pre-change backup if
data changed; if the DB is consistent but the checkpoint is wrong, set it lower
and replay (never raise it); clear stale `locked_until`; restart and repeat
section 6.

There are no down migrations. Rolling back the indexer image does not reverse
schema changes; restore a snapshot if the older image cannot run against the
newer schema. See
[Local Setup](local-setup.md#rolling-back-database-changes).

Known limits in this checkout:

- **No Mainnet guarantees.** Testnet only.
- **No automated backfill.** `indexer/cmd/backfill` is a stub.
- **No persisted reorg hashes.** Reorgs during downtime are not detected.
- **At-least-once webhooks.** Dedupe on `event_id`.
- **No listener leader election.** Run one listener per database. Multiple
  delivery workers are safe because claims use `FOR UPDATE SKIP LOCKED`.
- **Finite RPC history.** Pruned ranges cannot be replayed.
- **App metrics are not wired.** Use `/health`, logs, and SQL.
