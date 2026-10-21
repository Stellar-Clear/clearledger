package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// WebhookSubscription represents a webhook subscription in the database.
//
// SigningSecret is the active key. When PreviousSigningSecret is set, it is the
// key that was active before the most recent rotation and remains acceptable
// only until PreviousSigningSecretExpiresAt.
type WebhookSubscription struct {
	ID                             uuid.UUID  `json:"id"`
	TargetURL                      string     `json:"target_url"`
	EventTypes                     []string   `json:"event_types"`
	SigningSecret                  string     `json:"signing_secret"`
	PreviousSigningSecret          string     `json:"previous_signing_secret,omitempty"`
	PreviousSigningSecretExpiresAt *time.Time `json:"previous_signing_secret_expires_at,omitempty"`
	Active                         bool       `json:"active"`
	CreatedAt                      time.Time  `json:"created_at"`
	UpdatedAt                      time.Time  `json:"updated_at"`
}

// VerificationSecrets returns the signing keys a receiver should accept for
// this subscription at now: the active key and, while the overlap window is
// open, the previous key.
func (s *WebhookSubscription) VerificationSecrets(now time.Time) []string {
	secrets := make([]string, 0, 2)
	if s.SigningSecret != "" {
		secrets = append(secrets, s.SigningSecret)
	}
	if s.PreviousSigningSecret != "" && s.PreviousSigningSecretExpiresAt != nil && now.Before(*s.PreviousSigningSecretExpiresAt) {
		secrets = append(secrets, s.PreviousSigningSecret)
	}
	return secrets
}

// Errors returned by RotateWebhookSigningSecret. They are exported so the API
// can map them to 404/409 without exposing database details to clients.
var (
	ErrWebhookSubscriptionNotFound = errors.New("db: webhook subscription not found")
	ErrWebhookRotationInProgress   = errors.New("db: previous webhook signing secret is still within its overlap window")
)

// webhookSubscriptionColumns keeps every subscription read in sync with
// scanWebhookSubscription.
const webhookSubscriptionColumns = `
			id, target_url, event_types, signing_secret,
			previous_signing_secret, previous_signing_secret_expires_at,
			active, created_at, updated_at`

