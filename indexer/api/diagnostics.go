package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"clearledger/indexer/config"
)

// Stable classifications returned by the diagnostics endpoint. Clients can
// switch on these values without depending on raw upstream error text, which
// is deliberately never exposed (it can contain API keys embedded in URLs).
const (
	DiagnosticErrorNotConfigured = "not_configured"
	DiagnosticErrorTimeout       = "timeout"
	DiagnosticErrorNetwork       = "network_error"
	DiagnosticErrorInvalidConfig = "invalid_configuration"
	DiagnosticErrorUnauthorized  = "unauthorized"
	DiagnosticErrorForbidden     = "forbidden"
	DiagnosticErrorNotFound      = "not_found"
	DiagnosticErrorRateLimited   = "rate_limited"
	DiagnosticErrorUpstream      = "upstream_error"
	DiagnosticErrorHTTP          = "http_error"
	DiagnosticErrorInvalidBody   = "invalid_response"
	DiagnosticErrorRPC           = "rpc_error"
	DiagnosticErrorUnhealthy     = "unhealthy"
)

const (
	defaultDiagnosticsTimeout = 3 * time.Second
	maxDiagnosticsBodyBytes   = 64 * 1024
)

// DiagnosticFeature is the client-safe status of one configured API-backed
// feature. It intentionally contains no endpoint URLs, credentials, or raw
// upstream error messages.
type DiagnosticFeature struct {
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
	Healthy    bool   `json:"healthy"`
	StatusCode int    `json:"status_code,omitempty"`
	LatencyMS  int64  `json:"latency_ms"`
	ErrorClass string `json:"error_class,omitempty"`
}

// DiagnosticsResponse is the payload of GET /diagnostics.
type DiagnosticsResponse struct {
	Status    string              `json:"status"`
	CheckedAt string              `json:"checked_at"`
	Features  []DiagnosticFeature `json:"features"`
}

// HandleGetDiagnostics reports the configured/reachable state of each
// API-backed feature. It is mounted behind AuthMiddleware so operational
// metadata is not public; the payload never includes URLs or secret values.
func (h *APIHandler) HandleGetDiagnostics(w http.ResponseWriter, r *http.Request) {
	// Operational snapshots should not be cached by browsers or proxies.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, CheckAPIConnections(r.Context(), h.cfg))
}

// CheckAPIConnections probes every configured API-backed feature and returns
// only safe, normalized metadata. It always returns a response so the UI can
// render partial/unavailable state; callers should not treat the return value
// as an error signal.
func CheckAPIConnections(ctx context.Context, cfg *config.Config) DiagnosticsResponse {
	return checkAPIConnections(ctx, cfg, defaultDiagnosticsTimeout, &http.Client{})
}

func checkAPIConnections(ctx context.Context, cfg *config.Config, timeout time.Duration, client *http.Client) DiagnosticsResponse {
	// Probe concurrently: each feature has its own timeout, so a single slow
	// dependency must not delay the whole diagnostics response.
	features := make([]DiagnosticFeature, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		features[0] = checkHorizon(ctx, cfg.HorizonURL, timeout, client)
	}()
	go func() {
		defer wg.Done()
		features[1] = checkSorobanRPC(ctx, cfg.SorobanRPCURL, timeout, client)
	}()
	wg.Wait()

	status := "ok"
	for _, feature := range features {
		if !feature.Configured || !feature.Healthy {
			status = "degraded"
			break
		}
	}

	return DiagnosticsResponse{
		Status:    status,
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Features:  features,
	}
}

func checkHorizon(ctx context.Context, endpoint string, timeout time.Duration, client *http.Client) DiagnosticFeature {
	return checkHTTPFeature(ctx, "horizon", endpoint, timeout, client,
		func(ctx context.Context, url string) (*http.Request, error) {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(url, "/"), nil)
			if err != nil {
				return nil, err
			}
			req.Header.Set("Accept", "application/json")
			return req, nil
		},
		func(status int, _ []byte) (bool, string) {
			if status >= http.StatusOK && status < http.StatusMultipleChoices {
				return true, ""
			}
			return false, classifyHTTPStatus(status)
		})
}

func checkSorobanRPC(ctx context.Context, endpoint string, timeout time.Duration, client *http.Client) DiagnosticFeature {
	return checkHTTPFeature(ctx, "soroban_rpc", endpoint, timeout, client,
		func(ctx context.Context, url string) (*http.Request, error) {
			body := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}`)
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
			if err != nil {
				return nil, err
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json")
			return req, nil
		},
		func(status int, body []byte) (bool, string) {
			if status < http.StatusOK || status >= http.StatusMultipleChoices {
				return false, classifyHTTPStatus(status)
			}

			var payload struct {
				Error *struct {
					Code    int    `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
				Result struct {
					Status string `json:"status"`
				} `json:"result"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				return false, DiagnosticErrorInvalidBody
			}
			if payload.Error != nil {
				return false, DiagnosticErrorRPC
			}
			switch strings.ToLower(strings.TrimSpace(payload.Result.Status)) {
			case "healthy":
				return true, ""
			case "":
				return false, DiagnosticErrorInvalidBody
			default:
				return false, DiagnosticErrorUnhealthy
			}
		})
}

func checkHTTPFeature(
	ctx context.Context,
	name string,
	endpoint string,
	timeout time.Duration,
	client *http.Client,
	buildRequest func(context.Context, string) (*http.Request, error),
	evaluate func(int, []byte) (bool, string),
) DiagnosticFeature {
	feature := DiagnosticFeature{Name: name}
	if strings.TrimSpace(endpoint) == "" {
		feature.ErrorClass = DiagnosticErrorNotConfigured
		return feature
	}
	feature.Configured = true

	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := buildRequest(checkCtx, endpoint)
	if err != nil {
		feature.ErrorClass = DiagnosticErrorInvalidConfig
		return feature
	}

	start := time.Now()
	resp, err := client.Do(req)
	feature.LatencyMS = time.Since(start).Milliseconds()
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(checkCtx.Err(), context.DeadlineExceeded) {
			feature.ErrorClass = DiagnosticErrorTimeout
		} else {
			feature.ErrorClass = DiagnosticErrorNetwork
		}
		return feature
	}
	defer resp.Body.Close()

	feature.StatusCode = resp.StatusCode
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiagnosticsBodyBytes))
	if err != nil {
		feature.ErrorClass = DiagnosticErrorNetwork
		return feature
	}

	healthy, errorClass := evaluate(resp.StatusCode, body)
	feature.Healthy = healthy
	if !healthy {
		feature.ErrorClass = errorClass
	}
	return feature
}

func classifyHTTPStatus(status int) string {
	switch {
	case status >= http.StatusOK && status < http.StatusMultipleChoices:
		return ""
	case status == http.StatusUnauthorized:
		return DiagnosticErrorUnauthorized
	case status == http.StatusForbidden:
		return DiagnosticErrorForbidden
	case status == http.StatusNotFound:
		return DiagnosticErrorNotFound
	case status == http.StatusTooManyRequests:
		return DiagnosticErrorRateLimited
	case status >= http.StatusInternalServerError:
		return DiagnosticErrorUpstream
	default:
		return DiagnosticErrorHTTP
	}
}
