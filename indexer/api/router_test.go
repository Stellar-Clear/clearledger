package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"clearledger/indexer/db"

	"github.com/golang-jwt/jwt/v5"
)

func TestRecoveryMiddleware_RecoversPanicAndReturns500(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/panics", nil)
	rr := httptest.NewRecorder()

	handler := RecoveryMiddleware()(next)

	// The middleware must recover the panic itself; if it doesn't, this
	// test's own goroutine would crash rather than reporting a failure.
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
	if !strings.Contains(rr.Body.String(), "internal server error") {
		t.Errorf("expected error body, got %q", rr.Body.String())
	}
}

func TestRecoveryMiddleware_PassesThroughWhenNoPanic(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	rr := httptest.NewRecorder()

	handler := RecoveryMiddleware()(next)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTeapot {
		t.Fatalf("expected status %d, got %d", http.StatusTeapot, rr.Code)
	}
}

func TestCORSMiddleware_AllowsConfiguredOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rr := httptest.NewRecorder()

	handler := CORSMiddleware([]string{"http://localhost:3000", "http://localhost:3000"})(next)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTeapot {
		t.Fatalf("expected status %d, got %d", http.StatusTeapot, rr.Code)
	}

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("expected allowed origin to be forwarded, got %q", got)
	}
}

func TestCORSMiddleware_RejectsUnlistedOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "https://evil.example")
	rr := httptest.NewRecorder()

	handler := CORSMiddleware([]string{"http://localhost:3000", "http://localhost:3000"})(next)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, rr.Code)
	}

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header for rejected origin, got %q", got)
	}
}

func TestHealthEndpoint_Returns200WhenListenerAndDBAreHealthy(t *testing.T) {
	h := newTestHandler(t)
	h.dbHealthChecker = func(context.Context) error { return nil }
	h.listenerHealth = NewListenerHealth()
	h.listenerHealth.MarkStarted()

	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d; body: %s", http.StatusOK, rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"status": "ok"`) {
		t.Fatalf("expected healthy payload, got %s", rr.Body.String())
	}
}

