package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/stellar/go-stellar-sdk/keypair"
)

// maxConfirmationDepth caps INDEXER_CONFIRMATION_DEPTH so a mistyped value
// cannot stall event indexing indefinitely. 20 ledgers is ~100s.
const maxConfirmationDepth = 20

// Webhook signature rotation defaults. The overlap is how long the previous
// signing secret remains valid after a rotation; 24h gives subscribers a full
// deploy cycle. The cap prevents a typo (for example a duration in
// milliseconds interpreted as seconds) from keeping an old key alive forever.
const (
	defaultWebhookSecretOverlap = 24 * time.Hour
	maxWebhookSecretOverlap     = 30 * 24 * time.Hour
)

type Config struct {
	StellarNetwork           string
	HorizonURL               string
	SorobanRPCURL            string
	NetworkPassphrase        string
	RegistryContractID       string
	InvoiceContractID        string
	PoolContractID           string
	EscrowContractID         string
	USDCIssuer               string
	USDCAssetCode            string
	DatabaseURL              string
	APIPort                  string
	IndexerPollIntervalMs    int
	IndexerConfirmationDepth int
	JWTSecret                string
	JWTSecretGenerated       bool
	JWTExpiryHours           int
	CORSAllowedOrigins       []string
	TrustedProxyCIDRs        []string
	RateLimitRPS             int
	InvoiceRateLimit         int
	InvoiceRateLimitWindow   time.Duration
	WebhookConcurrency       int
	WebhookSecretOverlap     time.Duration
	ServerSeed               string
	ServerSeedGenerated      bool
	SentryDSN                string
	MetricsToken             string
}

