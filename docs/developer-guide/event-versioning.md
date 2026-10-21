# Contract Event Versioning

The indexer deliberately decodes contract events by schema version instead of
assuming every payload has the shape it shipped with. This keeps a contract
upgrade from silently dropping events or wedging the listener in a retry loop.

## Version detection

`listener.ResolveEvent` (`indexer/listener/decode.go`) resolves an event before
any database write:

1. A `version` / `schema_version` / `event_version` / `payload_version` field in
   the event value map. Integer `u32`, `u64`, `i32`, `i64`, `timepoint` and
   `duration` values are accepted.
2. A version suffix on the event symbol: `InvoiceCreated:v2`,
   `InvoiceCreated.v2`, `InvoiceCreated_v2`, `InvoiceCreated@2`, or
   `InvoiceCreated/v2`.
3. A dedicated version topic: `v2`, `version`, `schema_version`,
   `event_version`, or `payload_version` followed by an integer.
4. No marker means **schema version 1**, the legacy shape used before
   versioning was introduced.

A versioned envelope may nest the version's fields under `data`, `payload`, or
`event`; otherwise the version field and the fields live in the same map.

## Supported versions

| Version | Status | Decoder |
| --- | --- | --- |
| 1 | supported | `listener.DecodeTypedEvent` → `decodeV1` |
| anything else | retained as `unknown_version` | none |

Version dispatch is explicit: `decodeV1` has a typed decoder for every event
name the listener models (`InvoiceCreatedV1`, `InvoiceListedV1`,
`InvoiceFundedV1`, `InvoiceReferenceV1`, `AttestationSubmittedV1`,
`RegistrationV1`, `PoolLPEventV1`, `PoolYieldDistributedV1`, `PoolDefaultV1`).
Adding a version means adding a new switch arm and typed decoders; existing
versions are never reinterpreted.

## Retention and decode status

Every `events_log` row records:

- `schema_version` — detected version (1 when absent)
- `decode_status` — `decoded`, `unknown_version`, or `malformed`
- `decode_error` — validation error, when applicable
- `tx_hash` — Soroban transaction hash when the RPC returns one
- `raw_event` — the original event as JSON: `id`, `contract_id`, `tx_hash`,
  `ledger`, `ledger_closed_at`, base64 `topics`, and base64 `value`.
  Undecoded rows also copy that object into `data`, so consumers that only read
  `data` still receive the complete retained event.

Unknown/newer versions are **retained, not applied**: the listener writes no
invoice/pool state, enqueues no webhook deliveries, and does not crash or
advance past the event without a record. The same is true for a malformed
payload at a known version; the decode error is returned once so operators see
it, but the retained row makes the retry a no-op.

Decoded rows also keep `raw_event`, so the original bytes survive even after a
successful decode.

## Querying retained events

```sql
-- Events waiting for a newer listener build
SELECT event_id, contract_id, tx_hash, ledger, event_type,
       schema_version, decode_status, decode_error, raw_event
FROM events_log
WHERE decode_status = 'unknown_version'
ORDER BY ledger ASC, id ASC;

-- Everything that was not applied
SELECT *
FROM events_log
WHERE decode_status <> 'decoded'
ORDER BY ledger ASC, id ASC;

-- Malformed rows for a specific event type
SELECT *
FROM events_log
WHERE decode_status = 'malformed' AND event_type = 'InvoiceCreated';
```

The same queries are exposed in Go as `db.GetUnknownVersionEvents`,
`db.GetEventsByDecodeStatus`, and `db.GetUndecodedEvents`. After applying a
retained row with a new build, `db.UpdateEventDecodeStatus` advances its status
without changing the event identity or raw payload.

## Webhook envelopes

`event_schema_version` is added to dispatch data and copied into the webhook
envelope. It versions the **contract event payload** and is separate from the
envelope's own `schema_version` (`1.0`). Envelopes produced for older data omit
the field when it is zero.