func TestReadinessReportsEachDependencyWithoutLeakingErrors(t *testing.T) {
	tests := []struct {
		name            string
		dbErr           error
		rpcErr          error
		listenerHealthy bool
		wantStatus      int
		wantPostgres    string
		wantSoroban     string
		wantListener    string
	}{
		{name: "all ready", listenerHealthy: true, wantStatus: http.StatusOK, wantPostgres: "ready", wantSoroban: "ready", wantListener: "ready"},
		{name: "postgres unavailable", dbErr: errors.New("private database details"), listenerHealthy: true, wantStatus: http.StatusServiceUnavailable, wantPostgres: "unavailable", wantSoroban: "ready", wantListener: "ready"},
		{name: "soroban unavailable", rpcErr: errors.New("provider URL and key"), listenerHealthy: true, wantStatus: http.StatusServiceUnavailable, wantPostgres: "ready", wantSoroban: "unavailable", wantListener: "ready"},
		{name: "listener stopped", listenerHealthy: false, wantStatus: http.StatusServiceUnavailable, wantPostgres: "ready", wantSoroban: "ready", wantListener: "unavailable"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(t)
			h.dbHealthChecker = func(context.Context) error { return tt.dbErr }
			h.sorobanHealthChecker = func(context.Context) error { return tt.rpcErr }
			if tt.listenerHealthy {
				h.ListenerHealth().MarkStarted()
			}
			router, stop := NewRouter(h)
			t.Cleanup(stop)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/ready", nil))
			if rr.Code != tt.wantStatus {
				t.Fatalf("status=%d want %d body=%s", rr.Code, tt.wantStatus, rr.Body.String())
			}
			var body struct {
				Status       string            `json:"status"`
				Dependencies map[string]string `json:"dependencies"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode readiness response: %v", err)
			}
			wantOverall := "ready"
			if tt.wantStatus != http.StatusOK {
				wantOverall = "degraded"
			}
			if body.Status != wantOverall || body.Dependencies["postgres"] != tt.wantPostgres || body.Dependencies["soroban_rpc"] != tt.wantSoroban || body.Dependencies["listener"] != tt.wantListener {
				t.Fatalf("readiness response = %+v", body)
			}
			if strings.Contains(rr.Body.String(), "private database details") || strings.Contains(rr.Body.String(), "provider URL and key") {
				t.Fatalf("response leaked dependency error: %s", rr.Body.String())
			}
		})
	}
}

func TestLivenessDoesNotCheckDependencies(t *testing.T) {
	h := newTestHandler(t)
	h.dbHealthChecker = func(context.Context) error { t.Fatal("liveness checked postgres"); return nil }
	h.sorobanHealthChecker = func(context.Context) error { t.Fatal("liveness checked Soroban"); return nil }
	router, stop := NewRouter(h)
	t.Cleanup(stop)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/live", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"status":"ok"`) {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestMetricsEndpoint_RequiresConfiguredToken(t *testing.T) {
	h := newTestHandler(t)
	h.cfg.MetricsToken = "metrics-secret"
	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)

	for _, authorization := range []string{"", "Bearer wrong"} {
		req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
		req.Header.Set("Authorization", authorization)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("authorization %q: got %d, want %d", authorization, rr.Code, http.StatusUnauthorized)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer metrics-secret")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("valid token: got %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestMetricsEndpoint_RemainsPublicForLocalDevelopment(t *testing.T) {
	h := newTestHandler(t)
	h.cfg.MetricsToken = ""
	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("unset token: got %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestHealthEndpoint_Returns503WhenListenerStops(t *testing.T) {
	h := newTestHandler(t)
	h.dbHealthChecker = func(context.Context) error { return nil }
	h.listenerHealth = NewListenerHealth()
	h.listenerHealth.MarkStopped()

	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d; body: %s", http.StatusServiceUnavailable, rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"status": "degraded"`) {
		t.Fatalf("expected degraded payload, got %s", rr.Body.String())
	}
}

func createTestJWT(secret, sub string) string {
	claims := jwt.MapClaims{
		"sub": sub,
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(secret))
	return tokenStr
}

func TestAuthMiddleware_StrictHeaderParsing(t *testing.T) {
	secret := "test-secret"
	validToken := createTestJWT(secret, "G1234567890")

	tests := []struct {
		name       string
		authHeader string
		wantCode   int
		wantSub    string
	}{
		{
			name:       "missing authorization header",
			authHeader: "",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "wrong scheme",
			authHeader: "Basic " + validToken,
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "no space after bearer",
			authHeader: "Bearer",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "bearer with empty token",
			authHeader: "Bearer ",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "bearer with whitespace only token",
			authHeader: "Bearer \t ",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "bearer with inner whitespace in token",
			authHeader: "Bearer " + validToken + " extra",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "lowercase bearer scheme",
			authHeader: "bearer " + validToken,
			wantCode:   http.StatusOK,
			wantSub:    "G1234567890",
		},
		{
			name:       "uppercase bearer scheme",
			authHeader: "BEARER " + validToken,
			wantCode:   http.StatusOK,
			wantSub:    "G1234567890",
		},
		{
			name:       "valid standard bearer token",
			authHeader: "Bearer " + validToken,
			wantCode:   http.StatusOK,
			wantSub:    "G1234567890",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var capturedSub string
			var handlerCalled bool

			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				handlerCalled = true
				sub, ok := GetUserAddress(r.Context())
				if ok {
					capturedSub = sub
				}
				w.WriteHeader(http.StatusOK)
			})

			mw := AuthMiddleware(secret)(next)
			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			rr := httptest.NewRecorder()

			mw.ServeHTTP(rr, req)

			if rr.Code != tt.wantCode {
				t.Fatalf("authHeader %q: got status %d, want %d", tt.authHeader, rr.Code, tt.wantCode)
			}

			if tt.wantCode == http.StatusOK {
				if !handlerCalled {
					t.Fatalf("expected next handler to be called for header %q", tt.authHeader)
				}
				if capturedSub != tt.wantSub {
					t.Fatalf("expected captured sub %q, got %q", tt.wantSub, capturedSub)
				}
			}
		})
	}
}

func TestPerClientRateLimiter_ClientIsolation(t *testing.T) {
	rl := newPerClientRateLimiter(10, 20, 1000)
	defer rl.Stop()

	// Simulate client A exhausting its rate limit
	clientA := "ip:192.168.1.100"
	for i := 0; i < 25; i++ {
		rl.allow(clientA)
	}

	// Client A should now be rate limited
	if rl.allow(clientA) {
		t.Error("client A should be rate limited after exhausting tokens")
	}

	// Client B should still be allowed (isolation)
	clientB := "ip:192.168.1.101"
	if !rl.allow(clientB) {
		t.Error("client B should not be affected by client A's rate limit")
	}
}

func TestPerClientRateLimiter_JWTvsIPKeys(t *testing.T) {
	rl := newPerClientRateLimiter(10, 20, 1000)
	defer rl.Stop()

	// Create a request with JWT context
	reqJWT := httptest.NewRequest(http.MethodPost, "/auth", nil)
	ctx := WithUserAddress(reqJWT.Context(), "G1234567890")
	reqJWT = reqJWT.WithContext(ctx)

	// Create a request without JWT (IP-based)
	reqIP := httptest.NewRequest(http.MethodPost, "/auth", nil)
	reqIP.RemoteAddr = "192.168.1.100:12345"

	keyJWT := getClientKey(reqJWT)
	keyIP := getClientKey(reqIP)

	if keyJWT != "jwt:G1234567890" {
		t.Errorf("expected JWT key 'jwt:G1234567890', got %s", keyJWT)
	}

	if !strings.HasPrefix(keyIP, "ip:") {
		t.Errorf("expected IP key to start with 'ip:', got %s", keyIP)
	}

	// Exhaust JWT client
	for i := 0; i < 25; i++ {
		rl.allow(keyJWT)
	}

	// JWT client should be rate limited
	if rl.allow(keyJWT) {
		t.Error("JWT client should be rate limited")
	}

	// IP client should still be allowed (different keys)
	if !rl.allow(keyIP) {
		t.Error("IP client should not be affected by JWT client's rate limit")
	}
}

func TestGetClientKey_IgnoresSourcePortForBuckets(t *testing.T) {
	rl := newPerClientRateLimiter(1, 1, 1000)
	defer rl.Stop()

	req1 := httptest.NewRequest(http.MethodGet, "/auth", nil)
	req1.RemoteAddr = "203.0.113.7:45000"
	req2 := httptest.NewRequest(http.MethodGet, "/auth", nil)
	req2.RemoteAddr = "203.0.113.7:45001"

	key1 := getClientKey(req1)
	key2 := getClientKey(req2)
	if key1 != key2 {
		t.Fatalf("same client IP with different ports should share a bucket: %q != %q", key1, key2)
	}
	if !rl.allow(key1) {
		t.Fatal("first request should be allowed")
	}
	if rl.allow(key2) {
		t.Fatal("second request from the same IP should hit the same bucket and be rate limited")
	}
}

func TestTrustedProxyMiddleware_IgnoresSpoofedForwardedHeaders(t *testing.T) {
	t.Run("untrusted peer ignores forwarded headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/auth", nil)
		req.RemoteAddr = "198.51.100.9:45678"
		req.Header.Set("X-Forwarded-For", "203.0.113.55")

		mw := TrustedProxyMiddleware([]string{"10.0.0.0/8"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, req)

		if got := getClientKey(req); got != "ip:198.51.100.9" {
			t.Fatalf("spoofed X-Forwarded-For from untrusted peer should be ignored; got %q", got)
		}
	})

	t.Run("trusted proxy forwards the original client IP", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/auth", nil)
		req.RemoteAddr = "10.0.0.9:45678"
		req.Header.Set("X-Forwarded-For", "203.0.113.55")

		mw := TrustedProxyMiddleware([]string{"10.0.0.0/8"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, req)

		if got := getClientKey(req); got != "ip:203.0.113.55" {
			t.Fatalf("trusted proxy should set the client IP from X-Forwarded-For; got %q", got)
		}
	})
}

func TestPerClientRateLimiter_MaxSizeEviction(t *testing.T) {
	maxSize := 10
	rl := newPerClientRateLimiter(10, 20, maxSize)
	defer rl.Stop()

	// Add more clients than maxSize
	for i := 0; i < maxSize+5; i++ {
		clientKey := fmt.Sprintf("ip:192.168.1.%d", i)
		rl.allow(clientKey)
	}

	rl.mu.RLock()
	bucketCount := len(rl.buckets)
	rl.mu.RUnlock()

	// Bucket count should not exceed maxSize significantly
	// (may be maxSize+1 due to race condition during eviction)
	if bucketCount > maxSize+1 {
		t.Errorf("bucket count %d exceeds maxSize %d", bucketCount, maxSize)
	}
}

// TestPerClientRateLimiter_ConcurrentEviction drives allow() from many
// goroutines against a small maxSize so evictOldest() runs concurrently with
// token refills. Run with -race to detect unsynchronised bucket.last access.
func TestPerClientRateLimiter_ConcurrentEviction(t *testing.T) {
	maxSize := 8
	rl := newPerClientRateLimiter(10, 20, maxSize)
	defer rl.Stop()

	const goroutines = 32
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 20; i++ {
				rl.allow(fmt.Sprintf("ip:10.0.%d.%d", g, i))
			}
		}(g)
	}
	wg.Wait()

	rl.mu.RLock()
	bucketCount := len(rl.buckets)
	rl.mu.RUnlock()

	if bucketCount > maxSize+1 {
		t.Errorf("bucket count %d exceeds maxSize %d", bucketCount, maxSize)
	}
}