// rowScanner is the Scan surface shared by pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanWebhookSubscription reads webhookSubscriptionColumns into a subscription.
func scanWebhookSubscription(row rowScanner) (*WebhookSubscription, error) {
	var sub WebhookSubscription
	var eventTypesArray pgtype.Array[pgtype.Text]
	var previousSecret *string
	var previousExpiresAt *time.Time

	if err := row.Scan(
		&sub.ID, &sub.TargetURL, &eventTypesArray, &sub.SigningSecret,
		&previousSecret, &previousExpiresAt,
		&sub.Active, &sub.CreatedAt, &sub.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if previousSecret != nil {
		sub.PreviousSigningSecret = *previousSecret
	}
	sub.PreviousSigningSecretExpiresAt = previousExpiresAt
	sub.EventTypes = textArrayToSlice(eventTypesArray)
	return &sub, nil
}

// nullableSecret turns the empty Go representation of an unset previous secret
// into SQL NULL so the database check constraint sees a complete pair.
func nullableSecret(secret string) any {
	if secret == "" {
		return nil
	}
	return secret
}

// DefaultClaimLockTTL is how long ClaimPendingDeliveries holds a row for a
// single attempt. It must stay well above the delivery worker's HTTP timeout so
// an in-flight attempt is never handed to a second worker, while still
// expiring quickly enough that a killed worker does not strand the queue.
const DefaultClaimLockTTL = 60 * time.Second

// MaxDeliveryAttempts is the hard upper bound the delivery worker and the
// Mark* helpers put on a row's max_attempts. Together with the worker's capped
// exponential backoff it bounds how long a broken subscriber can keep a
// delivery in the queue.
const MaxDeliveryAttempts = 20

// MaxDeliveryErrorLength caps the persisted last_error so a misbehaving
// subscriber cannot bloat the table with a multi-megabyte diagnostic.
const MaxDeliveryErrorLength = 1024

var deliveryURLPattern = regexp.MustCompile(`(?i)https?://[^\s"'<>]+`)

// SanitizeDeliveryError prepares a failure diagnostic for persistence in
// webhook_deliveries.last_error. The delivery URL is the trust boundary here:
// hosted endpoints commonly carry API keys in the path or query string, and an
// endpoint's signing secret must never be written to a table that operators and
// support tooling can read. Any redaction values (endpoint URL, signing secret)
// are replaced, bare URLs are stripped, and the result is length-capped.
func SanitizeDeliveryError(errMsg string, redactions ...string) string {
	// Remove URLs first: replacing a known endpoint prefix before this step
	// could leave its query string (and any token in it) behind.
	s := deliveryURLPattern.ReplaceAllString(errMsg, "[redacted-url]")
	for _, value := range redactions {
		if value == "" {
			continue
		}
		s = strings.ReplaceAll(s, value, "[redacted]")
	}
	s = strings.TrimSpace(s)
	if s == "" {
		s = "delivery failed"
	}
	if len(s) > MaxDeliveryErrorLength {
		cut := MaxDeliveryErrorLength
		for cut > 0 && !utf8.RuneStart(s[cut]) {
			cut--
		}
		s = strings.TrimSpace(s[:cut]) + "…"
	}
	return s
}

// WebhookDelivery represents a webhook delivery attempt in the database.
type WebhookDelivery struct {
	ID             int64           `json:"id"`
	SubscriptionID uuid.UUID       `json:"subscription_id"`
	EventType      string          `json:"event_type"`
	EventID        string          `json:"event_id"`
	Payload        json.RawMessage `json:"payload"`
	Attempts       int             `json:"attempts"` // legacy alias of AttemptCount
	AttemptCount   int             `json:"attempt_count"`
	MaxAttempts    int             `json:"max_attempts"`
	NextAttemptAt  time.Time       `json:"next_attempt_at"`
	LockedUntil    *time.Time      `json:"locked_until"`
	LastStatus     *int            `json:"last_status"`
	LastResponse   *string         `json:"last_response"`
	LastError      *string         `json:"last_error"`
	Status         string          `json:"status"`
	TerminalStatus *string         `json:"terminal_status"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	EndpointURL    string          `json:"endpoint_url"`    // denormalized for worker convenience
	EndpointSecret string          `json:"endpoint_secret"` // denormalized for worker convenience
	// EndpointPreviousSecret is the key being retired by a rotation; it is
	// used to attach a second signature until EndpointPreviousSecretExpiresAt.
	EndpointPreviousSecret          string     `json:"endpoint_previous_secret,omitempty"`
	EndpointPreviousSecretExpiresAt *time.Time `json:"endpoint_previous_secret_expires_at,omitempty"`
}

// deliveryColumns is the webhook_deliveries half of the claiming query's
// RETURNING list. Keep it in sync with scanWebhookDeliveries; the final four
// scanned columns (endpoint url and the active/previous signing keys) come
// from the CTE, not from this list.
const deliveryColumns = `
			wd.id, wd.subscription_id, wd.event_type, wd.event_id, wd.payload,
			wd.attempt_count, wd.attempts, wd.max_attempts, wd.next_attempt_at, wd.locked_until,
			wd.last_status, wd.last_response, wd.last_error, wd.terminal_status, wd.status,
			wd.created_at, wd.updated_at`

// eventTypesArray converts a string slice to the pgx array form used by the
// event_types column.
func eventTypesArray(eventTypes []string) pgtype.Array[pgtype.Text] {
	arr := pgtype.Array[pgtype.Text]{
		Elements: make([]pgtype.Text, len(eventTypes)),
		Dims:     []pgtype.ArrayDimension{{Length: int32(len(eventTypes)), LowerBound: 1}},
	}
	for i, et := range eventTypes {
		arr.Elements[i] = pgtype.Text{String: et, Valid: true}
	}
	return arr
}

// CreateWebhookSubscription inserts a new webhook subscription.
func CreateWebhookSubscription(ctx context.Context, sub *WebhookSubscription) error {
	query := `
		INSERT INTO webhook_subscriptions (
			target_url, event_types, signing_secret, active,
			previous_signing_secret, previous_signing_secret_expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at
	`
	err := Pool.QueryRow(ctx, query,
		sub.TargetURL, eventTypesArray(sub.EventTypes), sub.SigningSecret, sub.Active,
		nullableSecret(sub.PreviousSigningSecret), sub.PreviousSigningSecretExpiresAt,
	).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt)
	if err != nil {
		return fmt.Errorf("db: create webhook subscription: %w", err)
	}
	return nil
}

// GetWebhookSubscriptionByID retrieves a webhook subscription by ID.
func GetWebhookSubscriptionByID(ctx context.Context, id uuid.UUID) (*WebhookSubscription, error) {
	query := `SELECT ` + webhookSubscriptionColumns + ` FROM webhook_subscriptions WHERE id = $1`
	sub, err := scanWebhookSubscription(Pool.QueryRow(ctx, query, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("db: get webhook subscription: %w", err)
	}
	return sub, nil
}

// ListActiveWebhookSubscriptionsForEvent retrieves all active subscriptions for a given event type.
func ListActiveWebhookSubscriptionsForEvent(ctx context.Context, eventType string) ([]*WebhookSubscription, error) {
	query := `SELECT ` + webhookSubscriptionColumns + `
		FROM webhook_subscriptions
		WHERE active = TRUE AND $1 = ANY(event_types)`
	rows, err := Pool.Query(ctx, query, eventType)
	if err != nil {
		return nil, fmt.Errorf("db: list webhook subscriptions: %w", err)
	}
	defer rows.Close()

	var subs []*WebhookSubscription
	for rows.Next() {
		sub, err := scanWebhookSubscription(rows)
		if err != nil {
			return nil, fmt.Errorf("db: scan webhook subscription: %w", err)
		}
		subs = append(subs, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("db: iterate webhook subscriptions: %w", err)
	}
	return subs, nil
}

// ListAllWebhookSubscriptions retrieves all webhook subscriptions (for admin/management).
func ListAllWebhookSubscriptions(ctx context.Context) ([]*WebhookSubscription, error) {
	query := `SELECT ` + webhookSubscriptionColumns + `
		FROM webhook_subscriptions
		ORDER BY created_at DESC`
	rows, err := Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("db: list all webhook subscriptions: %w", err)
	}
	defer rows.Close()

	var subs []*WebhookSubscription
	for rows.Next() {
		sub, err := scanWebhookSubscription(rows)
		if err != nil {
			return nil, fmt.Errorf("db: scan webhook subscription: %w", err)
		}
		subs = append(subs, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("db: iterate all webhook subscriptions: %w", err)
	}
	return subs, nil
}

// UpdateWebhookSubscription updates a webhook subscription.
func UpdateWebhookSubscription(ctx context.Context, sub *WebhookSubscription) error {
	query := `
		UPDATE webhook_subscriptions
		SET target_url = $1, event_types = $2, signing_secret = $3, active = $4,
		    previous_signing_secret = $5, previous_signing_secret_expires_at = $6,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $7
		RETURNING updated_at
	`
	err := Pool.QueryRow(ctx, query,
		sub.TargetURL, eventTypesArray(sub.EventTypes), sub.SigningSecret, sub.Active,
		nullableSecret(sub.PreviousSigningSecret), sub.PreviousSigningSecretExpiresAt, sub.ID,
	).Scan(&sub.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("db: update webhook subscription: not found")
		}
		return fmt.Errorf("db: update webhook subscription: %w", err)
	}
	return nil
}

// RotateWebhookSigningSecret promotes newSecret to the active key and keeps the
// old active key as the previous key until now+overlap. This is the write half
// of overlapping rotation: the delivery worker can attach the previous key's
// signature during the window, and receivers can accept either key until it
// expires.
//
// When ownerAddress is non-empty the update is scoped to that subscriber, which
// is the API's trust boundary. An empty ownerAddress is the operator/admin path
// (documented in docs/webhooks.md) and assumes database-level access.
//
// A second rotation is rejected with ErrWebhookRotationInProgress while the
// existing previous key is still valid. Rotating again would discard a key the
// subscriber may still be relying on. A missing subscription or an owner
// mismatch returns ErrWebhookSubscriptionNotFound, so the API does not reveal
// whether someone else's subscription exists.
func RotateWebhookSigningSecret(ctx context.Context, id uuid.UUID, ownerAddress, newSecret string, overlap time.Duration) (*WebhookSubscription, error) {
	if strings.TrimSpace(newSecret) == "" {
		return nil, fmt.Errorf("db: rotate webhook signing secret: new secret must not be empty")
	}
	if overlap <= 0 {
		return nil, fmt.Errorf("db: rotate webhook signing secret: overlap must be positive")
	}
	if Pool == nil {
		return nil, fmt.Errorf("db: rotate webhook signing secret: database pool not initialized")
	}

	tx, err := Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("db: rotate webhook signing secret: begin: %w", err)
	}
	defer rollbackOnError(ctx, tx)

	query := `SELECT ` + webhookSubscriptionColumns + ` FROM webhook_subscriptions WHERE id = $1`
	args := []any{id}
	if ownerAddress != "" {
		query += ` AND user_address = $2`
		args = append(args, ownerAddress)
	}
	query += ` FOR UPDATE`

	current, err := scanWebhookSubscription(tx.QueryRow(ctx, query, args...))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWebhookSubscriptionNotFound
		}
		return nil, fmt.Errorf("db: rotate webhook signing secret: lock subscription: %w", err)
	}

	now := time.Now()
	if current.PreviousSigningSecretExpiresAt != nil && now.Before(*current.PreviousSigningSecretExpiresAt) {
		return nil, ErrWebhookRotationInProgress
	}
	if newSecret == current.SigningSecret {
		return nil, fmt.Errorf("db: rotate webhook signing secret: new secret must differ from the active secret")
	}
	expiresAt := now.Add(overlap)

	update := `
		UPDATE webhook_subscriptions
		SET previous_signing_secret = signing_secret,
		    previous_signing_secret_expires_at = $1,
		    signing_secret = $2,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $3
		RETURNING ` + webhookSubscriptionColumns + `
	`
	rotated, err := scanWebhookSubscription(tx.QueryRow(ctx, update, expiresAt, newSecret, id))
	if err != nil {
		return nil, fmt.Errorf("db: rotate webhook signing secret: update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("db: rotate webhook signing secret: commit: %w", err)
	}
	return rotated, nil
}

// DeleteWebhookSubscription deletes a webhook subscription.
func DeleteWebhookSubscription(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM webhook_subscriptions WHERE id = $1`
	_, err := Pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("db: delete webhook subscription: %w", err)
	}
	return nil
}

// DisableWebhookSubscription marks a subscription as inactive.
func DisableWebhookSubscription(ctx context.Context, id uuid.UUID) error {
	query := `UPDATE webhook_subscriptions SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := Pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("db: disable webhook subscription: %w", err)
	}
	return nil
}

// CreateWebhookDelivery creates a new webhook delivery record. The q
// parameter lets the listener enqueue delivery rows on the same transaction
// that applies the event's state change, so an event's webhook fan-out either
// commits with the event or not at all.
func CreateWebhookDelivery(ctx context.Context, q Querier, subscriptionID uuid.UUID, eventType, eventID string, payload []byte) error {
	query := `
		INSERT INTO webhook_deliveries (subscription_id, event_type, event_id, payload)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (subscription_id, event_id) DO NOTHING
	`
	_, err := q.Exec(ctx, query, subscriptionID, eventType, eventID, payload)
	if err != nil {
		return fmt.Errorf("db: create webhook delivery: %w", err)
	}
	return nil
}

// GetPendingDeliveries claims a batch of pending deliveries for the caller
// using DefaultClaimLockTTL and returns them. Claiming happens on the read
// because this is the path both delivery workers use to pick up work: a plain
// SELECT let two indexer replicas (or an old and a new pod during a rolling
// deploy) read the same rows and POST the same event twice. Use
// ClaimPendingDeliveries when the lock duration needs to differ.
func GetPendingDeliveries(ctx context.Context, limit int) ([]*WebhookDelivery, error) {
	return ClaimPendingDeliveries(ctx, limit, DefaultClaimLockTTL)
}

// ClaimPendingDeliveries atomically claims up to limit deliveries whose retry
// time has arrived and whose previous claim (if any) has expired.
//
// FOR UPDATE SKIP LOCKED makes concurrent claims from other workers or replicas
// disjoint, and writing locked_until makes the claim outlive the statement:
// other workers no longer see the row until the attempt records an outcome (all
// Mark* helpers clear the lock) or the lock expires.
//
// This is claim-then-delete, not claim-and-delete: a worker that dies mid-send
// leaves the row pending, and it becomes claimable again once locked_until
// passes. The queue is therefore at-least-once and subscribers must dedupe on
// event_id.
func ClaimPendingDeliveries(ctx context.Context, limit int, lockFor time.Duration) ([]*WebhookDelivery, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("db: claim pending deliveries: limit must be positive, got %d", limit)
	}
	if lockFor <= 0 {
		lockFor = DefaultClaimLockTTL
	}

	query := `
		WITH claimable AS (
			SELECT wd.id, ws.target_url, ws.signing_secret,
			       ws.previous_signing_secret, ws.previous_signing_secret_expires_at
			FROM webhook_deliveries wd
			JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id
			WHERE wd.status = 'pending'
				AND wd.next_attempt_at <= CURRENT_TIMESTAMP
				AND (wd.locked_until IS NULL OR wd.locked_until < CURRENT_TIMESTAMP)
				AND ws.active = TRUE
			ORDER BY wd.next_attempt_at ASC
			LIMIT $1
			FOR UPDATE OF wd SKIP LOCKED
		)
		UPDATE webhook_deliveries wd
		SET locked_until = CURRENT_TIMESTAMP + make_interval(secs => $2),
		    updated_at = CURRENT_TIMESTAMP
		FROM claimable c
		WHERE wd.id = c.id
		RETURNING ` + deliveryColumns + `, c.target_url, c.signing_secret,
		          c.previous_signing_secret, c.previous_signing_secret_expires_at
	`

	rows, err := Pool.Query(ctx, query, limit, lockFor.Seconds())
	if err != nil {
		return nil, fmt.Errorf("db: claim pending deliveries: %w", err)
	}
	defer rows.Close()

	return scanWebhookDeliveries(rows)
}

// scanWebhookDeliveries reads rows produced by deliveryColumns.
func scanWebhookDeliveries(rows pgx.Rows) ([]*WebhookDelivery, error) {
	var deliveries []*WebhookDelivery
	for rows.Next() {
		var d WebhookDelivery
		if err := rows.Scan(
			&d.ID, &d.SubscriptionID, &d.EventType, &d.EventID, &d.Payload,
			&d.AttemptCount, &d.Attempts, &d.MaxAttempts, &d.NextAttemptAt, &d.LockedUntil,
			&d.LastStatus, &d.LastResponse, &d.LastError, &d.TerminalStatus, &d.Status,
			&d.CreatedAt, &d.UpdatedAt, &d.EndpointURL, &d.EndpointSecret,
			&d.EndpointPreviousSecret, &d.EndpointPreviousSecretExpiresAt,
		); err != nil {
			return nil, fmt.Errorf("db: scan webhook delivery: %w", err)
		}
		// The migration keeps the legacy and explicit counters equal, but
		// normalizing here protects callers from a row written by an older
		// worker that only knew `attempts`.
		if d.AttemptCount < d.Attempts {
			d.AttemptCount = d.Attempts
		}
		d.Attempts = d.AttemptCount
		deliveries = append(deliveries, &d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("db: iterate webhook deliveries: %w", err)
	}
	return deliveries, nil
}

// MarkDeliverySuccess records a successful attempt and makes the row terminal.
// The update is idempotent and only applies while the row is still pending, so
// a duplicate or late success callback cannot increment the counter twice and
// a delivered row is never returned to the retry queue.
func MarkDeliverySuccess(ctx context.Context, deliveryID int64, statusCode int, response string) error {
	query := `
		UPDATE webhook_deliveries
		SET status = 'delivered',
		    terminal_status = 'delivered',
		    last_status = $1,
		    last_response = $2,
		    last_error = NULL,
		    attempts = attempts + 1,
		    attempt_count = attempt_count + 1,
		    locked_until = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $3 AND status = 'pending'
	`
	_, err := Pool.Exec(ctx, query, statusCode, response, deliveryID)
	if err != nil {
		return fmt.Errorf("db: mark delivery success: %w", err)
	}
	return nil
}

// MarkDeliveryRetry marks a webhook delivery as failed and schedules a retry.
// If the next attempt reaches the bounded max_attempts, the row moves to the
// terminal dead_letter state instead of scheduling another attempt.
//
// The update only applies to a pending row, releases the claim, and (when
// expectedAttempts is non-negative) only applies while attempt_count still has
// the value the worker claimed. That compare-and-set makes duplicate outcome
// writes for the same attempt no-ops rather than extra attempt increments.
func MarkDeliveryRetry(ctx context.Context, deliveryID int64, nextAttemptAt time.Time, statusCode *int, errorMsg string) error {
	return MarkDeliveryRetryIfAttempt(ctx, deliveryID, -1, nextAttemptAt, statusCode, errorMsg)
}

// MarkDeliveryRetryIfAttempt is MarkDeliveryRetry with a compare-and-set on the
// attempt counter. Pass -1 to skip the comparison (the legacy MarkDeliveryRetry
// behavior). The failure diagnostic is sanitized before it is persisted.
func MarkDeliveryRetryIfAttempt(ctx context.Context, deliveryID int64, expectedAttempts int, nextAttemptAt time.Time, statusCode *int, errorMsg string) error {
	errorMsg = SanitizeDeliveryError(errorMsg)
	query := `
		UPDATE webhook_deliveries
		SET status = CASE
				WHEN attempt_count + 1 >= LEAST(GREATEST(max_attempts, 1), $5) THEN 'dead_letter'
				ELSE 'pending'
			END,
			terminal_status = CASE
				WHEN attempt_count + 1 >= LEAST(GREATEST(max_attempts, 1), $5) THEN 'dead_letter'
				ELSE NULL
			END,
			last_status = $1,
			last_error = $2,
			next_attempt_at = CASE
				WHEN attempt_count + 1 >= LEAST(GREATEST(max_attempts, 1), $5) THEN next_attempt_at
				ELSE $3
			END,
			attempts = attempt_count + 1,
			attempt_count = attempt_count + 1,
			locked_until = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $4
		  AND status = 'pending'
		  AND ($6 < 0 OR attempt_count = $6)
	`
	_, err := Pool.Exec(ctx, query, statusCode, errorMsg, nextAttemptAt, deliveryID, MaxDeliveryAttempts, expectedAttempts)
	if err != nil {
		return fmt.Errorf("db: mark delivery retry: %w", err)
	}
	return nil
}

// MarkDeliveryDeadLetter marks a webhook delivery as terminally dead-lettered
// (retries exhausted). It records the attempt that failed, sanitizes the
// diagnostic and releases the claim. Like the other Mark* helpers it is
// idempotent: a row that is already terminal is left untouched.
func MarkDeliveryDeadLetter(ctx context.Context, deliveryID int64, errorMsg string) error {
	return MarkDeliveryDeadLetterIfAttempt(ctx, deliveryID, -1, errorMsg)
}

// MarkDeliveryDeadLetterIfAttempt is MarkDeliveryDeadLetter with a
// compare-and-set on the attempt counter so a duplicate outcome write cannot
// increment attempt_count twice.
func MarkDeliveryDeadLetterIfAttempt(ctx context.Context, deliveryID int64, expectedAttempts int, errorMsg string) error {
	return MarkDeliveryDeadLetterWithStatusIfAttempt(ctx, deliveryID, expectedAttempts, nil, errorMsg)
}

// MarkDeliveryDeadLetterWithStatusIfAttempt records the terminal failed
// attempt, including the HTTP status when the failure came from a response.
// The CAS argument behaves like MarkDeliveryRetryIfAttempt.
func MarkDeliveryDeadLetterWithStatusIfAttempt(ctx context.Context, deliveryID int64, expectedAttempts int, statusCode *int, errorMsg string) error {
	errorMsg = SanitizeDeliveryError(errorMsg)
	query := `
		UPDATE webhook_deliveries
		SET status = 'dead_letter',
		    terminal_status = 'dead_letter',
		    last_status = COALESCE($1, last_status),
		    last_error = $2,
		    attempts = attempt_count + 1,
		    attempt_count = attempt_count + 1,
		    locked_until = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $3
		  AND status = 'pending'
		  AND ($4 < 0 OR attempt_count = $4)
	`
	_, err := Pool.Exec(ctx, query, statusCode, errorMsg, deliveryID, expectedAttempts)
	if err != nil {
		return fmt.Errorf("db: mark delivery dead letter: %w", err)
	}
	return nil
}

// textArrayToSlice converts a pgtype.Array[pgtype.Text] to a Go string slice.
func textArrayToSlice(arr pgtype.Array[pgtype.Text]) []string {
	dims := arr.Dimensions()
	if dims == nil || len(dims) == 0 || dims[0].Length == 0 {
		return []string{}
	}
	result := make([]string, 0, dims[0].Length)
	for _, elem := range arr.Elements {
		if elem.Valid {
			result = append(result, elem.String)
		}
	}
	return result
}
