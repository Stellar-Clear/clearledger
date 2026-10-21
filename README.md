# ClearLedger

**Invoice finance infrastructure, built on Stellar and powered by Soroban.**

ClearLedger is an open-source invoice-finance platform built on Stellar. Its Soroban smart contracts coordinate participant verification, invoice lifecycle state, USDC liquidity pools, and settlement flows. The complete stack brings together on-chain contracts, a web application, TypeScript SDK and CLI, and a Go indexer/API.

[Launch the Stellar Testnet app](https://clearledger-three.vercel.app) · [Explore the Soroban contracts](https://github.com/Stellar-Clear/clearledger-contracts) · [Read the documentation](docs/README.md) · [View Testnet contracts](https://github.com/Stellar-Clear/clearledger-contracts#testnet-deployments)

## Built for Stellar

ClearLedger uses [Soroban, Stellar’s smart-contract platform](https://developers.stellar.org/docs/build/smart-contracts/overview), to coordinate business identity, invoice records, pool shares, and USDC flows on Stellar. The TypeScript SDK and web app connect to Soroban contracts, while the Go indexer follows contract events to make network activity available to applications.

## The workflow

1. **Onboard participants.** Register SME issuers and trade buyers through the participant registry.
2. **Create invoice records.** Issuers record invoice terms and progress through explicit on-chain lifecycle states.
3. **Coordinate liquidity.** USDC pool contracts account for liquidity, invoice funding, LP shares, and repayment flows.
4. **Follow activity.** The Go indexer consumes Soroban events for API access and application views.

The protocol records submitted transaction state. It does not independently verify commercial documents, guarantee that an invoice will be funded, or guarantee repayment or returns.

## Project map

| Path | What lives here |
| --- | --- |
| `apps/web/` | Next.js application and public product experience |
| `packages/sdk/`, `packages/sdk-react/` | TypeScript contract clients and React hooks |
| `packages/cli/` | Developer command-line tools |
| `indexer/` | Go Soroban event indexer and HTTP API |
| `examples/` | SDK and integration examples |
| `docs/` | Protocol, user, and developer documentation, including [analytics metric definitions](docs/ANALYTICS_METRICS.md) |

Soroban contract source and deployment details live in the [companion contracts repository](https://github.com/Stellar-Clear/clearledger-contracts).

## Run locally

Requirements: Node.js 20+, pnpm 9+, and Docker for the complete local stack. For wallet interactions, install [Freighter](https://www.freighter.app/) and select Stellar Testnet.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The web app starts at `http://localhost:3000`. For a guided Testnet walkthrough covering Freighter and a read-only Soroban call, see the [Stellar Testnet quickstart](docs/QUICKSTART.md). For the web app, Go indexer, and PostgreSQL together:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

The hosted app is a testnet web deployment. The Go API/indexer must be run separately; configure `NEXT_PUBLIC_API_BASE_URL` for the API endpoint when using API-backed features. For the complete variable reference, see [environment configuration](docs/developer-guide/environment-variables.md).

## Development

From the repository root, the main checks are `pnpm build`, `pnpm check:sdk-artifacts`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Run Go checks from `indexer/` with `go test ./...` and `go vet ./...`.

Start with the [local setup guide](docs/developer-guide/local-setup.md), [architecture overview](docs/ARCHITECTURE.md), and [contribution guide](docs/contributing/how-to-contribute.md). For RPC outages, database restores, ledger gaps, and webhook replay, see the [indexer operations runbook](docs/developer-guide/indexer-operations.md). For protocol details, see [how it works](docs/introduction/how-it-works.md), the [invoice lifecycle](docs/protocol/invoice-lifecycle.md), and the [economic model](docs/protocol/economic-model.md).

## Network and security

The web application and contracts are currently deployed on Stellar Testnet for evaluation and integration. This is not a mainnet financial service. The contracts have not been formally audited, and testnet assets have no promised redemption value. Do not use real funds. Review the [contract limitations](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/docs/LIMITATIONS.md) and [security policy](https://github.com/Stellar-Clear/clearledger-contracts/blob/main/SECURITY.md) before integrating.

Before planning any Mainnet deployment, read the [production readiness gates](docs/PRODUCTION_READINESS.md). They record the audit, deployment, RPC, API, monitoring, wallet, recovery, and compliance work that is still required; the current Testnet setup does not satisfy them.

Use testnet wallets and assets only. Never put private keys or recovery phrases in environment files or source control.

For tested keyboard flows, known limitations and the reporting route, read the [accessibility statement](docs/ACCESSIBILITY.md).
