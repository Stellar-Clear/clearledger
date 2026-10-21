package api

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	indexermiddleware "clearledger/indexer/middleware"
	"github.com/getsentry/sentry-go"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
)

func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeAPIError(w, r, http.StatusUnauthorized, "missing token")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				writeAPIError(w, r, http.StatusUnauthorized, "invalid authorization header")
				return
			}

			tokenStr := strings.TrimSpace(parts[1])
			if tokenStr == "" || strings.ContainsAny(tokenStr, " \t\r\n") {
				writeAPIError(w, r, http.StatusUnauthorized, "invalid authorization header")
				return
			}

			token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
				}
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				writeAPIError(w, r, http.StatusUnauthorized, "invalid or expired token")
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				writeAPIError(w, r, http.StatusUnauthorized, "invalid token claims")
				return
			}

			sub, ok := claims["sub"].(string)
			if !ok {
				writeAPIError(w, r, http.StatusUnauthorized, "missing token subject")
				return
			}

			ctx := WithUserAddress(r.Context(), sub)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		origin := strings.TrimSpace(o)
		if origin != "" {
			originSet[origin] = struct{}{}
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin != "" {
				if _, ok := originSet[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Expose-Headers", "X-Next-Cursor")
					w.Header().Set("Vary", "Origin")
				} else {
					writeAPIError(w, r, http.StatusForbidden, "origin is not allowed")
					return
				}
			}

			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RecoveryMiddleware recovers panics in downstream handlers, reports them to
// Sentry (a no-op if SENTRY_DSN is unset), logs the panic and stack trace
// through the app's structured slog logger, and returns a 500 to the client
// instead of letting chi's default Recoverer print an unstructured stack
// trace straight to stdout.
func RecoveryMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rvr := recover(); rvr != nil {
					sentry.CurrentHub().Recover(rvr)

					slog.Error("panic recovered in HTTP handler",
						"error", fmt.Sprintf("%v", rvr),
						"stack", string(debug.Stack()),
						"method", r.Method,
						"path", r.URL.Path,
					)

					writeAPIError(w, r, http.StatusInternalServerError, "internal server error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func SecurityHeadersMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Security-Policy", "default-src 'self'")
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			next.ServeHTTP(w, r)
		})
	}
}

type clientBucket struct {
	mu     sync.Mutex
	tokens float64
	last   time.Time
}

type perClientRateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*clientBucket
	rps     float64
	burst   int
	maxSize int
	done    chan struct{}
}

func newPerClientRateLimiter(rps int, burst int, maxSize int) *perClientRateLimiter {
	rl := &perClientRateLimiter{
		buckets: make(map[string]*clientBucket),
		rps:     float64(rps),
		burst:   burst,
		maxSize: maxSize,
		done:    make(chan struct{}),
	}
	go rl.cleanupLoop()
	return rl
}

func (rl *perClientRateLimiter) Stop() {
	close(rl.done)
}

func (rl *perClientRateLimiter) allow(clientKey string) bool {
	rl.mu.Lock()
	bucket, ok := rl.buckets[clientKey]
	if !ok {
		bucket = &clientBucket{
			tokens: float64(rl.burst),
			last:   time.Now(),
		}
		rl.buckets[clientKey] = bucket
		if len(rl.buckets) > rl.maxSize {
			rl.evictOldest()
		}
	}
	rl.mu.Unlock()

	bucket.mu.Lock()
	defer bucket.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(bucket.last).Seconds()
	bucket.tokens += elapsed * rl.rps
	if bucket.tokens > float64(rl.burst) {
		bucket.tokens = float64(rl.burst)
	}
	bucket.last = now

	if bucket.tokens >= 1 {
		bucket.tokens--
		return true
	}
	return false
}

func (rl *perClientRateLimiter) evictOldest() {
	// rl.mu is held by the caller; bucket.mu must be taken before reading
	// bucket.last so evictOldest never races with allow()'s refill updates.
	var oldestKey string
	var oldestTime time.Time
	for key, bucket := range rl.buckets {
		bucket.mu.Lock()
		last := bucket.last
		bucket.mu.Unlock()
		if oldestKey == "" || last.Before(oldestTime) {
			oldestKey = key
			oldestTime = last
		}
	}
	if oldestKey != "" {
		delete(rl.buckets, oldestKey)
	}
}

func (rl *perClientRateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.evictStale()
		case <-rl.done:
			return
		}
	}
}

func (rl *perClientRateLimiter) evictStale() {
	cutoff := time.Now().Add(-10 * time.Minute)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for key, bucket := range rl.buckets {
		bucket.mu.Lock()
		if bucket.last.Before(cutoff) {
			delete(rl.buckets, key)
		}
		bucket.mu.Unlock()
	}
}

func getClientKey(r *http.Request) string {
	if sub, ok := GetUserAddress(r.Context()); ok {
		return "jwt:" + sub
	}

	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	return "ip:" + addr
}

func parseTrustedProxyCIDRs(raw string) []*net.IPNet {
	if strings.TrimSpace(raw) == "" {
		return nil
	}

	cidrs := make([]*net.IPNet, 0)
	for _, entry := range strings.Split(raw, ",") {
		cidr := strings.TrimSpace(entry)
		if cidr == "" {
			continue
		}
		if ip := net.ParseIP(cidr); ip != nil {
			if ip.To4() != nil {
				cidr = ip.String() + "/32"
			} else {
				cidr = ip.String() + "/128"
			}
		}
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			slog.Warn("invalid trusted proxy CIDR; ignoring", "cidr", cidr, "error", err)
			continue
		}
		cidrs = append(cidrs, network)
	}
	return cidrs
}

