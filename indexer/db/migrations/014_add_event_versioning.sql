-- Version-aware event retention (issue #116).
--
-- Decoded events keep their historical shape. Unknown/newer versions and
-- malformed known payloads are retained with their raw XDR topics/value and
-- the contract/transaction/ledger metadata needed to reprocess them later.
ALTER TABLE events_log
    ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS decode_status VARCHAR(32) NOT NULL DEFAULT 'decoded',
    ADD COLUMN IF NOT EXISTS decode_error TEXT,
    ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS raw_event JSONB;

-- Reprocessing scans undecoded rows, and operators query unknown versions.
CREATE INDEX IF NOT EXISTS idx_events_log_decode_status
    ON events_log (decode_status, ledger);
