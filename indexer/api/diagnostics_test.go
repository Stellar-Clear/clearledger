package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"clearledger/indexer/config"
)

func featureByName(t *testing.T, resp DiagnosticsResponse, name string) DiagnosticFeature {
	t.Helper()
	for _, feature := range resp.Features {
		if feature.Name == name {
			return feature
		}
	}
	t.Fatalf("feature %q not found in %+v", name, resp.Features)
	return DiagnosticFeature{}
}

func TestCheckAPIConnections_Healthy(t *testing.T) {
	horizon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("horizon method: got %s, want GET", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"horizon_version":"test"}`))
	}))
	defer horizon.Close()

	soroban := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("soroban method: got %s, want POST", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"status":"healthy","latestLedger":42}}`))
	}))
	defer soroban.Close()

	cfg := &config.Config{HorizonURL: horizon.URL, SorobanRPCURL: soroban.URL}
	resp := checkAPIConnections(context.Background(), cfg, time.Second, horizon.Client())

	if resp.Status != "ok" {
		t.Fatalf("status: got %q, want ok", resp.Status)
	}
	if resp.CheckedAt == "" {
		t.Error("checked_at must be set")
	}

	for _, name := range []string{"horizon", "soroban_rpc"} {
		feature := featureByName(t, resp, name)
		if !feature.Configured {
			t.Errorf("%s: expected configured", name)
		}
		if !feature.Healthy {
			t.Errorf("%s: expected healthy, got error class %q", name, feature.ErrorClass)
		}
		if feature.StatusCode != http.StatusOK {
			t.Errorf("%s: status code = %d, want 200", name, feature.StatusCode)
		}
		if feature.ErrorClass != "" {
			t.Errorf("%s: unexpected error class %q", name, feature.ErrorClass)
		}
		if feature.LatencyMS < 0 {
			t.Errorf("%s: latency must not be negative", name)
		}
	}
}

func TestCheckAPIConnections_Unconfigured(t *testing.T) {
	resp := checkAPIConnections(context.Background(), &config.Config{}, time.Second, http.DefaultClient)

	if resp.Status != "degraded" {
		t.Fatalf("status: got %q, want degraded", resp.Status)
	}
	if len(resp.Features) != 2 {
		t.Fatalf("features: got %d, want 2", len(resp.Features))
	}
	for _, feature := range resp.Features {
		if feature.Configured {
			t.Errorf("%s: expected unconfigured", feature.Name)
		}
		if feature.Healthy {
			t.Errorf("%s: expected unhealthy", feature.Name)
		}
		if feature.ErrorClass != DiagnosticErrorNotConfigured {
			t.Errorf("%s: error class = %q, want %q", feature.Name, feature.ErrorClass, DiagnosticErrorNotConfigured)
		}
		if feature.StatusCode != 0 {
			t.Errorf("%s: status code = %d, want 0", feature.Name, feature.StatusCode)
		}
	}
}

func TestCheckAPIConnections_Timeout(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer slow.Close()

	cfg := &config.Config{HorizonURL: slow.URL}
	resp := checkAPIConnections(context.Background(), cfg, 20*time.Millisecond, slow.Client())

	horizon := featureByName(t, resp, "horizon")
	if !horizon.Configured {
		t.Error("expected configured")
	}
	if horizon.Healthy {
		t.Error("expected timeout to be unhealthy")
	}
	if horizon.ErrorClass != DiagnosticErrorTimeout {
		t.Errorf("error class: got %q, want %q", horizon.ErrorClass, DiagnosticErrorTimeout)
	}
	if horizon.StatusCode != 0 {
		t.Errorf("status code: got %d, want 0", horizon.StatusCode)
	}
	if resp.Status != "degraded" {
		t.Errorf("status: got %q, want degraded", resp.Status)
	}
}

func TestCheckAPIConnections_Unreachable(t *testing.T) {
	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := closed.URL
	closed.Close()

	cfg := &config.Config{HorizonURL: closedURL}
	resp := checkAPIConnections(context.Background(), cfg, time.Second, &http.Client{})

	horizon := featureByName(t, resp, "horizon")
	if !horizon.Configured {
		t.Error("expected configured")
	}
	if horizon.Healthy {
		t.Error("expected unreachable endpoint to be unhealthy")
	}
	if horizon.ErrorClass != DiagnosticErrorNetwork {
		t.Errorf("error class: got %q, want %q", horizon.ErrorClass, DiagnosticErrorNetwork)
	}
	if horizon.StatusCode != 0 {
		t.Errorf("status code: got %d, want 0", horizon.StatusCode)
	}
}

