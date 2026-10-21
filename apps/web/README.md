# ClearLedger Web App

ClearLedger is an experimental Stellar testnet application for invoice finance. It coordinates SME issuers, trade buyers and liquidity providers around invoice terms, delivery confirmation, pool funding and repayment. This package contains the Next.js interface for the Go indexer/API, Soroban contracts and TypeScript SDK.

## Architecture

```text
Freighter Wallet
      ↓
Next.js Web App  ──→  Go Indexer/API  ──→  PostgreSQL
      ↓                    ↓
TypeScript SDK       Soroban event listener
      ↓
Stellar Horizon + Soroban RPC
      ↓
Registry / Invoice / Pool / Escrow contracts
```

See the root [`README.md`](../../README.md) for the project overview and testnet configuration.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Go 1.25+
- PostgreSQL 15+ or Docker Compose
- Freighter wallet configured for Stellar Testnet

## Environment setup

The web app has a frontend-only env template at [`.env.example`](.env.example). Copy it to `.env.local` for a web-only setup:

```bash
cp .env.example .env.local
```

If you are running the full local stack, including the Go indexer/API, use the repository root env template instead so both the web app and indexer can share the same variables:

```bash
cp ../../.env.example ../../.env.local
```

Important frontend variables include:

| Variable                           | Required | Purpose                                                                          |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK`      | Yes      | Active Stellar network name, usually `testnet` locally.                          |
| `NEXT_PUBLIC_HORIZON_URL`          | Yes      | Horizon endpoint used for balances and account reads.                            |
| `NEXT_PUBLIC_SOROBAN_RPC_URL`      | Yes      | Soroban RPC endpoint used by the SDK.                                            |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE`   | Yes      | Stellar network passphrase.                                                      |
| `NEXT_PUBLIC_REGISTRY_CONTRACT_ID` | Yes      | Registry contract ID.                                                            |
| `NEXT_PUBLIC_INVOICE_CONTRACT_ID`  | Yes      | Invoice contract ID.                                                             |
| `NEXT_PUBLIC_POOL_CONTRACT_ID`     | Yes      | Pool contract ID.                                                                |
| `NEXT_PUBLIC_ESCROW_CONTRACT_ID`   | Yes      | Escrow contract ID.                                                              |
| `NEXT_PUBLIC_USDC_ISSUER`          | Yes      | USDC issuer used for balance detection.                                          |
| `NEXT_PUBLIC_API_BASE_URL`         | Optional | Indexer/API base URL. Defaults should point to local indexer during development. |

## Install dependencies

From the repository root:

```bash
pnpm install
```

## Run the full local stack

1. Start PostgreSQL from the repository root:

```bash
docker-compose up -d
```

2. Start the indexer/API:

```bash
cd indexer
go run main.go
```

3. Start the web app:

```bash
pnpm --filter web dev
```

4. Open the app:

```text
http://localhost:3000
```

Connect Freighter on Testnet and fund the wallet with Testnet XLM/USDC before testing invoice flows.

## Available scripts

From the repository root:

| Command                 | Description                                   |
| ----------------------- | --------------------------------------------- |
| `pnpm dev`              | Start the web app through the root script.    |
| `pnpm --filter web dev` | Start only the Next.js app.                   |
| `pnpm build`            | Build SDK and web app.                        |
| `pnpm lint`             | Run web linting.                              |
| `pnpm test`             | Run workspace tests.                          |
| `pnpm typecheck`        | Run TypeScript type checks across workspaces. |

From `apps/web`:

| Command      | Description                          |
| ------------ | ------------------------------------ |
| `pnpm dev`   | Start Next.js dev server.            |
| `pnpm build` | Create production build.             |
| `pnpm start` | Start production server after build. |
| `pnpm lint`  | Run Next lint.                       |
| `pnpm test`  | Run the configured Vitest suites.                |

## Wallet setup

1. Install Freighter.
2. Switch Freighter to Stellar Testnet.
3. Fund your account from the Stellar testnet friendbot or demo faucet.
4. Use the app navbar wallet button to connect.
5. Register an SME or buyer profile and complete the protocol verification step before gated actions. Registration is not a substitute for legal or commercial due diligence.

## Accessibility

See the [accessibility statement](../../docs/ACCESSIBILITY.md) for the tested
keyboard flows, known limitations, browser and assistive-technology coverage,
and the route for reporting an accessibility problem. The underlying tests live
in this package and can be run with `pnpm test` (Vitest) or `pnpm test:e2e`
(Playwright, desktop Chromium).

## API documentation

The indexer OpenAPI spec lives at [`../../docs/openapi/indexer.yaml`](../../docs/openapi/indexer.yaml). It documents health, SEP-10 authentication, invoice, stats, event, and pool endpoints.

## Accessibility

Transaction feedback is announced through live regions rather than focus
changes:

- `TransactionPending` renders a polite `role="status"` region for pending and
  confirmed states, and an assertive `role="alert"` region for failures or
  confirmation timeouts. The optional `state` (`"pending" | "confirmed" |
  "failed"`) and `errorText` props let callers override the inferred state when
  a transaction completes outside the dialog.
- `showSuccessToast` and `showErrorToast` expose confirmed and failed outcomes
  through polite and assertive live regions respectively.
- Only one region carries text for a given transition, so a state change is not
  announced twice.

## Development workflow

- Use the root `.env.example` for all env variables.
- Keep contract IDs synchronized with the latest deployed Soroban contracts.
- Use the SDK package for contract calls instead of duplicating RPC logic inside components.
- Keep API response shapes aligned with `docs/openapi/indexer.yaml`.
