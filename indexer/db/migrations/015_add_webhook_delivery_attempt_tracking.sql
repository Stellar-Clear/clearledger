-- Migration 015: Persist the bounded webhook delivery attempt schedule.
--
-- `attempts`, `next_attempt_at`, `status` and `last_error` already existed, but
-- the state they describe was implicit: a terminal row can only be identified
-- by inspecting `status`, and the attempt counter used to stop one short of
-- max_attempts. This migration makes the persisted contract explicit:
--
--   attempt_count   total attempts made, including the terminal failure
--   next_attempt_at when the next retry is due (unchanged for terminal rows)
--   terminal_status NULL while pending, delivered or dead_letter once finished
--   last_error      sanitized diagnostic only (never URL/secret material)
--   updated_at      maintained by the existing trigger
--
-- `attempts` and `status` are kept in sync for existing readers. The trigger
-- accepts writes to either the legacy or the explicit column so a rolling
-- deploy (old worker + new schema, or the reverse) cannot split them.
ALTER TABLE webhook_deliveries
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER,
    ADD COLUMN IF NOT EXISTS terminal_status TEXT;

-- Backfill the explicit counter from the legacy one.
UPDATE webhook_deliveries
SET attempt_count = attempts
WHERE attempt_count IS NULL;

-- Only delivered/dead_letter rows are terminal.
UPDATE webhook_deliveries
SET terminal_status = status
WHERE terminal_status IS NULL
  AND status IN ('delivered', 'dead_letter');

ALTER TABLE webhook_deliveries
    ALTER COLUMN attempt_count SET DEFAULT 0;
ALTER TABLE webhook_deliveries
    ALTER COLUMN attempt_count SET NOT NULL;

-- Keep the retry schedule bounded even for rows written before this migration.
UPDATE webhook_deliveries
SET max_attempts = LEAST(GREATEST(max_attempts, 1), 20)
WHERE max_attempts < 1 OR max_attempts > 20;

CREATE OR REPLACE FUNCTION sync_webhook_delivery_attempt_state()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Honor an explicit value in either column, otherwise default to 0.
        IF NEW.attempt_count IS NULL
           OR (NEW.attempt_count = 0 AND COALESCE(NEW.attempts, 0) <> 0) THEN
            NEW.attempt_count := COALESCE(NEW.attempts, 0);
        END IF;
        NEW.attempts := NEW.attempt_count;

        IF NEW.terminal_status IS NOT NULL THEN
            NEW.status := NEW.terminal_status;
        ELSIF NEW.status IN ('delivered', 'dead_letter') THEN
            NEW.terminal_status := NEW.status;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: mirror whichever counter the caller changed. Our own updates
    -- write both, so this is only here for older workers and direct SQL.
    IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       AND NEW.attempts IS NOT DISTINCT FROM OLD.attempts THEN
        NEW.attempts := NEW.attempt_count;
    ELSE
        NEW.attempt_count := NEW.attempts;
    END IF;

    IF NEW.terminal_status IS DISTINCT FROM OLD.terminal_status
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        IF NEW.terminal_status IS NOT NULL THEN
            NEW.status := NEW.terminal_status;
        END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status IN ('delivered', 'dead_letter') THEN
            NEW.terminal_status := NEW.status;
        ELSIF NEW.status = 'pending' THEN
            NEW.terminal_status := NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_webhook_delivery_attempt_state ON webhook_deliveries;
CREATE TRIGGER trigger_sync_webhook_delivery_attempt_state
    BEFORE INSERT OR UPDATE ON webhook_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION sync_webhook_delivery_attempt_state();

COMMENT ON COLUMN webhook_deliveries.attempt_count IS
    'Total delivery attempts made, including the terminal failed attempt.';
COMMENT ON COLUMN webhook_deliveries.terminal_status IS
    'NULL while pending; delivered or dead_letter once no further attempt is allowed.';
COMMENT ON COLUMN webhook_deliveries.last_error IS
    'Sanitized failure diagnostic; must never contain endpoint URLs, signing secrets or access tokens.';
