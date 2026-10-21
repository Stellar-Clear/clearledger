-- Replayed Soroban records must have a stable identity beyond their payload.
-- Older rows remain valid; new ingestion may populate event_sequence when the
-- RPC supplies it. The partial key allows older records to be migrated safely.
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS network VARCHAR(32) NOT NULL DEFAULT 'unknown';
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(64);
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS event_sequence BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_log_soroban_identity
  ON events_log (network, contract_id, tx_hash, event_sequence)
  WHERE tx_hash IS NOT NULL AND event_sequence IS NOT NULL;
