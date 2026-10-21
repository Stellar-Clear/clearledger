# ClearLedger Go indexer + REST API container image.
#
# Build context is the indexer directory, so the image can be built on its own
# without the surrounding pnpm workspace:
#
#   docker build -f indexer/Dockerfile -t clearledger-indexer indexer
#
# All runtime configuration comes from environment variables (see
# .env.docker.example for the Compose-network values): DATABASE_URL,
# INDEXER_MIGRATIONS_DIR, API_PORT, the Stellar network/contract IDs,
# JWT_SECRET, and so on. Nothing about the deployment is hardcoded here.

# ---------- build: compile a static binary ----------
FROM golang:1.26-alpine AS build
WORKDIR /src

# Dependencies are resolved in their own layer so edits that don't touch
# go.mod/go.sum reuse the cached module download.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
  -trimpath \
  -ldflags="-s -w" \
  -o /out/clearledger-indexer .

# ---------- runtime: minimal image with the binary + migrations ----------
FROM alpine:3.22 AS runtime

# ca-certificates is needed to reach Horizon, the Soroban RPC, and Sentry over
# HTTPS; tzdata keeps slog timestamps readable.
RUN apk add --no-cache ca-certificates tzdata \
  && adduser -D -u 10001 -h /app indexer

WORKDIR /app

COPY --from=build /out/clearledger-indexer /app/clearledger-indexer

# The indexer applies pending migrations on startup by reading *.sql files from
# the migrations directory, so ship them next to the binary.
COPY --chown=indexer:indexer db/migrations /app/db/migrations

# The binary's own auto-detection walks up from its executable path, which does
# not reach /app/db/migrations in this layout, so point it there explicitly.
# API_PORT matches the container port published by docker-compose.yml.
ENV INDEXER_MIGRATIONS_DIR=/app/db/migrations \
    API_PORT=8080

USER indexer
EXPOSE 8080

# Keep container liveness independent of downstream services. Use /ready for
# orchestration readiness probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- "http://127.0.0.1:${API_PORT}/live" >/dev/null 2>&1 || exit 1

CMD ["/app/clearledger-indexer"]
