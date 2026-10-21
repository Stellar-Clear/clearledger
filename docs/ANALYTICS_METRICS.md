# Analytics Metrics and On-Chain Sources

This document defines every metric shown on the public **Analytics** page and
the derived amounts used by the **Marketplace**, together with the contract
events and indexer fields that produce them.

> **Stellar Testnet only.** ClearLedger is an unaudited testnet prototype. The
> numbers below describe testnet activity recorded by the indexer; they are not
> a mainnet performance record, a valuation, or a promise of yield. Never use
> real funds. See the [documentation index](README.md#testnet-notice) and the
> [security policy](../SECURITY.md).

## Scope and source of truth

- UI surfaces: [`apps/web/app/analytics/AnalyticsClient.tsx`](../apps/web/app/analytics/AnalyticsClient.tsx)
  and [`apps/web/app/marketplace/page.tsx`](../apps/web/app/marketplace/page.tsx).
- Client data hooks: [`useStats`](../apps/web/hooks/useStats.ts),
  [`usePool`](../apps/web/hooks/usePool.ts),
  [`useInvoices`](../apps/web/hooks/useInvoices.ts), and the snapshot query in
  [`PoolPerformanceChart`](../apps/web/components/shared/PoolPerformanceChart.tsx).
- API fields: `GET /stats`, `GET /pool/stats`, `GET /invoices`, and
  `GET /pool/snapshots` in the
  [Indexer API reference](developer-guide/indexer-api-reference.md).
- Server aggregates: [`indexer/db/queries.go`](../indexer/db/queries.go).
- Event ingestion: [`indexer/listener/handlers.go`](../indexer/listener/handlers.go)
  and [`indexer/listener/soroban.go`](../indexer/listener/soroban.go).
- Contract event definitions live in the companion
  [`clearledger-contracts`](https://github.com/Stellar-Clear/clearledger-contracts)
  repository: [`docs/EVENTS.md`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/EVENTS.md),
  [`invoice/src/events.rs`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/contracts/invoice/src/events.rs),
  and [`pool/src/events.rs`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/contracts/pool/src/events.rs).

## Units and precision

| Kind | Representation | Conversion |
| --- | --- | --- |
| USDC amount | Integer `u128` in **stroops**, returned as a decimal string by the API | `1 USDC = 10,000,000 stroops`; divide by `10^7` for display |
| Rate | Integer **basis points** (`bps`) | `1 bps = 0.01%`; `10,000 bps = 100%`; UI shows `bps / 100` as a percentage |
| Count | Integer | Number of rows or events matching the stated filter |
| Timestamp | Unix seconds (UTC epoch) | APIs return an integer; some chart code also accepts milliseconds |

USDC values are kept as strings/bigints end to end because JavaScript `Number`
is exact only up to `2^53` (~900,719,925.47 USDC when the value is in stroops).
The marketplace's funding preview converts to `Number` for display only; the
on-chain `funded_amount` is authoritative.

## Data path

```text
Soroban contract emits event
        |
        v
Indexer listener polls getEvents (INDEXER_POLL_INTERVAL_MS, default 5s)
        |
        v
Confirmation-depth buffer (default 3 ledgers, ~15s)
        |
        v
handleEvent() decodes topic/value and writes invoices / events_log / pool snapshots
        |
        v
GET /stats, /pool/stats, /pool/snapshots, /invoices
        |
        v
useStats / usePool / useInvoices / PoolPerformanceChart
```

The listener de-duplicates by Soroban event ID, applies state changes and the
`events_log` row in one transaction, and only checkpoints ledgers that have
cleared the confirmation window. See
[`pollEvents`](../indexer/listener/soroban.go#L387) and the
[reorg notes](../indexer/listener/soroban.go#L108).

## Protocol analytics (`GET /stats`)

These are the eight tiles on `/analytics`. All are computed by
[`getProtocolStats`](../indexer/db/queries.go#L70) from the `invoices` table,
except `pool_utilization_bps`, which reads the current pool snapshot row.

| UI label / API field | Definition and formula | Units | Inclusion and exclusion | Producing event and write path |
| --- | --- | --- | --- | --- |
| **Total USDC Financed**<br>`total_usdc_financed` | `SUM(funded_amount)` | USDC stroops as a decimal string | Includes `Funded`, `Active`, `Confirmed`, `Repaid`. Excludes `Created`, `Listed`, and `Defaulted`. Because `Defaulted` replaces the prior status, a defaulted invoice drops out of this lifetime-looking total. | `InvoiceFunded` → `handleInvoiceFunded` stores the event's `u128` value in `invoices.funded_amount` with status `Funded` ([handlers.go:182](../indexer/listener/handlers.go#L182), [queries.go:244](../indexer/db/queries.go#L244)). |
| **Pool Utilization**<br>`pool_utilization_bps` | `floor(total_funded × 10,000 / total_deposits)`; `0` when deposits are zero | bps, integer | Current pool state, not an average over time. Read from `pool_snapshots.id = 1`, which is copied from the pool contract's `get_stats().utilization_rate_bps`. | `get_stats` in [`pool/src/lib.rs`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/contracts/pool/src/lib.rs) → [`SyncPoolStats`](../indexer/listener/handlers.go#L22); cached in `pool_snapshots` and exposed by `/stats`. |
| **Average Yield**<br>`average_yield_bps` | `AVG(discount_bps)::INTEGER` across qualifying invoices; PostgreSQL rounds to the nearest whole bp | bps, integer | Includes `Funded`, `Active`, `Confirmed`, `Repaid`; excludes `Created`, `Listed`, `Defaulted`. Simple, unweighted mean of the invoice discount — **not** annualized (APY), not realized LP yield, and not weighted by amount. `0` when no invoices qualify. | `InvoiceListed` sets `invoices.discount_bps` ([handlers.go:153](../indexer/listener/handlers.go#L153)); `InvoiceFunded` moves the row into the included status set. |
| **Registered Issuers**<br>`registered_issuers` | `COUNT(DISTINCT issuer)` | integer | Every distinct `invoices.issuer`, regardless of invoice status. This is **not** a count of registry registrations and does not require a `issuer_registered` event. | `InvoiceCreated` inserts `issuer` ([handlers.go:92](../indexer/listener/handlers.go#L92)). Registry events are logged only ([handlers.go:344](../indexer/listener/handlers.go#L344)). |
| **Total Invoices**<br>`total_invoices` | `COUNT(*)` | integer | Every successfully indexed invoice row, all statuses. Does not include on-chain invoices that were never observed by this indexer. | `InvoiceCreated` → `InsertInvoice` with status `Created` ([handlers.go:92](../indexer/listener/handlers.go#L92)). |
| **Active Invoices**<br>`active_invoice_count` | `COUNT(*)` filtered to `Funded`, `Active`, `Confirmed` | integer | Capital deployed and not yet returned. Excludes `Listed` (not funded), `Repaid`, and `Defaulted`. This is the invoice-table count, so it can differ from the pool contract's own `active_invoice_count`. | Status transitions from `InvoiceFunded`, `InvoiceShipped`, and `DeliveryConfirmed`; pool resync on fund/repay/default. |
| **Invoices Repaid**<br>`total_repaid` | `COUNT(*)` where `status = 'Repaid'` | integer | One per invoice row, not one per repayment transaction. | `InvoiceRepaid` → `UpdateInvoiceRepaid` ([handlers.go:256](../indexer/listener/handlers.go#L256)). |
| **Invoices Defaulted**<br>`total_defaulted` | `COUNT(*)` where `status = 'Defaulted'` | integer | One per invoice. A default also removes the invoice from `active_invoice_count`, `total_usdc_financed`, and `average_yield_bps`. | `InvoiceDefaulted` → `UpdateInvoiceStatus(..., "Defaulted")` ([handlers.go:280](../indexer/listener/handlers.go#L280)). |

The API caches `/stats` for 30 seconds in process, so two page loads inside the
same window can legitimately show identical values
([`handlers_stats.go`](../indexer/api/handlers_stats.go#L17)).

## Pool metrics (`GET /pool/stats` and `/pool/snapshots`)

These values come from the pool contract's `get_stats` entry point, not from
summing invoice rows. They are refreshed when `SyncPoolStats` calls
`get_stats` and writes `pool_snapshots`
([`queries.go:344`](../indexer/db/queries.go#L344)).

| API field / UI use | Definition | Units | Notes |
| --- | --- | --- | --- |
| `total_deposits` | Contract-reported LP capital base: deposits plus credited LP yield, less withdrawals | USDC stroops | A **current state**, not a cumulative deposit counter. `lp_deposited` increases it; `lp_withdrawn` decreases it; `repayment_received` adds `lp_yield`. |
| `total_funded` | Principal currently deployed in funded invoices | USDC stroops | Increased by `fund_invoice`, decreased by `receive_repayment` and `handle_default`. This is the numerator of utilization. |
| `available_liquidity` | `total_deposits - total_funded` | USDC stroops | Shown in the Marketplace header ("Available Liquidity"). Withdrawals cannot exceed this amount. |
| `utilization_rate_bps` | `floor(total_funded × 10,000 / total_deposits)`, `0` when deposits are zero | bps | The contract caps new funding at `max_utilization_bps` (default in contract constants, not exposed by this API). |
| `total_yield_distributed` | Cumulative **LP** yield credited on repayments, after any protocol cut | USDC stroops | Not the `average_yield_bps` metric: this is an absolute, realized, lifetime pool amount; the average is a per-invoice discount mean. |
| `active_invoice_count` | Contract-maintained count of funded, unsettled invoices | integer | Read directly from the pool contract, unlike the `/stats` count computed from the invoice table. |
| `total_shares` | LP shares outstanding | integer share units | Share price is not exposed directly; it is approximately `total_deposits / total_shares`. |

### Chart series

`PoolPerformanceChart` calls `GET /pool/snapshots`, which returns up to 100
rows newest-first. Each point is derived from `pool_snapshot_history`:

- `utilizationPct = utilization_rate_bps / 100`.
- `yieldUsdc = Number(total_yield_distributed) / 10_000_000`.
- The x-axis label is formatted from `timestamp` (Unix seconds) in the viewer's
  local timezone.

## Marketplace amounts

The Marketplace is not an analytics aggregate, but it uses the same units and
several of the same events.

| Display | Definition | Source |
| --- | --- | --- |
| **Available Liquidity** | `available_liquidity` from `/pool/stats` | Pool `get_stats`; same source as the Analytics utilization tile. |
| **Face value** | Invoice's full amount due, in stroops | `invoice_created` data `u128` (`face_value`) → `invoices.face_value`. |
| **Discount** | Issuer's financing discount in bps; max `5000` | `invoice_listed` data `u32` (`discount_bps`) → `invoices.discount_bps`. |
| **Funded amount** | Amount the pool actually paid the issuer | `invoice_funded` data `u128` (`funded_amount`) → `invoices.funded_amount`; the on-chain value overrides the display estimate. |
| **Funding preview** | `face_value - face_value × discount_bps / 10,000`, computed with `Number` and `Math.floor` ([page.tsx:252](../apps/web/app/marketplace/page.tsx#L252)) | Display approximation only. Use `funded_amount` for accounting. |

Filtering in the Marketplace is client-side: entered minimum/maximum amounts are
converted to stroops with `BigInt(parseFloat(value) * 10_000_000)`, and the
discount slider compares `invoice.discountBps` directly. Paging and status
filtering happen server-side through `GET /invoices`.

## Timestamp semantics

Two different clocks appear in these pages. Do not mix them.

| Timestamp | Stored by | Source | Meaning |
| --- | --- | --- | --- |
| `invoices.created_at`, `funded_at`, `shipped_at`, `buyer_confirmed_at`, `repaid_at` | Listener handlers | Soroban RPC event `ledgerClosedAt` (RFC 3339), parsed to Unix seconds | **Ledger close time**: when the event's ledger closed, not when the user submitted the transaction and not when the indexer ingested it. |
| `events_log.ledger_closed_at` | Listener `handleEvent` | Same `ledgerClosedAt` | Ledger close time for event replay and audit. |
| Webhook `occurred_at` | Webhook dispatcher | Same ledger close time | Described in [Webhooks](webhooks.md#where-each-field-comes-from). |
| `pool_snapshots.updated_at` | `UpdatePoolStats` | PostgreSQL `CURRENT_TIMESTAMP` | **Indexer ingestion time** of the latest pool-stat sync. |
| `pool_snapshot_history.recorded_at` | `insertPoolSnapshotHistory` | `EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)` | **Indexer snapshot time**, not the ledger close of the event that triggered the sync. This is the x-axis timestamp on the chart. |
| `invoices.due_date` | `InvoiceCreated` handler | `u64` from the contract event | Business due date, Unix seconds. |

The listener parses `ledgerClosedAt` and falls back to `time.Now()` only when the
field is absent or malformed ([handlers.go:517](../indexer/listener/handlers.go#L517)).
Consequently, a ledger-close timestamp can predate the moment a value becomes
visible in the UI by at least the confirmation depth plus one poll interval.

## Refresh and consistency

| Surface | Server behavior | Client behavior |
| --- | --- | --- |
| `/stats` (Analytics tiles) | 30-second in-process cache | `useStats`: refetch every 60s, stale after 30s |
| `/pool/stats` (Marketplace liquidity) | Reads `pool_snapshots` row | `usePool`: refetch every 45s, stale after 45s |
| `/invoices` (Marketplace list) | Read-only query, no cache | `useInvoicesList`: refetch every 15s, stale after 15s |
| `/pool/snapshots` (chart) | Newest first, default 100, max 500 | Chart query: stale after 60s; no polling interval |
| Event ingestion | Poll every 5s by default; 3-ledger confirmation buffer | Not directly visible to the browser |

`SyncPoolStats` is called after `InvoiceFunded`, `InvoiceRepaid`, and
`InvoiceDefaulted` events ([handlers.go:210](../indexer/listener/handlers.go#L210),
[handlers.go:276](../indexer/listener/handlers.go#L276),
[handlers.go:300](../indexer/listener/handlers.go#L300)).
The pool LP handlers for deposits and withdrawals log the event but do not call
`SyncPoolStats`, so `/pool/stats` and the chart update on the next
fund/repay/default sync after a deposit or withdrawal. A snapshot row is appended
on every `UpdatePoolStats` call.

## Worked examples

### 1. Utilization tile

Suppose the pool contract reports:

```text
total_deposits   = 1,000,000,000,000 stroops = 100,000 USDC
total_funded     =   750,000,000,000 stroops =  75,000 USDC
available        =   250,000,000,000 stroops =  25,000 USDC
```

Then:

```text
utilization_rate_bps = floor(750,000,000,000 * 10,000 / 1,000,000,000,000)
                     = floor(7,500)
                     = 7,500 bps
UI percentage        = 7,500 / 100 = 75.0%
```

The Analytics tile therefore shows `75.0%`, and the Marketplace header shows
`25,000.00 USDC` of available liquidity.

### 2. Financed amount and average yield

An invoice with face value `10,000 USDC` (`100,000,000,000` stroops) is listed at
`200 bps`:

```text
discount cost   = 10,000 * 200 / 10,000 = 200 USDC   (2,000,000,000 stroops)
funded_amount   = 10,000 - 200          = 9,800 USDC (98,000,000,000 stroops)
```

While the invoice is `Funded`, `Active`, `Confirmed`, or `Repaid` it contributes
`9,800 USDC` to `total_usdc_financed` and `200 bps` to the average-yield sample.
When the buyer repays the full face value, the pool receives `10,000 USDC`; the
`200 USDC` surplus is the gross yield, of which the LP portion is added to
`total_yield_distributed` (after any protocol cut). If the invoice is later
marked `Defaulted`, it is removed from `total_usdc_financed` and the
average-yield sample, and `total_defaulted` increases by one.

### 3. Ledger close versus snapshot time

An `InvoiceRepaid` event from ledger `4948964` closes at
`2026-09-30T10:12:05Z`. The resulting `invoices.repaid_at` and
`events_log.ledger_closed_at` are `1790763125`. The indexer may ingest it after
the confirmation window, and `SyncPoolStats` may write a snapshot at
`10:12:20Z`; that snapshot's `recorded_at` is `1790763140`, not `1790763125`.
The chart plots the snapshot time, while the invoice row and webhook payload
report the ledger close time.

## Producing events

The table lists the logical lifecycle events, the companion contract's current
catalog names, the symbols this listener matches, and the code that performs the
database write. Check `events_log.event_type` on a deployed environment if you
need the exact symbol that was indexed
([handlers.go:534](../indexer/listener/handlers.go#L534)).

| Logical event | Contract catalog event | Indexer symbol(s) | Key fields | Indexer write / effect |
| --- | --- | --- | --- | --- |
| Invoice created | `invoice_created` | `create`, `InvoiceCreated` | topic: invoice ID, issuer, buyer, funding asset; data: face value `u128` | Insert `invoices` row, status `Created`; sets `created_at` ([handlers.go:92](../indexer/listener/handlers.go#L92)) |
| Invoice listed | `invoice_listed` | `list_for_financing`, `InvoiceListed` | topic: invoice ID; data: `discount_bps` `u32` | Sets `discount_bps`, status `Listed` ([handlers.go:153](../indexer/listener/handlers.go#L153)) |
| Invoice funded | `invoice_funded` (emitted by pool `fund_invoice` and invoice `mark_funded`) | `fund_invoice`, `InvoiceFunded` | topic: invoice ID; data: funded amount `u128` | Sets `funded_amount`, `funded_at`, status `Funded`; triggers pool sync ([handlers.go:182](../indexer/listener/handlers.go#L182)) |
| Invoice shipped | `invoice_shipped` | `mark_shipped`, `InvoiceShipped` | topic: invoice ID | Sets status `Active`, `shipped_at`, `issuer_confirmed` ([handlers.go:214](../indexer/listener/handlers.go#L214)) |
| Delivery confirmed | `delivery_confirmed`; `both_confirmed` when both parties confirm | `confirm_delivery`, `DeliveryConfirmed` | topic: invoice ID, confirmer | Sets `buyer_confirmed`, `buyer_confirmed_at`, status `Confirmed` ([handlers.go:235](../indexer/listener/handlers.go#L235)) |
| Invoice repaid | `invoice_repaid` | `repay`, `InvoiceRepaid` | topic: invoice ID; data: repaid amount `u128` | Sets status `Repaid`, `repaid_at`; triggers pool sync ([handlers.go:256](../indexer/listener/handlers.go#L256)) |
| Invoice defaulted | `invoice_defaulted` (invoice contract) | `trigger_default`, `InvoiceDefaulted` | topic: invoice ID | Sets status `Defaulted`; triggers pool sync ([handlers.go:280](../indexer/listener/handlers.go#L280)) |
| LP deposit | `lp_deposited` | `deposit`, `lp_deposited` | topic: LP address; data: `(usdc_amount, shares_issued)` | Writes `events_log` and webhook data only ([handlers.go:387](../indexer/listener/handlers.go#L387)) |
| LP withdrawal | `lp_withdrawn` | `withdraw`, `lp_withdrawn` | topic: LP address; data: `(usdc_amount, shares_burned)` | Writes `events_log` and webhook data only ([handlers.go:401](../indexer/listener/handlers.go#L401)) |
| Pool repayment received | `repayment_received` | `receive_repayment`, `repayment_received`, `yield_distribution` | topic: invoice ID; data: `(amount, lp_yield, protocol_cut)` | Logs `amount` and `yield_amount`; pool values are refreshed by the invoice repaid event ([handlers.go:419](../indexer/listener/handlers.go#L419)) |
| Pool default handled | `invoice_defaulted` (pool contract) | `handle_default`, `invoice_defaulted` | topic: invoice ID; data: loss amount `u128` | Logs the loss amount ([handlers.go:435](../indexer/listener/handlers.go#L435)) |
| Attestation submitted | `attestation_submitted` | `submit_attestation`, `AttestationSubmitted` | topic: invoice ID, agent ID; data: risk score `u32` | Stores attestation fields; does not affect the metrics above ([handlers.go:304](../indexer/listener/handlers.go#L304)) |
| Issuer/buyer registered | `issuer_registered`, `buyer_registered` | same names | topic: account address | `events_log` only; `registered_issuers` is derived from invoices ([handlers.go:344](../indexer/listener/handlers.go#L344)) |

Contract source of truth:
[`docs/EVENTS.md`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/EVENTS.md),
[`invoice/src/events.rs`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/contracts/invoice/src/events.rs),
[`pool/src/events.rs`](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/contracts/pool/src/events.rs).

## Known limits and interpretation notes

- **Financed total excludes defaults.** `total_usdc_financed` is a
  status-filtered sum, not a monotonic origination counter. A default reduces
  it. Do not use it as "lifetime volume" without adding defaulted rows back.
- **Average yield is a discount mean.** It is unweighted, per-invoice, and not
  annualized. It is not the yield an LP actually earned; use
  `total_yield_distributed` and share price for that.
- **Registered issuers are not registry members.** The tile counts distinct
  issuer addresses that have at least one indexed invoice.
- **Two active-invoice counts exist.** `/stats` derives one from invoice rows;
  `/pool/stats` copies the contract counter. They can diverge during indexing
  lag or after an unobserved event.
- **Snapshot time is ingestion time.** The chart's x-axis comes from the
  database clock when `SyncPoolStats` runs, not from ledger close. It is
  therefore not directly comparable to invoice lifecycle timestamps.
- **Deposits and withdrawals do not trigger a snapshot in this indexer.** They
  are logged, but pool aggregates refresh on the next fund/repay/default event.
- **Event aliases matter.** Contract and indexer names have drifted across
  releases (for example snake_case catalog names versus function-style names).
  Verify `events_log.event_type` against the deployed contract when diagnosing
  a flat metric. Both the invoice and pool contracts publish a symbol named
  `invoice_defaulted`; a symbol-only switch cannot distinguish them, so the
  invoice-status update depends on the invoice contract's `trigger_default` /
  `InvoiceDefaulted` alias.
- **Funding can emit two events.** `fund_invoice` and `mark_funded` both publish
  `invoice_funded` in the same transaction. The invoice-row update is
  idempotent, but any consumer counting raw events may see the funding twice.
- **`get_stats` returns more than the API exposes.** Current contract versions
  also return fields such as `total_loss_realised` and `max_utilization_bps`;
  `DbPoolStats` and `/pool/stats` persist and expose only the fields listed
  above ([handlers.go:22](../indexer/listener/handlers.go#L22)).
- **Testnet data is disposable.** Testnet resets, indexer restarts, and changes
  to the Soroban RPC retention window can make historical values incomplete.

## Related documentation

- [Indexer API reference](developer-guide/indexer-api-reference.md)
- [Liquidity pool mechanics](protocol/liquidity-pool.md)
- [Invoice lifecycle](protocol/invoice-lifecycle.md)
- [Economic model](protocol/economic-model.md)
- [Webhooks and ledger-close timestamps](webhooks.md)
- [Pool contract reference](smart-contracts/pool-contract.md)
- [Invoice contract reference](smart-contracts/invoice-contract.md)