func TestCheckAPIConnections_InvalidRPCResponse(t *testing.T) {
	soroban := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1}`))
	}))
	defer soroban.Close()

	cfg := &config.Config{SorobanRPCURL: soroban.URL}
	resp := checkAPIConnections(context.Background(), cfg, time.Second, soroban.Client())

	feature := featureByName(t, resp, "soroban_rpc")
	if feature.Healthy {
		t.Error("expected missing RPC result to be unhealthy")
	}
	if feature.ErrorClass != DiagnosticErrorInvalidBody {
		t.Errorf("error class: got %q, want %q", feature.ErrorClass, DiagnosticErrorInvalidBody)
	}
}

func TestCheckAPIConnections_Non2xx(t *testing.T) {
	horizon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream down", http.StatusServiceUnavailable)
	}))
	defer horizon.Close()

	soroban := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	}))
	defer soroban.Close()

	cfg := &config.Config{HorizonURL: horizon.URL, SorobanRPCURL: soroban.URL}
	resp := checkAPIConnections(context.Background(), cfg, time.Second, horizon.Client())

	horizonFeature := featureByName(t, resp, "horizon")
	if horizonFeature.Healthy || horizonFeature.ErrorClass != DiagnosticErrorUpstream {
		t.Errorf("horizon: healthy=%v error=%q, want false/%q",
			horizonFeature.Healthy, horizonFeature.ErrorClass, DiagnosticErrorUpstream)
	}
	if horizonFeature.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("horizon status code = %d, want 503", horizonFeature.StatusCode)
	}

	sorobanFeature := featureByName(t, resp, "soroban_rpc")
	if sorobanFeature.Healthy || sorobanFeature.ErrorClass != DiagnosticErrorRateLimited {
		t.Errorf("soroban: healthy=%v error=%q, want false/%q",
			sorobanFeature.Healthy, sorobanFeature.ErrorClass, DiagnosticErrorRateLimited)
	}
	if sorobanFeature.StatusCode != http.StatusTooManyRequests {
		t.Errorf("soroban status code = %d, want 429", sorobanFeature.StatusCode)
	}
}

func TestCheckAPIConnections_DoesNotLeakEndpointsOrSecrets(t *testing.T) {
	horizon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer horizon.Close()

	soroban := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}`))
	}))
	defer soroban.Close()

	const (
		horizonToken = "horizon-super-secret-token"
		sorobanPass  = "soroban-super-secret-password"
	)
	cfg := &config.Config{
		HorizonURL:    horizon.URL + "/?api_key=" + horizonToken,
		SorobanRPCURL: strings.Replace(soroban.URL, "http://", "http://rpcuser:"+sorobanPass+"@", 1),
		JWTSecret:     "jwt-secret-must-not-leak",
		ServerSeed:    "server-seed-must-not-leak",
	}

	resp := checkAPIConnections(context.Background(), cfg, time.Second, horizon.Client())
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal diagnostics response: %v", err)
	}
	text := string(body)

	for _, secret := range []string{
		horizonToken,
		sorobanPass,
		"rpcuser",
		"api_key",
		cfg.JWTSecret,
		cfg.ServerSeed,
		horizon.URL,
		soroban.URL,
	} {
		if strings.Contains(text, secret) {
			t.Errorf("diagnostics response leaked %q: %s", secret, text)
		}
	}
}

func TestDiagnosticsEndpoint_RequiresAuthAndDoesNotLeakSecrets(t *testing.T) {
	h := newTestHandler(t)
	h.cfg.HorizonURL = ""
	h.cfg.SorobanRPCURL = ""
	// newTestHandler leaves RateLimitRPS at 0, which would reject every
	// request with 429 before it reaches the diagnostics handler.
	h.cfg.RateLimitRPS = 100

	router, stopRouter := NewRouter(h)
	t.Cleanup(stopRouter)

	unauthorized := httptest.NewRecorder()
	router.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/diagnostics", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated request: got %d, want 401", unauthorized.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/diagnostics", nil)
	req.Header.Set("Authorization", "Bearer "+createTestJWT(h.cfg.JWTSecret, "GDIAGNOSTICS"))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("authenticated request: got %d, want 200; body: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), h.cfg.JWTSecret) {
		t.Errorf("diagnostics response leaked the JWT secret: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), h.cfg.ServerSeed) {
		t.Errorf("diagnostics response leaked the server seed: %s", rr.Body.String())
	}
}