func trustedClientIP(r *http.Request, trustedProxyNets []*net.IPNet) string {
	if len(trustedProxyNets) == 0 {
		return ""
	}

	remoteHost := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remoteHost); err == nil {
		remoteHost = host
	}
	remoteIP := net.ParseIP(remoteHost)
	if remoteIP == nil {
		return ""
	}

	trusted := false
	for _, network := range trustedProxyNets {
		if network.Contains(remoteIP) {
			trusted = true
			break
		}
	}
	if !trusted {
		return ""
	}

	for _, headerName := range []string{"X-Forwarded-For", "X-Real-IP", "True-Client-IP"} {
		if value := strings.TrimSpace(r.Header.Get(headerName)); value != "" {
			parts := strings.Split(value, ",")
			for _, part := range parts {
				candidate := strings.TrimSpace(part)
				if candidate == "" {
					continue
				}
				if ip := net.ParseIP(candidate); ip != nil {
					return ip.String()
				}
			}
		}
	}
	return ""
}

func TrustedProxyMiddleware(trustedProxyCIDRs []string) func(http.Handler) http.Handler {
	trustedProxyNets := parseTrustedProxyCIDRs(strings.Join(trustedProxyCIDRs, ","))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if trustedIP := trustedClientIP(r, trustedProxyNets); trustedIP != "" {
				r.RemoteAddr = net.JoinHostPort(trustedIP, "0")
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RateLimitMiddleware(rl *perClientRateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clientKey := getClientKey(r)
			if !rl.allow(clientKey) {
				w.Header().Set("Retry-After", "1")
				writeAPIError(w, r, http.StatusTooManyRequests, "too many requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func NewRouter(h *APIHandler) (*chi.Mux, func()) {
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(RecoveryMiddleware())
	r.Use(TrustedProxyMiddleware(h.cfg.TrustedProxyCIDRs))
	r.Use(CORSMiddleware(h.cfg.CORSAllowedOrigins))
	r.Use(SecurityHeadersMiddleware())

	// Per-client rate limiter for auth and invoice creation
	// Max 1000 clients to bound memory usage
	rl := newPerClientRateLimiter(h.cfg.RateLimitRPS, h.cfg.RateLimitRPS*2, 1000)
	invoiceLimiter := indexermiddleware.NewInvoiceRateLimiterWithConfig(h.cfg.InvoiceRateLimit, h.cfg.InvoiceRateLimitWindow)

	// Prometheus metrics are public for local development, but deployments can
	// require a bearer token without changing the scrape URL.
	metrics := MetricsHandler().ServeHTTP
	if h.cfg.MetricsToken == "" {
		slog.Warn("metrics endpoint is unauthenticated; set METRICS_TOKEN in production")
		r.Get("/metrics", metrics)
	} else {
		r.With(metricsTokenMiddleware(h.cfg.MetricsToken)).Get("/metrics", metrics)
	}

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := h.CheckHealth(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status": "degraded", "error": "listener or database unavailable"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status": "ok"}`))
	})

	// Unprotected authentication routes (rate limited)
	r.Group(func(r chi.Router) {
		r.Use(RateLimitMiddleware(rl))
		r.Get("/auth", h.HandleGetAuth)
		r.Post("/auth", h.HandlePostAuth)
	})

	// Public read-only routes (rate limited to protect the API and Soroban-backed reads)
	r.Group(func(r chi.Router) {
		r.Use(RateLimitMiddleware(rl))
		r.Get("/stats", h.HandleGetStats)
		r.Get("/events", h.HandleGetEvents)
		r.Get("/invoices/{id}", h.HandleGetInvoiceByID)
		r.Get("/invoices", h.HandleGetInvoices)
		r.Get("/pool/stats", h.HandleGetPoolStats)
		r.Get("/pool/snapshots", h.HandleGetPoolSnapshots)
		r.Get("/pool/position/{address}", h.HandleGetLPPosition)
	})

	// Protected routes (rate limited)
	r.Group(func(r chi.Router) {
		r.Use(AuthMiddleware(h.cfg.JWTSecret))
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if addr, ok := GetUserAddress(req.Context()); ok {
					req = req.WithContext(indexermiddleware.WithClientAddress(req.Context(), addr))
				}
				next.ServeHTTP(w, req)
			})
		})
		r.Use(RateLimitMiddleware(rl))
		r.With(indexermiddleware.InvoiceRateLimitMiddleware(invoiceLimiter)).Post("/invoices", h.HandleCreateInvoice)

		// API connection diagnostics. Protected because it exposes operational
		// metadata, though the payload never contains URLs, tokens, or env values.
		r.Get("/diagnostics", h.HandleGetDiagnostics)

		// Webhooks
		r.Post("/webhooks", h.HandleCreateWebhook)
		r.Get("/webhooks", h.HandleGetWebhooks)
		r.Delete("/webhooks/{id}", h.HandleDeleteWebhook)
	})

	return r, func() {
		rl.Stop()
		invoiceLimiter.Stop()
	}
}

func metricsTokenMiddleware(expected string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+expected {
				writeAPIError(w, r, http.StatusUnauthorized, "unauthorized")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
