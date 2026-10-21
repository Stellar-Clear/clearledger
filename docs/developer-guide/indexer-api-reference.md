# Indexer API Reference

The Go indexer runs at `http://localhost:8080` by default in local development
and `http://localhost:8080` in local development.

All amounts are returned as strings to preserve u128 precision.

## GET /health

Health check. Returns 200 if the indexer is running.

```json
{ "status": "ok" }
```

Returns 503 with `{"status": "degraded", "error": "..."}` when the listener or database is unavailable.

## GET /diagnostics

Reports whether each external API-backed feature is configured and reachable.
**Requires JWT** (`Authorization: Bearer <jwt>`), because the response describes
operational state even though it contains no secrets. The endpoint always
returns 200 for an authenticated request, including when a dependency is down,
so the client can render the diagnostics view.

```json
{
  "status": "degraded",
  "checked_at": "2026-01-15T12:00:00Z",
  "features": [
    {
      "name": "horizon",
      "configured": true,
      "healthy": true,
      "status_code": 200,
      "latency_ms": 84
    },
    {
      "name": "soroban_rpc",
      "configured": true,
      "healthy": false,
      "status_code": 503,
      "latency_ms": 120,
      "error_class": "upstream_error"
    }
  ]
}
```

`error_class` is a stable value (`not_configured`, `timeout`, `network_error`,
`unauthorized`, `rate_limited`, `upstream_error`, `invalid_response`,
`rpc_error`, `unhealthy`, and so on). The response intentionally omits endpoint
URLs, credentials, JWT secrets, server seeds, and raw upstream error text,
since hosted provider URLs can carry API keys.

## GET /metrics

Prometheus-format metrics for the indexer service. No JWT required.

## Error responses

Error responses use `text/plain` format (via `http.Error`), not JSON:

```
invoice not found
invalid face value
```

## GET /invoices

Returns invoices with optional filtering.

**Query parameters:**

- `status` — filter by status: `Created`, `Listed`, `Funded`, `Active`, `Confirmed`, `Repaid`, `Defaulted`
- `issuer` — filter by issuer Stellar address
- `page` — page number (default: 1)
- `limit` — results per page (default: 20, max: 100)

**Response:**

```json
{
  "data": [
    {
      "id": "abc123...",
      "issuer": "GABC...",
      "buyer": "GDEF...",
      "face_value": "10000000000000",
      "funded_amount": "9800000000000",
      "discount_bps": 200,
      "due_date": 1750000000,
      "status": "Listed",
      "created_at": 1748000000
    }
  ],
  "total": 47,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

## GET /invoices/:id

Returns a single invoice by ID.

## GET /pool/stats

Returns current pool statistics aggregated from indexed events.

```json
{
  "total_deposits": "1000000000000000",
  "total_funded": "750000000000000",
  "available_liquidity": "250000000000000",
  "utilization_rate_bps": 7500,
  "total_yield_distributed": "15000000000000",
  "active_invoice_count": 12,
  "total_shares": "1000000000000",
  "updated_at": "2025-05-24T12:00:00Z"
}
```

## GET /pool/position/:address

Returns the LP position for a given Stellar address.

```json
{
  "shares": "1000000000000",
  "usdc_value": "1015000000000",
  "yield_earned": "15000000000",
  "deposit_count": 3
}
```

## GET /stats

Protocol-level aggregated statistics for the landing page. See
[Analytics metrics and on-chain sources](../ANALYTICS_METRICS.md) for each
field's formula, inclusion rules, units, timestamps, and producing contract
events.

```json
{
  "total_usdc_financed": "5000000000000000",
  "active_invoice_count": 12,
  "total_invoices": 47,
  "total_repaid": 31,
  "total_defaulted": 2,
  "average_yield_bps": 210,
  "pool_utilization_bps": 7500,
  "registered_issuers": 8
}
```

How the aggregates are derived from invoice `status`:

| Field                  | Statuses included                                                  |
| ---------------------- | ------------------------------------------------------------------ |
| `total_usdc_financed`  | `Funded`, `Active`, `Confirmed`, `Repaid` (sum of `funded_amount`) |
| `active_invoice_count` | `Funded`, `Active`, `Confirmed` (capital deployed, not yet repaid) |
| `total_repaid`         | `Repaid`                                                           |
| `total_defaulted`      | `Defaulted`                                                        |
| `average_yield_bps`    | `Funded`, `Active`, `Confirmed`, `Repaid` (mean `discount_bps`)    |

## GET /auth

Requests a SEP-10 authentication challenge for a Stellar account. No JWT required.

**Query parameters:**

- `address` — the Stellar public key to authenticate (required)

**Response:**

```json
{
  "transaction": "AAAAAgAAA...",
  "network_passphrase": "Test SDF Network ; September 2015"
}
```

## POST /auth

Exchanges a signed SEP-10 challenge transaction for a JWT. No JWT required.

**Request body:**

```json
{
  "transaction": "AAAAAgAAA...signed..."
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 86400
}
```

## POST /invoices

Creates an off-chain/indexed invoice record. **Requires JWT** (`Authorization: Bearer <jwt>`).

**Request body:**

```json
{
  "buyer": "GBUYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "face_value": "10000000000",
  "due_date": 1790000000
}
```

**Accepted ranges:**

- `face_value` — decimal string, strictly positive, and at most `2^128 - 1`
  (i.e. `340282366920938463463374607431768211455`). Values outside this range,
  non-numeric strings, or strings longer than 40 digits are rejected with
  `400 invalid face value`. The amount is in stroops (1 USDC = 10,000,000
  stroops), matching the on-chain representation.
- `due_date` — Unix timestamp in seconds. Must be in the future and no more
  than 5 years (`maxDueDateHorizonSeconds`) from the time the request is
  validated. Timestamps in the past or beyond the horizon are rejected with
  `400 invalid due date`.

**Response (201):**

```json
{
  "invoice_id": "a3f8c1d27e904b6a8d5f0139c2e7ab64f0d8c3b19a6e52f7b4c0d91e8a2735bc",
  "transaction_hash": "abc123...",
  "status": "SUCCESS"
}
```

## GET /events

Returns the most recent indexed Soroban events. No JWT required.

**Query parameters:**

- `limit` — number of events to return (default: 20)

**Response:**

```json
[
  {
    "id": 1,
    "event_id": "abc123...",
    "contract_id": "CABC...",
    "ledger": 12345,
    "ledger_closed_at": 1748000000,
    "event_type": "invoice_created",
    "data": {}
  }
]
```

## GET /pool/snapshots

Returns historical pool snapshots used for charts and trend analysis. No JWT required.

**Response:**

```json
[
  {
    "timestamp": 1748000000,
    "utilizationRateBps": 7500,
    "totalYieldDistributed": "15000000000000"
  }
]
```
