# Webhook System

The ClearLedger indexer provides a webhook system for external systems to subscribe to real-time event notifications.

## Overview

Webhooks allow external systems to receive HTTP POST notifications when specific events occur on-chain. The system supports:

- **Invoice lifecycle events**: created, funded, repaid, defaulted, listed, shipped, confirmed
- **Pool events**: deposit, withdrawal, yield distribution

## Architecture

### Payload Schema (v1.0)

All webhook deliveries use a versioned envelope. This is a real `invoice.created` body as sent by the delivery worker, pretty-printed:

```json
{
  "data": {
    "buyer": "GDSCOJVNZ4JUVWZ5O6VBTUGOH4ZE22QJ6WMOYWHB3FEDQ2APJ2RQEIHY",
    "issuer": "GCV5ODH3SMUDETURTOQPQ7TD2YI4YS6DZMMXDFLSWLGBFZTCHYL6LDNW",
    "status": "Created",
    "due_date": 1798675200,
    "created_at": 1790763125,
    "face_value": "1000000000",
    "invoice_id": "9c4e1f0a7b3d52e8c6a1f4b09d7e3a5c2f8b6d0e4a19c7f3b5d2e8a6c0f4b1d9",
    "discount_bps": 250,
    "funded_amount": "0"
  },
  "ledger": 4948964,
  "event_id": "0021255638529081344-0000000001",
  "event_type": "invoice.created",
  "contract_id": "CA4O3MR7LWHRSUDBNU6FY6UDFFYBN7TGBZXBDZB4OYYXFYXIFJ6RJF6B",
  "occurred_at": "2026-09-30T10:12:05Z",
  "schema_version": "1.0"
}
```

The payload is stored as PostgreSQL `JSONB` and sent as Postgres renders it, so key order and whitespace are not the order the fields are defined in. Parse the JSON; don't depend on its layout (and see [Verifying signatures](#verifying-signatures) for why you must verify the raw bytes).

#### Where each field comes from

Envelope fields are on-chain facts taken from the event that triggered the
delivery, not from the moment the worker sent it:

- `event_id`, `ledger` and `contract_id` come from the Soroban event itself, so
  a re-indexed historical event keeps its original identity.
  - `event_id` is the Soroban RPC event ID: a 19-digit, zero-padded TOID, a
    hyphen, and a 10-digit event index (`0021255638529081344-0000000001`). The
    TOID's high 32 bits are the `ledger`. It is unique per on-chain event, which
    makes it the key to de-duplicate on.
  - `contract_id` is the contract that emitted the event (the invoice contract
    for `invoice.*`, the pool contract for `pool.*`).
- `occurred_at` is the **ledger close time** of that ledger, never the indexer's
  wall clock, formatted as RFC 3339 in UTC with second precision. A delivery
  retried an hour later, or an event replayed after a resync, still reports when
  it happened on-chain.

`data` is read back from the invoice row the listener just updated, so it
reflects post-transaction state rather than what happened to be in the event
arguments:

- Invoice events (`invoice.*`) carry `invoice_id`, `issuer`, `buyer`,
  `face_value`, `discount_bps`, `funded_amount`, `due_date`, `status`,
  `created_at` and the lifecycle timestamps `funded_at`, `shipped_at`,
  `buyer_confirmed_at`, `repaid_at`.
  - `invoice_id` is the on-chain `BytesN<32>` invoice ID as 64 lowercase hex
    characters.
  - `face_value` and `funded_amount` are decimal strings in the asset's smallest
    unit (7 decimal places for USDC, so `"1000000000"` is 100 USDC).
    `due_date`, `created_at` and the lifecycle timestamps are Unix seconds.
- Lifecycle timestamps that have not happened yet are **absent** from the
  payload, not zero. Treat a missing key as "not reached".
- Pool events (`pool.*`) carry `account`, `amount` and, when the contract
  reports them, `shares`, `new_balance`, `yield_amount` and `total_shares`.

### Supported Event Types

