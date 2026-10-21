package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"clearledger/indexer/db"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type WebhookSubscription struct {
	ID          uuid.UUID `json:"id"`
	UserAddress string    `json:"user_address"`
	URL         string    `json:"url"`
	Secret      string    `json:"secret,omitempty"`
	EventTypes  []string  `json:"event_types"`
	CreatedAt   time.Time `json:"created_at"`
}

type CreateWebhookRequest struct {
	URL        string   `json:"url"`
	EventTypes []string `json:"event_types"`
}

// RotateWebhookRequest optionally overrides the configured overlap window.
// OverlapSeconds is capped so a caller cannot keep a compromised key valid
// indefinitely; zero uses WEBHOOK_SECRET_OVERLAP.
type RotateWebhookRequest struct {
	OverlapSeconds int `json:"overlap_seconds,omitempty"`
}

const (
	defaultWebhookSecretOverlap = 24 * time.Hour
	maxWebhookSecretOverlap     = 30 * 24 * time.Hour
)

// rotateWebhookSecret is isolated in a variable so handler tests can exercise
// authorization and error mapping without a database.
var rotateWebhookSecret = func(ctx context.Context, id uuid.UUID, ownerAddress, newSecret string, overlap time.Duration) (WebhookSubscription, error) {
	rotated, err := db.RotateWebhookSigningSecret(ctx, id, ownerAddress, newSecret, overlap)
	if err != nil {
		return WebhookSubscription{}, err
	}
	return WebhookSubscription{
		ID:          rotated.ID,
		UserAddress: ownerAddress,
		URL:         rotated.TargetURL,
		Secret:      rotated.SigningSecret,
		EventTypes:  rotated.EventTypes,
		CreatedAt:   rotated.CreatedAt,
	}, nil
}

func generateSecret() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func isSafeURL(urlString string) bool {
	u, err := url.ParseRequestURI(urlString)
	if err != nil {
		return false
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}

	host := u.Hostname()
	if host == "" {
		return false
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		ip := net.ParseIP(host)
		if ip == nil {
			return false
		}
		ips = []net.IP{ip}
	}

	for _, ip := range ips {
		if ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return false
		}
	}

	return true
}

// Database access functions are isolated in variables to allow mocking in tests.
var createWebhookSub = func(ctx context.Context, userAddr, u, secret string, eventTypes []string) (WebhookSubscription, error) {
	var sub WebhookSubscription
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO webhook_subscriptions (user_address, target_url, signing_secret, event_types)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_address, target_url, signing_secret, event_types, created_at
	`, userAddr, u, secret, eventTypes).Scan(&sub.ID, &sub.UserAddress, &sub.URL, &sub.Secret, &sub.EventTypes, &sub.CreatedAt)
	return sub, err
}

var getWebhookSubs = func(ctx context.Context, userAddr string) ([]WebhookSubscription, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT id, user_address, target_url, event_types, created_at
		FROM webhook_subscriptions
		WHERE user_address = $1
		ORDER BY created_at DESC
	`, userAddr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subs := []WebhookSubscription{}
	for rows.Next() {
		var sub WebhookSubscription
		if err := rows.Scan(&sub.ID, &sub.UserAddress, &sub.URL, &sub.EventTypes, &sub.CreatedAt); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return subs, nil
}

var deleteWebhookSub = func(ctx context.Context, id uuid.UUID, userAddr string) (int64, error) {
	cmd, err := db.Pool.Exec(ctx, `
		DELETE FROM webhook_subscriptions
		WHERE id = $1 AND user_address = $2
	`, id, userAddr)
	if err != nil {
		return 0, err
	}
	return cmd.RowsAffected(), nil
}

func (h *APIHandler) HandleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	userAddr, ok := GetUserAddress(r.Context())
	if !ok {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req CreateWebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.URL == "" {
		writeAPIError(w, r, http.StatusBadRequest, "url is required")
		return
	}
	if len(req.EventTypes) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "event_types is required")
		return
	}

	if !isSafeURL(req.URL) {
		writeAPIError(w, r, http.StatusBadRequest, "invalid or unsafe url")
		return
	}

	secret, err := generateSecret()
	if err != nil {
		internalError(w, r, "failed to generate webhook secret", err)
		return
	}

	sub, err := createWebhookSub(r.Context(), userAddr, req.URL, secret, req.EventTypes)
	if err != nil {
		internalError(w, r, "failed to create webhook subscription", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(sub)
}

func (h *APIHandler) HandleGetWebhooks(w http.ResponseWriter, r *http.Request) {
	userAddr, ok := GetUserAddress(r.Context())
	if !ok {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}

	subs, err := getWebhookSubs(r.Context(), userAddr)
	if err != nil {
		internalError(w, r, "failed to query webhooks", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": subs,
	})
}

// HandleRotateWebhook rotates the caller's subscription onto a new signing
// secret. Trust boundary: the request is authorized by the existing JWT
// middleware and the database update is scoped to the authenticated address;
// a caller cannot rotate another subscriber's webhook. The generated secret is
// returned in this response only (like Create), never logged. Subscribers must
// already accept the previous key on X-ClearLedger-Signature-Previous, or the
// new secret on X-ClearLedger-Signature, to avoid a delivery gap.
func (h *APIHandler) HandleRotateWebhook(w http.ResponseWriter, r *http.Request) {
	userAddr, ok := GetUserAddress(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	overlap := defaultWebhookSecretOverlap
	if h.cfg != nil && h.cfg.WebhookSecretOverlap > 0 {
		overlap = h.cfg.WebhookSecretOverlap
	}

	var req RotateWebhookRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
	}
	if req.OverlapSeconds < 0 {
		http.Error(w, "overlap_seconds must not be negative", http.StatusBadRequest)
		return
	}
	if req.OverlapSeconds > 0 {
		overlap = time.Duration(req.OverlapSeconds) * time.Second
	}
	if overlap > maxWebhookSecretOverlap {
		http.Error(w, "overlap_seconds exceeds the maximum of 30 days", http.StatusBadRequest)
		return
	}

	newSecret, err := generateSecret()
	if err != nil {
		http.Error(w, "failed to generate secret", http.StatusInternalServerError)
		return
	}

	sub, err := rotateWebhookSecret(r.Context(), id, userAddr, newSecret, overlap)
	if err != nil {
		switch {
		case errors.Is(err, db.ErrWebhookSubscriptionNotFound):
			http.Error(w, "webhook not found", http.StatusNotFound)
		case errors.Is(err, db.ErrWebhookRotationInProgress):
			http.Error(w, "a previous signing secret is still within its overlap window", http.StatusConflict)
		default:
			http.Error(w, "failed to rotate webhook secret", http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, sub)
}

func (h *APIHandler) HandleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	userAddr, ok := GetUserAddress(r.Context())
	if !ok {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid id")
		return
	}

	affected, err := deleteWebhookSub(r.Context(), id, userAddr)
	if err != nil {
		internalError(w, r, "failed to delete webhook", err)
		return
	}

	if affected == 0 {
		writeAPIError(w, r, http.StatusNotFound, "webhook not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
