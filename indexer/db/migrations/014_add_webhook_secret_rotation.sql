-- Migration 014: overlapping webhook signing-secret rotation
--
-- `signing_secret` remains the active key. During a rotation the previously
-- active key is copied to `previous_signing_secret` and stays valid until
-- `previous_signing_secret_expires_at`; after that instant it must be ignored
-- for verification and must not be used to sign new deliveries.
--
-- Both columns are nullable so existing subscriptions keep working unchanged:
-- a row with no rotation in progress has no previous key and no expiry.
ALTER TABLE webhook_subscriptions
    ADD COLUMN IF NOT EXISTS previous_signing_secret TEXT,
    ADD COLUMN IF NOT EXISTS previous_signing_secret_expires_at TIMESTAMP;

ALTER TABLE webhook_subscriptions
    DROP CONSTRAINT IF EXISTS webhook_subscriptions_previous_secret_complete;

ALTER TABLE webhook_subscriptions
    ADD CONSTRAINT webhook_subscriptions_previous_secret_complete
    CHECK (
        (previous_signing_secret IS NULL AND previous_signing_secret_expires_at IS NULL)
        OR (previous_signing_secret IS NOT NULL AND previous_signing_secret_expires_at IS NOT NULL)
    );

COMMENT ON COLUMN webhook_subscriptions.previous_signing_secret IS
    'The key that was active before the most recent rotation; valid only until previous_signing_secret_expires_at.';

COMMENT ON COLUMN webhook_subscriptions.previous_signing_secret_expires_at IS
    'End of the overlap window for previous_signing_secret; NULL when no rotation is in progress.';