| Event Type               | Description                  |
| ------------------------ | ---------------------------- |
| `invoice.created`        | New invoice created          |
| `invoice.funded`         | Invoice funded by pool       |
| `invoice.repaid`         | Invoice repaid by buyer      |
| `invoice.defaulted`      | Invoice defaulted            |
| `invoice.listed`         | Invoice listed for financing |
| `invoice.shipped`        | Invoice marked as shipped    |
| `invoice.confirmed`      | Delivery confirmed by buyer  |
| `pool.deposit`           | User deposited to pool       |
| `pool.withdrawal`        | User withdrew from pool      |
| `pool.yield_distributed` | Yield distributed to LPs     |

> **Known issue:** the envelope's `event_type` always uses the names above, but
> the subscription lookup currently compares a subscription's `event_types`
> against the raw contract event name (for example `InvoiceCreated`) instead of
> the public name. A subscription that lists `invoice.created` therefore receives
> no deliveries today. Subscribe with the public names above; they will start
> matching once the lookup is fixed.

### Signatures

Each webhook delivery is signed with HMAC-SHA256 using the subscription's secret:

```
X-ClearLedger-Signature: sha256=<hex_digest>
X-ClearLedger-Timestamp: <unix_timestamp>
```

- The signature is `HMAC_SHA256(secret, timestamp + "." + body)`, where `body`
  is the exact request body bytes and `timestamp` is the `X-ClearLedger-Timestamp`
  header value.
- The digest is lowercase hex, prefixed with `sha256=`.
- The timestamp is Unix time in **seconds** at the moment of the attempt. Every
  retry is signed again with a fresh timestamp, so a retried delivery still
  passes a tolerance check.

#### Verifying signatures

Verify every request before trusting it:

1. Take the **raw request body bytes**. Don't parse and re-serialize the JSON
   first: re-encoding changes the bytes and the signature won't match.
2. Reject the request if `X-ClearLedger-Timestamp` is more than 5 minutes away
   from your clock, in either direction.
3. Recompute `sha256=` + hex(HMAC-SHA256(secret, timestamp + "." + body)) and
   compare it to `X-ClearLedger-Signature` in constant time.

Node.js (Express):

```js
const crypto = require("node:crypto");
const express = require("express");

const SECRET = process.env.CLEARLEDGER_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 5 * 60;

function verifyClearLedgerSignature(rawBody, timestamp, signature, secret) {
  if (!/^\d+$/.test(timestamp ?? "")) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();

// express.raw() keeps the exact bytes that were signed. Don't use
// express.json() on this route: re-serialized JSON won't match the signature.
app.post(
  "/webhooks/clearledger",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const ok = verifyClearLedgerSignature(
      req.body,
      req.get("X-ClearLedger-Timestamp"),
      req.get("X-ClearLedger-Signature"),
      SECRET,
    );
    if (!ok) return res.sendStatus(401);

    const event = JSON.parse(req.body.toString("utf8"));
    // Deliveries are at-least-once: skip event.event_id values you've already
    // processed, then hand the event to a queue and answer quickly.
    res.sendStatus(204);
  },
);
```

Go (`net/http`). This function is also compiled and run against the indexer's
own signer as `Example_verifySignature` in
`indexer/webhooks/signature_example_test.go`, so keep the two in sync:

```go
const signatureTolerance = 5 * time.Minute

func verifyClearLedgerSignature(secret string, rawBody []byte, timestamp, signature string, now time.Time) bool {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if age := now.Sub(time.Unix(ts, 0)); age > signatureTolerance || age < -signatureTolerance {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// In the handler, read the body once and verify those bytes:
//
//	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
//	if err != nil || !verifyClearLedgerSignature(secret, body,
//		r.Header.Get("X-ClearLedger-Timestamp"), r.Header.Get("X-ClearLedger-Signature"), time.Now()) {
//		http.Error(w, "invalid signature", http.StatusUnauthorized)
//		return
//	}
```