func TestPerClientRateLimiter_StaleEviction(t *testing.T) {
	rl := newPerClientRateLimiter(10, 20, 1000)
	defer rl.Stop()

	// Add a client
	clientKey := "ip:192.168.1.100"
	rl.allow(clientKey)

	rl.mu.RLock()
	_, exists := rl.buckets[clientKey]
	rl.mu.RUnlock()

	if !exists {
		t.Error("client bucket should exist after allow")
	}

	// Manually set lastSeen to old time
	rl.mu.Lock()
	if bucket, ok := rl.buckets[clientKey]; ok {
		bucket.mu.Lock()
		bucket.last = time.Now().Add(-15 * time.Minute)
		bucket.mu.Unlock()
	}
	rl.mu.Unlock()

	// Trigger cleanup
	rl.evictStale()

	rl.mu.RLock()
	_, exists = rl.buckets[clientKey]
	rl.mu.RUnlock()

	if exists {
		t.Error("stale client bucket should be evicted")
	}
}

func TestPerClientRateLimiter_TokenRefill(t *testing.T) {
	rl := newPerClientRateLimiter(100, 20, 1000)
	defer rl.Stop()

	clientKey := "ip:192.168.1.100"

	// Exhaust burst
	for i := 0; i < 25; i++ {
		rl.allow(clientKey)
	}

	// Should be rate limited
	if rl.allow(clientKey) {
		t.Error("should be rate limited after exhausting burst")
	}

	// Wait for token refill
	time.Sleep(20 * time.Millisecond)

	// Should be allowed again after refill
	if !rl.allow(clientKey) {
		t.Error("should be allowed after token refill")
	}
}

