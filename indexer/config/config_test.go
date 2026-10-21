package config

import (
	"strings"
	"testing"
	"time"

	"github.com/stellar/go-stellar-sdk/keypair"
)

var configEnvNames = []string{
	"APP_ENV",
	"STELLAR_NETWORK",
	"HORIZON_URL",
	"SOROBAN_RPC_URL",
	"NETWORK_PASSPHRASE",
	"REGISTRY_CONTRACT_ID",
	"INVOICE_CONTRACT_ID",
	"POOL_CONTRACT_ID",
	"ESCROW_CONTRACT_ID",
	"USDC_ISSUER",
	"USDC_ASSET_CODE",
	"DATABASE_URL",
	"JWT_SECRET",
	"SERVER_SEED",
	"INDEXER_POLL_INTERVAL_MS",
	"INDEXER_CONFIRMATION_DEPTH",
	"JWT_EXPIRY_HOURS",
	"API_PORT",
	"PORT",
	"ALLOWED_ORIGINS",
	"CORS_ALLOWED_ORIGINS",
	"TRUSTED_PROXY_CIDRS",
	"RATE_LIMIT_RPS",
	"WEBHOOK_WORKER_CONCURRENCY",
	"WEBHOOK_SECRET_OVERLAP",
	"SENTRY_DSN",
}

func setConfigEnv(t *testing.T, values map[string]string) {
	t.Helper()
	for _, name := range configEnvNames {
		t.Setenv(name, values[name])
	}
}

func requiredConfigEnv() map[string]string {
	return map[string]string{
		"STELLAR_NETWORK":      "testnet",
		"HORIZON_URL":          "https://horizon.example",
		"SOROBAN_RPC_URL":      "https://rpc.example",
		"NETWORK_PASSPHRASE":   "Test SDF Network ; September 2015",
		"REGISTRY_CONTRACT_ID": "registry",
		"INVOICE_CONTRACT_ID":  "invoice",
		"POOL_CONTRACT_ID":     "pool",
		"ESCROW_CONTRACT_ID":   "escrow",
		"USDC_ISSUER":          "issuer",
		"USDC_ASSET_CODE":      "USDC",
		"DATABASE_URL":         "postgres://localhost/test",
	}
}

// TestLoadConfigWebhookConcurrency covers the pool size setting added for
// webhook issue #933: it must be configurable, and unusable values must not be
// able to ask for a zero (or negative) pool.
func TestLoadConfigWebhookConcurrency(t *testing.T) {
	cases := []struct {
		value string
		want  int
	}{
		{"", 8},
		{"1", 1},
		{"32", 32},
		{"0", 8},
		{"-4", 8},
		{"not-a-number", 8},
	}

	for _, tc := range cases {
		name := tc.value
		if name == "" {
			name = "unset"
		}
		t.Run(name, func(t *testing.T) {
			env := requiredConfigEnv()
			env["WEBHOOK_WORKER_CONCURRENCY"] = tc.value
			setConfigEnv(t, env)

			cfg, err := LoadConfig()
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.WebhookConcurrency != tc.want {
				t.Errorf("WebhookConcurrency = %d, want %d for WEBHOOK_WORKER_CONCURRENCY=%q", cfg.WebhookConcurrency, tc.want, tc.value)
			}
		})
	}
}

// TestLoadConfigWebhookSecretOverlap covers the rotation grace window: a
// positive duration is honored, unusable values fall back, and an excessive
// value is clamped so an old signing key cannot live forever.
func TestLoadConfigWebhookSecretOverlap(t *testing.T) {
	cases := []struct {
		value string
		want  time.Duration
	}{
		{"", 24 * time.Hour},
		{"1h", time.Hour},
		{"90m", 90 * time.Minute},
		{"0", 24 * time.Hour},
		{"-1h", 24 * time.Hour},
		{"not-a-duration", 24 * time.Hour},
		{"720h", 30 * 24 * time.Hour},
	}

	for _, tc := range cases {
		name := tc.value
		if name == "" {
			name = "unset"
		}
		t.Run(name, func(t *testing.T) {
			env := requiredConfigEnv()
			env["WEBHOOK_SECRET_OVERLAP"] = tc.value
			setConfigEnv(t, env)

			cfg, err := LoadConfig()
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.WebhookSecretOverlap != tc.want {
				t.Errorf("WebhookSecretOverlap = %v, want %v for WEBHOOK_SECRET_OVERLAP=%q",
					cfg.WebhookSecretOverlap, tc.want, tc.value)
			}
		})
	}
}