func LoadConfig() (*Config, error) {
	// Try loading from parent directories or current directory
	envPaths := []string{"../.env.local", "../.env", ".env.local", ".env"}
	for _, path := range envPaths {
		err := godotenv.Load(path)
		if err == nil {
			slog.Info("loaded env file", "path", path)
		} else if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("failed to load env file", "path", path, "error", err)
		}
	}

	missing := make([]string, 0)
	getRequired := func(name string) string {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			missing = append(missing, name)
		}
		return value
	}

	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if appEnv == "" {
		appEnv = "development"
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	jwtSecretGenerated := false
	if jwtSecret == "" {
		if appEnv == "production" {
			missing = append(missing, "JWT_SECRET")
		} else {
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				return nil, fmt.Errorf("failed to generate fallback JWT secret: %w", err)
			}
			jwtSecret = hex.EncodeToString(b)
			jwtSecretGenerated = true
		}
	}

	serverSeed := strings.TrimSpace(os.Getenv("SERVER_SEED"))
	serverSeedGenerated := false
	if serverSeed == "" {
		if appEnv == "production" {
			missing = append(missing, "SERVER_SEED")
		} else {
			kp, err := keypair.Random()
			if err != nil {
				return nil, fmt.Errorf("failed to generate fallback server seed: %w", err)
			}
			serverSeed = kp.Seed()
			serverSeedGenerated = true
		}
	}

	pollIntervalMsStr := os.Getenv("INDEXER_POLL_INTERVAL_MS")
	pollIntervalMs := 5000
	if pollIntervalMsStr != "" {
		if val, err := strconv.Atoi(pollIntervalMsStr); err == nil {
			pollIntervalMs = val
		}
	}

	// Reorg buffer for the event listener (issue #882). Clamped so a typo
	// cannot stall indexing indefinitely; 0 explicitly opts out of the buffer.
	confirmationDepth := 3
	if depthStr := strings.TrimSpace(os.Getenv("INDEXER_CONFIRMATION_DEPTH")); depthStr != "" {
		switch val, err := strconv.Atoi(depthStr); {
		case err != nil:
			slog.Warn("INDEXER_CONFIRMATION_DEPTH is not a number; using default", "default", confirmationDepth)
		case val < 0:
			slog.Warn("INDEXER_CONFIRMATION_DEPTH is negative; using default", "default", confirmationDepth)
		case val > maxConfirmationDepth:
			slog.Warn("INDEXER_CONFIRMATION_DEPTH exceeds the maximum; clamping",
				"requested", val, "max", maxConfirmationDepth)
			confirmationDepth = maxConfirmationDepth
		default:
			confirmationDepth = val
		}
	}

	jwtExpiryHoursStr := os.Getenv("JWT_EXPIRY_HOURS")
	jwtExpiryHours := 24
	if jwtExpiryHoursStr != "" {
		if val, err := strconv.Atoi(jwtExpiryHoursStr); err == nil {
			jwtExpiryHours = val
		}
	}

	apiPort := strings.TrimSpace(os.Getenv("API_PORT"))
	if apiPort == "" {
		apiPort = strings.TrimSpace(os.Getenv("PORT")) // Render provides PORT automatically
	}
	if apiPort == "" {
		apiPort = "8080"
	}

	originsStr := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if originsStr == "" {
		originsStr = strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	}
	var corsOrigins []string
	if originsStr != "" {
		for _, origin := range strings.Split(originsStr, ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" {
				corsOrigins = append(corsOrigins, origin)
			}
		}
	}
	if len(corsOrigins) == 0 {
		corsOrigins = []string{"http://localhost:3000"}
	}

	trustedProxyCIDRs := strings.TrimSpace(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if trustedProxyCIDRs == "" {
		trustedProxyCIDRs = "127.0.0.1/32,::1/128"
	}
	var trustedProxyList []string
	for _, cidr := range strings.Split(trustedProxyCIDRs, ",") {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		trustedProxyList = append(trustedProxyList, cidr)
	}

	rateLimitRPS := 10
	if rateLimitStr := os.Getenv("RATE_LIMIT_RPS"); rateLimitStr != "" {
		if val, err := strconv.Atoi(rateLimitStr); err == nil && val > 0 {
			rateLimitRPS = val
		}
	}

	invoiceRateLimit := 5
	if limitStr := os.Getenv("INVOICE_RATE_LIMIT"); limitStr != "" {
		if val, err := strconv.Atoi(limitStr); err == nil && val > 0 {
			invoiceRateLimit = val
		}
	}

	invoiceRateLimitWindow := time.Hour
	if windowStr := strings.TrimSpace(os.Getenv("INVOICE_RATE_LIMIT_WINDOW")); windowStr != "" {
		if val, err := time.ParseDuration(windowStr); err == nil && val > 0 {
			invoiceRateLimitWindow = val
		}
	}

	// Number of webhook deliveries attempted in parallel per batch. Keeping the
	// default small avoids overwhelming subscriber endpoints that rate limit
	// their inbound traffic.
	webhookConcurrency := 8
	if concurrencyStr := os.Getenv("WEBHOOK_WORKER_CONCURRENCY"); concurrencyStr != "" {
		if val, err := strconv.Atoi(concurrencyStr); err == nil && val > 0 {
			webhookConcurrency = val
		}
	}

	// How long the previous signing secret stays valid after a rotation. Values
	// that are not positive durations fall back to the default; values above
	// the cap are clamped so a compromised key cannot be kept valid
	// indefinitely by a configuration typo.
	webhookSecretOverlap := defaultWebhookSecretOverlap
	if overlapStr := strings.TrimSpace(os.Getenv("WEBHOOK_SECRET_OVERLAP")); overlapStr != "" {
		switch val, err := time.ParseDuration(overlapStr); {
		case err != nil:
			slog.Warn("WEBHOOK_SECRET_OVERLAP is not a duration; using default", "default", defaultWebhookSecretOverlap)
		case val <= 0:
			slog.Warn("WEBHOOK_SECRET_OVERLAP must be positive; using default", "default", defaultWebhookSecretOverlap)
		case val > maxWebhookSecretOverlap:
			slog.Warn("WEBHOOK_SECRET_OVERLAP exceeds the maximum; clamping",
				"requested", val, "max", maxWebhookSecretOverlap)
			webhookSecretOverlap = maxWebhookSecretOverlap
		default:
			webhookSecretOverlap = val
		}
	}

	cfg := &Config{
		StellarNetwork:           getRequired("STELLAR_NETWORK"),
		HorizonURL:               getRequired("HORIZON_URL"),
		SorobanRPCURL:            getRequired("SOROBAN_RPC_URL"),
		NetworkPassphrase:        getRequired("NETWORK_PASSPHRASE"),
		RegistryContractID:       getRequired("REGISTRY_CONTRACT_ID"),
		InvoiceContractID:        getRequired("INVOICE_CONTRACT_ID"),
		PoolContractID:           getRequired("POOL_CONTRACT_ID"),
		EscrowContractID:         getRequired("ESCROW_CONTRACT_ID"),
		USDCIssuer:               getRequired("USDC_ISSUER"),
		USDCAssetCode:            getRequired("USDC_ASSET_CODE"),
		DatabaseURL:              getRequired("DATABASE_URL"),
		APIPort:                  apiPort,
		IndexerPollIntervalMs:    pollIntervalMs,
		IndexerConfirmationDepth: confirmationDepth,
		JWTSecret:                jwtSecret,
		JWTSecretGenerated:       jwtSecretGenerated,
		JWTExpiryHours:           jwtExpiryHours,
		CORSAllowedOrigins:       corsOrigins,
		TrustedProxyCIDRs:        trustedProxyList,
		RateLimitRPS:             rateLimitRPS,
		InvoiceRateLimit:         invoiceRateLimit,
		InvoiceRateLimitWindow:   invoiceRateLimitWindow,
		WebhookConcurrency:       webhookConcurrency,
		WebhookSecretOverlap:     webhookSecretOverlap,
		ServerSeed:               serverSeed,
		ServerSeedGenerated:      serverSeedGenerated,
		SentryDSN:                strings.TrimSpace(os.Getenv("SENTRY_DSN")),
		MetricsToken:             strings.TrimSpace(os.Getenv("METRICS_TOKEN")),
	}

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s; see .env.example", strings.Join(missing, ", "))
	}

	return cfg, nil
}