func TestRouter_PublicReadRoutesAreRateLimited(t *testing.T) {
	h := newTestHandler(t)
	// newTestHandler leaves RateLimitRPS at 0, which would reject every
	// request. Give this client a real budget (RPS=1 -> burst=2) and stub
	// the pool-stats reader so the handler answers without a live database.
	h.cfg.RateLimitRPS = 1
	h.getPoolStatsFn = func(context.Context) (*db.DbPoolStats, error) {
		return &db.DbPoolStats{}, nil
	}
	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)

	const maxRequests = 6
	allowed, limited := 0, 0
	for i := 0; i < maxRequests; i++ {
		req := httptest.NewRequest(http.MethodGet, "/pool/stats", nil)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)

		switch rr.Code {
		case http.StatusOK:
			allowed++
		case http.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("request %d: unexpected status %d; body=%s", i+1, rr.Code, rr.Body.String())
		}
	}

	if allowed == 0 {
		t.Fatal("expected the first requests to be served before the limiter engages")
	}
	if limited == 0 {
		t.Fatalf("expected status %d once the client exceeded the configured RPS", http.StatusTooManyRequests)
	}
}

func TestRateLimitMiddleware_UsesGenericTooManyRequestsBody(t *testing.T) {
	rl := newPerClientRateLimiter(1, 1, 1000)
	defer rl.Stop()
	mw := RateLimitMiddleware(rl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/auth", nil)
	req.RemoteAddr = "203.0.113.8:52000"
	first := httptest.NewRecorder()
	mw.ServeHTTP(first, req)
	if first.Code != http.StatusOK {
		t.Fatalf("first request status=%d, want %d; body=%s", first.Code, http.StatusOK, first.Body.String())
	}

	second := httptest.NewRecorder()
	mw.ServeHTTP(second, req)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request status=%d, want %d; body=%s", second.Code, http.StatusTooManyRequests, second.Body.String())
	}
	var response apiErrorBody
	if err := json.Unmarshal(second.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode rate-limit error: %v", err)
	}
	if response.Error.Code != "rate_limited" || response.Error.Message != "too many requests" {
		t.Fatalf("error=%+v, want rate_limited envelope", response.Error)
	}
}

func TestRouter_InvoiceCreationRateLimitBlocksSixthRequest(t *testing.T) {
	h := newTestHandler(t)
	h.cfg.RateLimitRPS = 100
	h.cfg.InvoiceRateLimit = 5
	h.cfg.InvoiceRateLimitWindow = time.Hour
	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)

	token := createTestJWT(h.cfg.JWTSecret, "GCLIENT919")
	for i := 1; i <= 6; i++ {
		req := httptest.NewRequest(http.MethodPost, "/invoices", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)

		if i < 6 && rr.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d was rate limited before the configured limit", i)
		}
		if i == 6 {
			if rr.Code != http.StatusTooManyRequests {
				t.Fatalf("sixth request status=%d, want %d; body=%s", rr.Code, http.StatusTooManyRequests, rr.Body.String())
			}
			if rr.Header().Get("Retry-After") == "" {
				t.Fatal("sixth request did not include Retry-After")
			}
		}
	}
}
