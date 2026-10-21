# Production Readiness Gates

This document separates the **current Stellar Testnet evaluation setup** from the
work that must be completed before any Mainnet deployment. It is a gap register
and a set of exit criteria, not a launch plan, a financing offer, or evidence
that Mainnet is safe.

Nothing in this document should be read as a claim of Mainnet readiness, a
commitment to fund invoices, or a guarantee of repayment, yield, or returns.
The current deployment is Testnet-only and the contracts are unaudited. See
[SECURITY.md](../SECURITY.md) and the companion
[LIMITATIONS](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/LIMITATIONS.md)
and [THREAT_MODEL](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/THREAT_MODEL.md)
documents for the underlying risks.

## How to read this document

- **Met** means the requirement is implemented and verified for the stated scope.
- **Partial** means useful controls exist, but a required production property is
  missing or unverified.
- **Not met** means the requirement is absent or cannot be demonstrated.

A gate is only satisfied when every exit criterion for it has evidence that a
reviewer can reproduce. Testnet operation, a Mainnet configuration guide, or a
passing CI run does not satisfy any gate on its own.

## Current Testnet baseline

The repository currently provides the following capabilities. They are useful
for evaluation and integration, and they are **not** a production baseline.

| Area          | What exists today                                                                                                                                                                       | Where                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Network       | Stellar Testnet with SDF Horizon and Soroban RPC endpoints, Testnet USDC                                                                                                                | `.env.example`, `.env.docker.example`                                              |
| Contracts     | Registry, invoice, escrow, and pool contracts deployed on Testnet, with an external Underwrite agent registry wired through configuration when available                                | [companion contracts repo](https://github.com/Stellar-Clear/clearledger-contracts) |
| Web app       | Next.js UI, Freighter wallet connection, Testnet-only network guard                                                                                                                     | `apps/web/`                                                                        |
| Indexer/API   | Go event listener and HTTP API backed by PostgreSQL, with SEP-10-style auth, JWT, rate limits, CORS, security headers, health checks, Prometheus metrics, optional Sentry, and webhooks | `indexer/`                                                                         |
| CI            | Typecheck, build, unit tests, lint/format, dependency audit, Go race tests, `govulncheck`, and coverage thresholds                                                                      | `.github/workflows/ci.yml`                                                         |
| Packaging     | Dockerfiles and a local Docker Compose stack                                                                                                                                            | `indexer/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`                  |
| Documentation | Setup, environment, protocol, API, webhook, and security-header guides                                                                                                                  | `docs/`                                                                            |

The hosted app is a Testnet web deployment and the Go API/indexer must be run
separately (`README.md:52`). The contracts have not been formally audited
(`README.md:62`, `SECURITY.md:5-6`, `SECURITY.md:70-75`).

## Gate summary

| #   | Gate                                     | Status                  | Short reason                                                                                                  |
| --- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Security audit                           | **Not met**             | No independent audit, formal verification, or audit remediation record                                        |
| 2   | Deployment and upgrade                   | **Partial**             | Testnet packaging and CI exist; no production promotion, upgrade, or rollback process                         |
| 3   | RPC and provider dependency              | **Partial**             | Retries and a reorg guard exist; no provider failover, SLO, or capacity evidence                              |
| 4   | API                                      | **Partial**             | Auth, limits, and an OpenAPI contract exist; production abuse, replay, and versioning controls are incomplete |
| 5   | Monitoring and alerting                  | **Partial**             | Metrics, logs, health, and optional Sentry exist; no dashboards, alert rules, SLOs, or on-call runbooks       |
| 6   | Wallet and key management                | **Not met for Mainnet** | Testnet is hard-coded in the wallet path and server/admin keys are environment-held hot keys                  |
| 7   | Backup and recovery                      | **Not met**             | No backup/PITR/restore process and the backfill command is a stub                                             |
| 8   | Compliance and operational prerequisites | **Not met**             | No KYC/AML, licensing, legal terms, or incident-response program                                              |

## 1. Security audit

**Status: Not met.**

### Current state

- The project states that the contracts have not been formally audited
  (`README.md:62`; `SECURITY.md:5-6`; `SECURITY.md:70-75`). The companion
  repository repeats this in its
  [SECURITY.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/SECURITY.md)
  and [LIMITATIONS.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/LIMITATIONS.md#no-formal-audit).
- CI performs dependency and quality checks, not a security audit:
  `pnpm audit --audit-level=high` (`.github/workflows/ci.yml:40`),
  `govulncheck` (`.github/workflows/ci.yml:144-148`), race-enabled Go tests
  (`.github/workflows/ci.yml:112-116`), and coverage thresholds
  (`.github/workflows/ci.yml:128-139`). These are useful continuous controls,
  but they do not model contract economics, key compromise, or off-chain attack
  paths.
- The companion threat model already identifies high-impact centralization
  risks, including a single admin key, admin-gated `fund_invoice`, and no
  emergency pause
  ([THREAT_MODEL.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/THREAT_MODEL.md#centralization-risks)).
- There is no audit report, finding tracker, remediation evidence, formal
  verification result, or bug-bounty program in this repository.

### Exit criteria before Mainnet

- An independent security firm audits all four contracts and the Underwrite
  agent registry, including economic and cross-contract invariants.
- Every critical/high finding is fixed and retested; medium findings are fixed
  or formally accepted with a named owner and expiry date.
- A separate review covers the web app, SDK, indexer/API, SEP-10-style
  authentication, transaction relay, webhooks, database access, and CI supply
  chain.
- Fuzz/invariant tests are run against the contracts and their outputs are part
  of the release evidence.
- The full audit report, remediation status, and scope are published, and a
  vulnerability disclosure/bounty process is operating.

## 2. Deployment and upgrade

**Status: Partial.**

### Current state

- CI builds and tests the TypeScript and Go workspaces
  (`.github/workflows/ci.yml`), and Dockerfiles produce runnable images
  (`indexer/Dockerfile`, `apps/web/Dockerfile`). Compose is explicitly a local
  stack (`docker-compose.yml`), not a production topology.
- The Mainnet guide is a **configuration mapping** only. It lists network
  values and a checklist (`docs/developer-guide/mainnet-setup.md:1-3`,
  [Deployment Checklist](developer-guide/mainnet-setup.md#deployment-checklist)),
  but the companion
  deployment guide states that Mainnet deployment is not yet supported and that
  rollback is a fresh redeploy with no automated rollback
  ([DEPLOYMENT.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/DEPLOYMENT.md#mainnet-deployment)).
- Indexer migrations are forward-only, run automatically on startup, and are
  serialized with a PostgreSQL advisory lock (`indexer/db/db.go:86`,
  `indexer/db/db.go:95-188`). There are no down migrations
  (`docs/developer-guide/local-setup.md:181-195`). A bad release therefore has
  no application-level rollback path for schema changes.
- The repository has no infrastructure-as-code, staging-to-production
  promotion, signed release artifacts, SBOM, deployment approval, or
  post-deployment verification automation.
- Testnet contract addresses are explicitly volatile and are rotated by
  redeploying
  ([DEPLOYMENT.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/DEPLOYMENT.md#contract-address-lifecycle--rotation-policy)).

### Exit criteria before Mainnet

- Reproducible, immutable builds with pinned toolchains, digests, provenance,
  and an SBOM; deploys reference those digests, not mutable branches.
- Separate staging and production environments with identical configuration
  management, plus a documented promotion and approval process.
- Infrastructure-as-code (or an equivalent reviewed runbook) for the web app,
  indexer, database, secrets, DNS, TLS, and monitoring.
- A tested migration strategy that is backward-compatible during rollout
  (expand/contract), with a restore point before every migration and a
  roll-forward or restore rehearsal.
- A tested contract deployment, wiring, verification, upgrade, and retirement
  procedure, including how LP positions and contract addresses are migrated and
  communicated. Redeploying from scratch is not a production rollback plan.
- Documented release ownership, separation of duties, and a go/no-go checklist
  with post-deployment verification and incident triggers.

## 3. RPC and provider dependency

**Status: Partial.**

### Current state

- Testnet uses the public SDF Horizon and Soroban RPC endpoints by default
  (`.env.example`, `docker-compose.yml:51-59`), configured through a single
  `HORIZON_URL` and `SOROBAN_RPC_URL` (`indexer/config/config.go:22-26`).
- Soroban RPC calls have a 30-second HTTP timeout and retry network errors and
  HTTP 429/5xx up to three times with exponential backoff
  (`indexer/soroban/rpc.go:48-56`, `indexer/soroban/rpc.go:76-170`). There is no
  secondary provider, failover, or circuit breaker.
- The listener waits a confirmation depth of three ledgers, verifies a finalized
  ledger hash, and halts on a detected reorg instead of advancing the checkpoint
  (`indexer/config/config.go:116-132`,
  `indexer/listener/soroban.go:107-138`). Verification hashes live in memory
  only, so a reorg that happened while the process was down cannot be detected
  at startup, and recovery is manual
  (`indexer/listener/soroban.go:132-138`,
  `indexer/listener/soroban.go:255-265`).
- There is no documented provider quota, throughput model, latency SLO, or
  failover exercise. Provider URLs with embedded API keys are redacted from
  transport errors (`indexer/soroban/rpc.go:90-105`; see also
  `docs/developer-guide/environment-variables.md:41`), but secret handling in
  deployment is still an operational requirement.

### Exit criteria before Mainnet

- At least two independent RPC/Horizon providers, or a self-hosted path, with
  tested automatic failover and consistent network/passphrase checks.
- Documented quotas, rate limits, request budgets, and capacity assumptions for
  expected invoice and event volume.
- Load and soak tests that cover polling, simulation, submission, and webhook
  fan-out near provider limits.
- Monitoring and alerts for RPC latency, error rate, 429s, ledger lag, and
  provider disagreement; an on-call runbook for provider outages.
- A reorg runbook that persists enough ledger/hash history to detect reorgs
  across restarts, with a tested replay procedure.

## 4. API

**Status: Partial.**

### Current state

- The API implements a SEP-10-style challenge/response flow: a server-signed
  challenge with 15-minute time bounds, client signature verification, and an
  HS256 JWT (`indexer/auth/challenge.go:23-144`). Production startup requires
  explicit `JWT_SECRET` and `SERVER_SEED` values
  (`indexer/config/config.go:78-106`).
- Protected routes use JWT authentication, and all routes have per-client rate
  limiting with a separate invoice-creation limiter, allowlist CORS, security
  headers, and a health endpoint (`indexer/api/router.go:365-448`). The server
  sets read-header, read, write, and idle timeouts
  (`indexer/main.go:44-56`).
- `GET /metrics` is public unless `METRICS_TOKEN` is set
  (`indexer/api/router.go:381-389`), and the default environment template leaves
  it unset (`.env.example:19-21`).
- The OpenAPI specification covers every registered route and has a coverage
  test (`docs/openapi/README.md:5-23`, `docs/openapi/README.md:33-39`), but the
  spec is not versioned and error responses are plain text rather than a stable
  structured schema (`docs/developer-guide/indexer-api-reference.md:22-29`).
- `POST /invoices` is a relay that simulates, signs with the indexer's server
  key, submits, and polls for confirmation (`docs/ARCHITECTURE.md:107-113`).
  There is no idempotency key, so a client retry can create another invoice.
- Challenge verification checks the signature and time bounds but does not keep
  a server-side used-challenge store, so replay is bounded only by the
  15-minute window (`indexer/auth/challenge.go:76-144`).
- There is no WAF, DDoS protection, API SLA, or documented quota/abuse response
  process in the repository.

### Exit criteria before Mainnet

- Authentication hardening: single-use challenge tracking (or an equivalent
  replay defense), JWT key rotation and revocation, clock-skew handling, and
  explicit token lifetime/refresh policy.
- Idempotency keys for invoice creation and webhook subscription mutations, with
  documented duplicate semantics.
- A versioned API with a deprecation policy, structured error schema, and
  contract tests that fail on breaking changes.
- Independently tested abuse controls: rate-limit bypass attempts, request-size
  limits, SSRF/webhook target validation, CORS/CSRF review, and injection tests.
- Capacity and load testing, documented quotas, an SLA/error budget, audit
  logging, and a relay-key isolation design (see gate 6).

## 5. Monitoring and alerting

**Status: Partial.**

### Current state

- Prometheus metrics cover invoice events, webhook delivery outcomes, the last
  processed ledger, and database query latency
  (`indexer/api/metrics.go:10-43`). The listener exposes health, and
  `GET /health` returns 503 when the listener or database is unavailable
  (`indexer/api/router.go:392-403`, `indexer/api/health.go`).
- The process logs structured JSON, reports panics to Sentry when `SENTRY_DSN`
  is set, and exits non-zero on listener or HTTP-server failure so a supervisor
  can restart it (`indexer/main.go:44-56`, `indexer/main.go:90-126`,
  `indexer/main.go:216-260`).
- There is no Prometheus scrape configuration, dashboard-as-code, alert rule
  set, SLO/error budget, paging rotation, synthetic check, or tested runbook in
  the repository.
- Metrics are unauthenticated by default, and there is no alert for webhook
  dead-letter growth, database saturation, RPC degradation, or certificate/TLS
  expiry.
- `/health` covers the listener and database, not RPC provider health, webhook
  backlog age, or end-to-end transaction success.

### Exit criteria before Mainnet

- Defined SLIs/SLOs for API availability and latency, indexer lag, RPC success,
  transaction confirmation, webhook delivery, and database health.
- Version-controlled dashboards and alerts with routing, severity, ownership,
  and tested paging.
- Alerts for listener lag/reorg halt, RPC errors and rate limits, API 5xx/latency,
  webhook dead letters and backlog, database connections/storage, failed
  migrations, and certificate expiry.
- Synthetic end-to-end checks (wallet auth, invoice creation, event indexing,
  webhook delivery) plus an on-call runbook and incident communication path.
- Authenticated metrics or network isolation, centralized log retention, and
  an audit trail for privileged actions.

## 6. Wallet and key management

**Status: Not met for Mainnet. Partial on Testnet.**

### Current state

- The wallet path is Testnet-only. `useWallet` defines
  `EXPECTED_NETWORK = "testnet"` and rejects other networks
  (`apps/web/hooks/useWallet.ts:13-16`, `apps/web/hooks/useWallet.ts:28-38`,
  `apps/web/hooks/useWallet.ts:100`), and the UI's only switch action targets
  Testnet (`apps/web/components/shared/WalletConnect.tsx:52-75`).
- `useAuth` computes a network from `NEXT_PUBLIC_STELLAR_NETWORK` but then signs
  the challenge with a hard-coded `network: "TESTNET"`
  (`apps/web/hooks/useAuth.ts:63-68`). A Mainnet configuration would therefore
  still take the Testnet signing path until this is fixed.
- Freighter is the only supported wallet; there is no hardware-wallet,
  multisig, or account-recovery flow in the app.
- The indexer's transaction relay key comes from `SERVER_SEED` and is a hot key
  held in the process environment (`indexer/config/config.go:93-106`,
  `.env.example:284-294`). It signs invoice-creation transactions
  (`docs/ARCHITECTURE.md:107-113`). There is no KMS/HSM integration, key
  rotation, or split-signing design in the repository.
- `JWT_SECRET` is also environment-held (`.env.example:268-282`). Webhook signing
  secrets are generated with `crypto/rand` but stored as plain `TEXT` in
  PostgreSQL (`indexer/api/handlers_webhooks.go:32-39`,
  `indexer/db/migrations/009_add_webhook_subscriptions.sql:9`,
  `indexer/db/webhooks.go:110`).
- The contracts' admin is a single Stellar address by default, and the threat
  model flags this as a single point of failure. Multisig is documented as a
  manual deployment option, not enforced by the app
  ([THREAT_MODEL.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/THREAT_MODEL.md#centralization-risks),
  [DEPLOYMENT.md](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/DEPLOYMENT.md#multi-sig-admin)).

### Exit criteria before Mainnet

- Remove Testnet hard-coding: the wallet connection, challenge signing, and
  network validation must derive from the configured network and reject
  mismatches explicitly. Add an automated Mainnet configuration test.
- Move the relay, admin, treasury, and deployment keys into a KMS/HSM or
  equivalent signing service with least-privilege policies, audit logging, and
  a documented key ceremony and rotation/revocation procedure.
- Enforce 3-of-5 (or stronger) multisig for contract admin and treasury actions;
  do not rely on an optional deployment runbook.
- Encrypt webhook secrets at rest (or store only a reference to a secret
  manager), restrict read access, and define rotation.
- Publish a wallet compatibility and security matrix, transaction simulation
  and clear-signing expectations, and user guidance for key recovery and
  phishing resistance.
- Run secret scanning and dependency/supply-chain checks on every release and
  document the response when a key or secret is exposed.

## 7. Backup and recovery

**Status: Not met.**

### Current state

- The indexer database is PostgreSQL (Neon in deployment guidance, Compose
  locally). The repository contains no backup schedule, retention policy,
  point-in-time-recovery configuration, restore script, or restore test
  (`docs/developer-guide/environment-variables.md:50-59`).
- The on-chain contracts are the source of truth for protocol state; the
  indexer database is a cache. That reduces, but does not remove, the recovery
  problem: application state, webhook queues, and operational history still
  need restoration.
- The indexer stores a checkpoint and de-duplicates events, and the listener
  documents a manual reorg recovery path
  (`indexer/db/migrations/006_checkpoint.sql`,
  `indexer/listener/soroban.go:107-138`).
- `indexer/cmd/backfill/main.go:11-21` is a stub: it parses ledger bounds,
  loads config, prints a message, and exits. It does not replay events.
- Migrations are forward-only with no down scripts
  (`docs/developer-guide/local-setup.md:181-195`). The local reset advice is to
  destroy the database volume, which is not a production recovery strategy.
- There is no documented RTO/RPO, disaster-recovery exercise, or runbook for
  database loss, RPC/history loss, webhook backlog recovery, or a reorg detected
  across a restart.

### Exit criteria before Mainnet

- Automated, encrypted, access-controlled backups with point-in-time recovery,
  defined retention, and cross-region or cross-provider copies.
- A restore runbook with measured RTO/RPO and a successful restore drill on a
  schedule, including restoration into an isolated environment.
- A working, tested backfill/replay tool that reconstructs indexer state from the
  authoritative chain, including webhook delivery reconciliation and safe
  de-duplication.
- Runbooks for database loss, reorg, RPC outage, stuck webhook queue, failed
  migration, and partial region failure, with named owners and communication
  steps.
- Backups and recovery procedures for keys and secrets with dual control; an
  annual disaster-recovery exercise with results retained as release evidence.

## 8. Compliance and operational prerequisites

**Status: Not met.**

### Current state

- The project is an experimental Testnet prototype and says so
  (`README.md:62`, `docs/README.md:33-35`,
  `docs/introduction/what-is-clearledger.md`). Public materials state that it is
  not a bank, lender, or payment service and that funding, repayment, and
  returns are not guaranteed (`README.md:20`,
  `docs/introduction/what-is-clearledger.md`).
- There is no KYC/AML program, sanctions screening, transaction monitoring,
  licensing or regulatory analysis, terms of service, privacy policy, cookie
  policy, records-retention policy, complaints/dispute process, or consumer
  risk disclosure in the repository.
- There is no incident-response plan, on-call structure, status page, business
  continuity plan, vendor due-diligence record, insurance review, or financial
  reconciliation/treasury control for a production service.
- `SECURITY.md` defines vulnerability reporting and response targets
  (`SECURITY.md:40-68`), but that is a security policy, not an operational or
  regulatory compliance program.

### Exit criteria before Mainnet

- A written legal/regulatory assessment for every intended operating
  jurisdiction, covering licensing, securities, lending, payments, tax, and
  consumer-protection obligations.
- An operating KYC/AML/sanctions-screening and transaction-monitoring program,
  with escalation, recordkeeping, and independent review.
- Published terms, privacy and cookie notices, risk disclosures, fee/return
  explanations, and a complaints/dispute process that do not promise financing
  or returns.
- Records-retention, data-protection, access-review, and vendor-risk policies
  appropriate to the data handled.
- A tested incident-response and business-continuity program with on-call
  ownership, customer communication, regulatory notification where required,
  and periodic tabletop exercises.
- Financial controls for treasury and LP funds (reconciliation, segregation of
  duties, approvals, audit trail) and an insurance/risk-transfer decision.

## Release go/no-go rule

Do not represent the service as production-ready, Mainnet-ready, or safe for
real funds until **all eight gates are Met**, all critical/high audit findings
are closed, a staging soak and disaster-recovery exercise have passed, and
legal/operational sign-off is recorded with named owners. Any public statement
should continue to distinguish Testnet evaluation from Mainnet operation and
must not imply guaranteed funding, repayment, or returns.

## Related risk documents

- [Repository security policy](../SECURITY.md)
- [Contract limitations](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/LIMITATIONS.md)
- [Contract threat model](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/THREAT_MODEL.md)
- [Contract deployment guide](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/DEPLOYMENT.md)
- [Contract security policy](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/SECURITY.md)
- [System architecture](ARCHITECTURE.md)
- [Security headers and CSP](developer-guide/security-headers.md)
- [Webhook delivery semantics](webhooks.md)
- [Mainnet configuration mapping](developer-guide/mainnet-setup.md) (configuration values only, not a readiness claim)