**Replay protection** comes from two checks together. The timestamp window
rejects a captured request replayed more than 5 minutes later, and
de-duplicating on `event_id` (which you need anyway, see
[Delivery Guarantees](#delivery-guarantees)) makes a replay inside the window
harmless.

**Endpoint security:** subscription URLs are checked once, when the
subscription is created (see [Subscription Management](#subscription-management)),
not at delivery time. Plain `http://` is accepted, so use an `https://`
endpoint, keep the signing secret out of source control and logs, and rotate it
if it leaks.

### Delivery Semantics

What a receiver sees, per attempt:

- **Request:** `POST` to the subscription URL with the envelope as the body,
  `Content-Type: application/json`, the two signature headers above, and Go's
  default `User-Agent` (`Go-http-client/1.1`, or `Go-http-client/2.0` when
  the endpoint negotiates HTTP/2).
- **Success** is any `2xx` status. Every other status (including `3xx` that
  isn't followed, `4xx` and `5xx`) and every network error counts as a failed
  attempt. Answer quickly and process asynchronously.
- **Timeout:** the whole attempt (connect, send, response headers and body) has
  10 seconds.
- **Redirects** are followed (Go's default, up to 10). A `301`, `302` or `303`
  turns the `POST` into a `GET` without a body, so register the final URL.
- **Response storage:** on success, up to the first 4096 bytes of your response
  body are stored in `webhook_deliveries.last_response`. On failure only the
  status code (`last_status`) and a minimal error message (`last_error`, for
  example `non-2xx response: 500`) are stored. Failure response bodies are
  untrusted and are never copied into `last_error`.
- **Trust boundary for `last_error`:** `last_error` is an operator-facing
  diagnostic, not a copy of the request. Before it is persisted, the delivery
  worker redacts the endpoint URL (which may contain an API key in its path or
  query string), the subscription's signing secret, and any other bare URL, then
  caps the value at 1024 bytes. Never rely on `last_error` to carry provider
  credentials, tokens, or the subscriber's response body.
- **Ordering and duplicates:** delivery is at-least-once, and deliveries are
  not ordered. The queue holds at most one row per subscription and `event_id`,
  but that row can be sent more than once (see
  [Delivery Guarantees](#delivery-guarantees)), and a retried delivery can
  arrive after later events. De-duplicate on `event_id` and use
  `ledger` / `occurred_at` (or the invoice's lifecycle timestamps) to order
  events.

What happens in the queue:

- The worker polls every **5 seconds** and claims up to **50** due deliveries
  per poll, attempting up to `WEBHOOK_WORKER_CONCURRENCY` of them in parallel.
  A new delivery is first attempted on the next poll after the event is indexed.
- `webhook_deliveries.status` is `pending` while a delivery is waiting for its
  first attempt or a retry, `delivered` after a `2xx`, and `dead_letter` once
  retries are exhausted. `terminal_status` mirrors the final value and is
  `NULL` while pending, so a single column answers "is this row finished?".
  Dead-lettered rows are never retried automatically, and delivered rows are
  never returned to the queue even if a duplicate or late outcome is recorded.
- Delivery rows are only created for subscriptions that are active when the
  event is indexed. Rows whose subscription is later set to `active = false`
  are not attempted; they stay `pending` until it is re-activated.

### Delivery Guarantees

**The queue creates at most one delivery row per subscription and `event_id`,
but HTTP delivery is at-least-once, not exactly-once.** Reprocessing the same
on-chain event does not add another queue row for that subscription. However,
a subscriber that returns 2xx slowly, an indexer that is killed mid-attempt, or
two indexer replicas during a rolling deploy can cause the existing row to be
sent more than once. Subscribers should therefore de-duplicate HTTP requests
using `event_id`.

The queue guarantees the weaker property that no delivery is lost and no two
workers attempt the same row at the same time:

- The worker calls `db.ClaimPendingDeliveries`, which **claims** rows instead of
  merely reading them. The read is a single statement that locks the candidate
  rows with `SELECT … FOR UPDATE SKIP LOCKED` and stamps `locked_until`, so a
  concurrent claim by another worker (or another replica of the same indexer)
  gets a disjoint batch.
- A claimed row is invisible to other workers until either the attempt records
  an outcome (`MarkDeliverySuccess`, `MarkDeliveryRetry` and
  `MarkDeliveryDeadLetter` all clear `locked_until`) or the lock expires.
- If a worker dies after claiming and before recording an outcome, the row
  stays `pending` and becomes claimable again once `locked_until` passes. That
  is the case in which a subscriber may see an event twice.
- Rows are never deleted on success; they move to `delivered`, so the queue can
  be audited.

### Worker Configuration

The delivery worker attempts a batch of deliveries from a bounded pool that
shares a single `http.Client`, so TCP/TLS connections are reused across
deliveries instead of paying a handshake per POST. Environment variables read
by `indexer/config`:

- `WEBHOOK_WORKER_CONCURRENCY` (default `8`): how many deliveries one batch
  attempts in parallel. Keep it small when your subscribers rate-limit inbound
  traffic. Non-positive values fall back to the default.
- The claim lock TTL is `db.DefaultClaimLockTTL` (60s) and must stay comfortably
  above the worker's HTTP timeout so an in-flight attempt is never handed to a
  second worker.

The poll interval (5s), batch size (50) and HTTP timeout (10s) are the defaults
in `webhooks.DefaultWorkerConfig` and are not configurable through the
environment.

### Retry Logic

A delivery gets **5 attempts**: the first attempt plus 4 retries with
exponential backoff.

| Attempt | When                                              |
| ------- | ------------------------------------------------- |
| 1       | On the next poll after the event is indexed       |
| 2       | 20 seconds after attempt 1 fails                  |
| 3       | 40 seconds after attempt 2 fails                  |
| 4       | 80 seconds after attempt 3 fails                  |
| 5       | 160 seconds after attempt 4 fails                 |
| —       | Attempt 5 fails: marked `dead_letter`, no retries |

- The delay after the _n_-th failed attempt is `10s × 2^n`
  (`backoffBase * (1 << nextAttempt)` in `indexer/webhooks/worker.go`), capped
  at **15 minutes**. Together with the attempt cap this keeps the schedule
  finite for every row.
- A retry runs on the first poll after its scheduled time, so it can start up to
  one poll interval (5s) later than listed.
- The limit comes from the `webhook_deliveries.max_attempts` column (default
  `5`, set per delivery row by migration `009_add_webhook_subscriptions.sql`),
  not from `WorkerConfig.MaxAttempts`. The worker and the `Mark*` helpers clamp
  it to `1..20` (`db.MaxDeliveryAttempts`), so a malformed row cannot retry
  forever.
- `attempt_count` records every attempt, including the terminal failure, so a
  dead-lettered row shows `attempt_count = 5` (the legacy `attempts` column is
  kept in sync for older readers).
- `next_attempt_at` is updated only for a retry; terminal rows keep their last
  value but are excluded from claiming by `status`/`terminal_status`.
- Outcome writes are idempotent and compare-and-set on the persisted attempt
  count: a duplicate success or a stale failure callback cannot increment the
  counter twice or move a terminal row back to `pending`.
- If a worker dies after claiming, `locked_until` expires and the row is
  reclaimed with the same `attempt_count`; claiming itself is not an attempt.

### Subscription Management

Subscriptions are created, listed and deleted through the indexer's
`/webhooks` routes; see the [API reference](./openapi/README.md). Underneath,
two tables hold the state:

- `webhook_subscriptions`: Stores subscriber URLs, event types, secrets, and active status
- `webhook_deliveries`: Tracks delivery attempts, status, and responses.
  `locked_until` holds the current claim (see
  [Delivery Guarantees](#delivery-guarantees)) and is `NULL` when the row is
  free; migration `010_add_webhook_delivery_locking.sql` added the column.
  Migration `015_add_webhook_delivery_attempt_tracking.sql` added
  `attempt_count` and `terminal_status`, backfilled them from `attempts` and
  `status`, and keeps the legacy columns synchronized during rolling deploys.

## Implementation Details

The webhook system was implemented in three phases:

1. **Payload Schema** (#804): Defined versioned JSON envelope and event types in `indexer/webhooks/payload.go`
2. **Subscriptions Table** (#805): Added database schema and Go accessors in `indexer/db/webhooks.go` and migration `009_add_webhook_subscriptions.sql`
3. **Delivery Worker** (#806): Background worker with signing, retry, and dead-letter handling in `indexer/webhooks/worker.go`

At runtime, in `indexer/main.go`:

- **Enqueueing:** the event listener calls `Dispatcher.EnqueueDeliveries`
  (`indexer/webhook/dispatcher.go`) inside the same database transaction that
  applies the event, so an event's `webhook_deliveries` rows commit or roll back
  with the event itself. `BuildEnvelope` in the same file builds the payload.
- **Sending:** `webhooks.NewDeliveryWorker` (`indexer/webhooks/worker.go`) runs
  as a background goroutine alongside the listener and performs every HTTP
  delivery.