// TestLoadConfigIndexerConfirmationDepth covers the reorg buffer setting
// added for issue #882: it defaults to 3, accepts an explicit opt-out (0),
// and unusable values must not be able to stall indexing indefinitely.
func TestLoadConfigIndexerConfirmationDepth(t *testing.T) {
	cases := []struct {
		value string
		want  int
	}{
		{"", 3},
		{"0", 0},
		{"5", 5},
		{"100", maxConfirmationDepth},
		{"-2", 3},
		{"not-a-number", 3},
	}

	for _, tc := range cases {
		name := tc.value
		if name == "" {
			name = "unset"
		}
		t.Run(name, func(t *testing.T) {
			env := requiredConfigEnv()
			env["INDEXER_CONFIRMATION_DEPTH"] = tc.value
			setConfigEnv(t, env)

			cfg, err := LoadConfig()
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.IndexerConfirmationDepth != tc.want {
				t.Errorf("IndexerConfirmationDepth = %d, want %d for INDEXER_CONFIRMATION_DEPTH=%q",
					cfg.IndexerConfirmationDepth, tc.want, tc.value)
			}
		})
	}
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		check   func(t *testing.T, cfg *Config)
		wantErr string
	}{
		{
			name: "explicit values",
			env: func() map[string]string {
				env := requiredConfigEnv()
				env["APP_ENV"] = "production"
				env["JWT_SECRET"] = "configured-secret"
				env["SERVER_SEED"] = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
				env["INDEXER_POLL_INTERVAL_MS"] = "2500"
				env["JWT_EXPIRY_HOURS"] = "12"
				env["API_PORT"] = "9000"
				env["ALLOWED_ORIGINS"] = " https://app.example,https://admin.example, "
				env["TRUSTED_PROXY_CIDRS"] = "10.0.0.0/8, 127.0.0.1/32"
				env["RATE_LIMIT_RPS"] = "25"
				env["WEBHOOK_WORKER_CONCURRENCY"] = "3"
				env["SENTRY_DSN"] = " https://examplePublicKey@o0.ingest.sentry.io/0 "
				return env
			}(),
			check: func(t *testing.T, cfg *Config) {
				if cfg.JWTSecret != "configured-secret" || cfg.JWTSecretGenerated {
					t.Errorf("JWT secret = %q, generated = %v; want configured secret and false", cfg.JWTSecret, cfg.JWTSecretGenerated)
				}
				if cfg.ServerSeedGenerated || cfg.ServerSeed == "" {
					t.Errorf("server seed generated = %v, seed = %q; want configured seed and false", cfg.ServerSeedGenerated, cfg.ServerSeed)
				}
				if cfg.IndexerPollIntervalMs != 2500 || cfg.JWTExpiryHours != 12 || cfg.APIPort != "9000" || cfg.RateLimitRPS != 25 {
					t.Errorf("parsed settings = (%d, %d, %q, %d); want (2500, 12, 9000, 25)", cfg.IndexerPollIntervalMs, cfg.JWTExpiryHours, cfg.APIPort, cfg.RateLimitRPS)
				}
				if cfg.WebhookConcurrency != 3 {
					t.Errorf("WebhookConcurrency = %d; want 3 from WEBHOOK_WORKER_CONCURRENCY", cfg.WebhookConcurrency)
				}
				wantOrigins := []string{"https://app.example", "https://admin.example"}
				if strings.Join(cfg.CORSAllowedOrigins, ",") != strings.Join(wantOrigins, ",") {
					t.Errorf("origins = %v, want %v", cfg.CORSAllowedOrigins, wantOrigins)
				}
				wantTrusted := []string{"10.0.0.0/8", "127.0.0.1/32"}
				if strings.Join(cfg.TrustedProxyCIDRs, ",") != strings.Join(wantTrusted, ",") {
					t.Errorf("trusted proxies = %v, want %v", cfg.TrustedProxyCIDRs, wantTrusted)
				}
				if cfg.SentryDSN != "https://examplePublicKey@o0.ingest.sentry.io/0" {
					t.Errorf("SentryDSN = %q, want trimmed configured DSN", cfg.SentryDSN)
				}
			},
		},
		{
			name: "development defaults and generated secrets",
			env:  requiredConfigEnv(),
			check: func(t *testing.T, cfg *Config) {
				if !cfg.JWTSecretGenerated || len(cfg.JWTSecret) != 64 {
					t.Errorf("JWT fallback = (%q, %v); want 64-character generated secret", cfg.JWTSecret, cfg.JWTSecretGenerated)
				}
				if _, err := keypair.Parse(cfg.ServerSeed); err != nil || !cfg.ServerSeedGenerated {
					t.Errorf("server seed = (%q, %v); want valid generated seed", cfg.ServerSeed, cfg.ServerSeedGenerated)
				}
				if cfg.IndexerPollIntervalMs != 5000 || cfg.JWTExpiryHours != 24 || cfg.APIPort != "8080" || cfg.RateLimitRPS != 10 {
					t.Errorf("defaults = (%d, %d, %q, %d); want (5000, 24, 8080, 10)", cfg.IndexerPollIntervalMs, cfg.JWTExpiryHours, cfg.APIPort, cfg.RateLimitRPS)
				}
				if cfg.WebhookConcurrency != 8 {
					t.Errorf("WebhookConcurrency = %d; want the documented default of 8", cfg.WebhookConcurrency)
				}
				if len(cfg.CORSAllowedOrigins) != 1 || cfg.CORSAllowedOrigins[0] != "http://localhost:3000" {
					t.Errorf("default origins = %v, want localhost origin", cfg.CORSAllowedOrigins)
				}
				wantTrusted := []string{"127.0.0.1/32", "::1/128"}
				if strings.Join(cfg.TrustedProxyCIDRs, ",") != strings.Join(wantTrusted, ",") {
					t.Errorf("default trusted proxies = %v, want %v", cfg.TrustedProxyCIDRs, wantTrusted)
				}
				if cfg.SentryDSN != "" {
					t.Errorf("SentryDSN = %q, want empty when unset", cfg.SentryDSN)
				}
			},
		},
		{
			name:    "production rejects missing required values",
			env:     map[string]string{"APP_ENV": "production"},
			wantErr: "missing required environment variables",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setConfigEnv(t, tt.env)

			cfg, err := LoadConfig()
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("LoadConfig error = %v, want error containing %q", err, tt.wantErr)
				}
				if cfg != nil {
					t.Fatalf("LoadConfig config = %+v, want nil on error", cfg)
				}
				return
			}
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			tt.check(t, cfg)
		})
	}
}
