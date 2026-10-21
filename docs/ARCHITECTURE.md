# System Architecture Overview

This document provides a high-level overview of the ClearLedger system architecture, describing the components, their responsibilities, and the exact data flow for invoice creation.

## 1. System Overview

ClearLedger is a decentralized trade finance platform built on the Stellar network. The system consists of three main tiers:

1. **Frontend**: Next.js single-page application that provides user interfaces for SMEs and Liquidity Providers.
2. **Go Indexer / Backend**: Go API service and background event listener backed by a PostgreSQL database, with webhook fan-out and Prometheus metrics.
3. **Smart Contracts**: Soroban smart contracts deployed on the Stellar Testnet (four ClearLedger contracts plus the external Underwrite agent-registry they depend on).

```
┌────────────────────────────────┐
│      Frontend (Next.js)        │
└────┬──────────────────────┬────┘
     │                      │
     │ HTTP API             │ Reads & Writes (via Wallet)
     ▼                      ▼
┌────────────────┐     ┌─────────────────────────┐
│   Go Indexer   │     │     Smart Contracts     │
│   (API & Sync) │────▶│ (Soroban / Stellar Txt) │
└────┬───────┬───┘relay└────────────┬────────────┘
     │       │                     ▲
     │       │ Writes to Cache     │ Polls Events
     │       │                     │ & Syncs Stats
     ▼       ▼                     │
┌────────────────┐                 │
│ PostgreSQL DB  │◄────────────────┘
└────────────────┘
     │
     │ Webhook fan-out        ┌─────────────────────┐
     └───────────────────────▶│ Webhook subscribers │
                              │ (external services) │
                              └─────────────────────┘
┌────────────────┐  scrapes   ┌─────────────────────┐
│   Prometheus   │◄───────────│ Indexer GET /metrics│
└────────────────┘            └─────────────────────┘
```

---

## 2. Component Descriptions

### Frontend

- **Location**: [`apps/web`](../apps/web)
- **Role**: High-fidelity web application for interacting with the platform.
- **Current Responsibilities**:
  - Connects to Stellar wallets (e.g., Freighter) for transaction signing.
  - Interacts directly with the Soroban smart contracts via [`@clearledger/sdk`](../packages/sdk) for user-initiated on-chain operations (e.g., listing an invoice, depositing USDC to the pool, repaying an invoice).
  - Performs off-chain requests to the Go Indexer API for user authentication and invoice creation.
  - Queries the Indexer API to fetch historical lists of invoices, liquidity pool metrics, and individual LP positions.

### Go Indexer

- **Location**: [`indexer`](../indexer)
- **Role**: A Go web server serving two main purposes: API Routing and Blockchain Event Listening.
- **Current Responsibilities**:
  - **API Service**: Implements SEP-10 authentication (requesting challenge tx and exchanging signed tx for JWT) and exposes REST endpoints for protocol-level stats, invoices, events, and pool data.
  - **Transaction Operator / Relay**: Implements the `POST /invoices` endpoint. It simulates the invoice creation transaction on Soroban, constructs the transaction envelope, signs it with the Indexer server's Stellar account, submits it to Stellar, and polls for on-chain confirmation.
  - **Event Listener**: A background worker polling the Soroban RPC for contract events. It handles `InvoiceCreated`, `InvoiceListed`, `InvoiceFunded`, `InvoiceShipped`, `DeliveryConfirmed`, `InvoiceRepaid`, `InvoiceDefaulted`, `AttestationSubmitted`, and the `issuer_registered` / `buyer_registered` registration events (see `indexer/listener/handlers.go`). It decodes these events from XDR and saves/syncs them directly to the database.
  - **Database (PostgreSQL)**: Acts as a fast database cache for the blockchain events, facilitating paginated queries and aggregation calculations.
  - **Webhook dispatcher and delivery worker** (`indexer/webhook`, `indexer/webhooks`, started in `indexer/main.go`): fans indexed invoice/pool events out to external subscriber endpoints. See [`docs/webhooks.md`](./webhooks.md) for the envelope, signing, and retry semantics.
  - **Observability and hardening** (`indexer/api/router.go`, `indexer/main.go`): Prometheus metrics at `GET /metrics` (`indexer/api/metrics.go` — invoices indexed, webhook delivery outcomes, listener ledger position, DB query latency); Sentry panic reporting via `RecoveryMiddleware` (no-op when `SENTRY_DSN` is unset); per-client token-bucket rate limiting via `RateLimitMiddleware` (keyed on JWT subject, falling back to client IP — 429 with `Retry-After`); strict-allowlist CORS (`CORSMiddleware`) and security headers (`SecurityHeadersMiddleware`); plus `GET /live` for process liveness and `GET /ready` for PostgreSQL, Soroban RPC, and listener readiness.

### Smart Contracts (Soroban)

- **Location**: Deployed on Stellar Testnet (Source repository: `ClearLedger-contract`)
- **Role**: Decentralized protocol logic and fund management on-chain.
- **Current Responsibilities**:
  - `registry_contract`: Manages white-listed status for participating SMEs (issuers) and Buyers.
  - `invoice_contract`: Governs the lifecycle of tokenized invoices, handling invoice creation, shipping confirmations, delivery confirmations, repayment, and defaults. `list_for_financing` is gated on a stored Underwrite risk attestation (see `submit_attestation`).
  - `pool_contract`: Manages the shared liquidity pool, USDC deposits/withdrawals for LPs, invoice funding calculations, and distribution of yield.
  - `escrow_contract`: Safely locks the funded USDC amount until repayment or default conditions are resolved.
  - External dependency — Underwrite `agent-registry` (deployed from the separate `underwrite-contract` repo): registry of authorized risk-assessment agents. `invoice_contract.submit_attestation` verifies attestation signatures against it, so an invoice cannot be listed for financing until a registered, active agent has attested it.

### Monorepo layout

| Path                 | Package                        | Role                                                                                                           |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js app                    | SME / LP user interfaces                                                                                       |
| `indexer`            | Go module                      | API service, event listener, webhook fan-out                                                                   |
| `packages/sdk`       | `@clearledger/sdk`              | TypeScript wrappers over all Soroban contract calls                                                            |
| `packages/sdk-react` | `@clearledger/sdk-react`        | React hooks over the SDK (`useInvoice`, `usePool`, `useEscrow`, `useRegistry`, `useAgentRegistry`, `useToken`) |
| `packages/cli`       | `@clearledger/cli`              | `clearledger` command-line client built on the SDK                                                              |
| `examples/`          | e.g. `examples/sdk-quickstart` | Runnable framework-free SDK usage examples                                                                     |

---

## 3. Invoice Creation Request Flow

Invoice creation in ClearLedger follows a hybrid pattern: the Frontend requests creation via the Indexer API (acting as a transaction relay/operator), and the Indexer handles the on-chain submission, polling, and subsequent database synchronization.

### Step-by-Step Lifecycle

1. **Stellar Wallet Connection & SEP-10 Auth**:
   - The user connects their wallet (e.g., Freighter) on the frontend.
   - To interact with protected Indexer endpoints, the Frontend initiates the SEP-10 flow by calling `GET /auth?address=<stellar_public_key>`.
   - The Indexer generates a challenge transaction and returns it. The Frontend prompts the user's wallet to sign the challenge, and sends the signed transaction to `POST /auth`.
   - The Indexer validates the signature and returns a JSON Web Token (JWT).

2. **Off-Chain Request Submission**:
   - The SME fills out the invoice details (Buyer, Face Value, Due Date) and clicks "Create Invoice".
   - The Frontend sends an authenticated `POST /invoices` request to the Indexer API with the JWT.

3. **On-Chain Transaction Simulation & Relay (Indexer API)**:
   - The Indexer API validates the payload (e.g., checking if the buyer exists and addresses are formatted properly).
   - It builds an invocation of the `invoice_contract.create` method.
   - The Indexer calls `simulateTransaction` via Soroban RPC to fetch resource requirements (Soroban transaction data, resource fee) and parses the generated `invoice_id` from the simulation output.
   - It constructs the final transaction envelope, signs it with the server's private key (`h.serverKP`), and submits it to Stellar using `sendTransaction` via Soroban RPC.
   - The Indexer polls the Soroban RPC (`getTransaction`) until the status transitions to `SUCCESS`.
   - Once confirmed on-chain, the Indexer API returns `invoice_id`, `transaction_hash`, and transaction status to the Frontend.

4. **Event Emission (Smart Contract)**:
   - The `invoice_contract` executes the `create` method, checking that both the issuer and buyer are registered.
   - It stores the invoice state on-chain and emits an `InvoiceCreated` event containing the invoice details.

5. **Asynchronous Event Indexing (Indexer Listener)**:
   - The Indexer's Event Listener polls Soroban RPC for new events every `INDEXER_POLL_INTERVAL_MS` (e.g., every 5 seconds).
   - It detects the `InvoiceCreated` event, parses the XDR payload, and inserts a new database record in PostgreSQL with the status `Created`.

6. **Frontend UI Refresh**:
   - The Frontend updates its state by querying `GET /invoices` or `GET /invoices/{id}` from the Indexer API.
   - The Indexer serves the updated data from its PostgreSQL cache, showing the invoice to the user with the status `Created`.

---

## 4. Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor SME as SME (Issuer)
    participant FE as Frontend (Next.js)
    participant Wallet as Stellar Wallet (Freighter)
    participant IX_API as Indexer API (Go)
    participant RPC as Soroban RPC
    participant SC as Invoice Contract (Soroban)
    participant DB as PostgreSQL DB
    participant IX_LIS as Indexer Listener (Go)

    Note over SME, FE: 1. Authentication (SEP-10)
    FE->>IX_API: GET /auth?address=<stellar_public_key>
    IX_API-->>FE: SEP-10 Challenge Tx
    FE->>Wallet: Sign challenge
    Wallet-->>FE: Signed Challenge Tx
    FE->>IX_API: POST /auth (Signed Challenge Tx)
    IX_API-->>FE: JWT Token

    Note over SME, FE: 2. Invoice Creation Request
    SME->>FE: Enter invoice details & submit
    FE->>IX_API: POST /invoices (JWT + Buyer, Face Value, Due Date)

    Note over IX_API, RPC: 3. Transaction Simulation & Submission
    IX_API->>RPC: simulateTransaction (create invoice invocation)
    RPC-->>IX_API: Simulation results, resource details & invoice_id
    IX_API->>RPC: sendTransaction (Signed using Indexer Server Keypair)
    RPC-->>IX_API: Transaction Hash

    loop Poll transaction status
        IX_API->>RPC: getTransaction(hash)
        RPC-->>IX_API: Status (SUCCESS / PENDING / FAILED)
    end

    IX_API-->>FE: Response (invoice_id, transaction_hash, SUCCESS)

    Note over SC: 4. Contract Execution & Event Emission
    SC->>SC: Executes create() on-chain
    SC-->>RPC: Emits InvoiceCreated Event (XDR)

    Note over IX_LIS, RPC: 5. Background Indexing
    loop Poll Soroban Events
        IX_LIS->>RPC: getEvents(topic: "InvoiceCreated")
        RPC-->>IX_LIS: InvoiceCreated Event (XDR)
    end
    IX_LIS->>DB: Insert Invoice (status: "Created")

    Note over FE, DB: 6. Frontend Querying Cache
    FE->>IX_API: GET /invoices or GET /invoices/{id}
    IX_API->>DB: Query invoice
    DB-->>IX_API: Invoice details (status: "Created")
    IX_API-->>FE: Invoice details JSON
    FE->>SME: Display Invoice in UI (status: Created)
```

## 5. Listing → Attestation Check → Funding Flow

Unlike creation (relayed by the indexer), listing and funding are user-signed
Soroban transactions submitted from the frontend via `@clearledger/sdk` with
Freighter. Listing is gated on the Underwrite attestation: `list_for_financing`
fails with `VerificationRequired` until a registered, active agent's
`AttestationSubmitted` event has been indexed. The listener fans each indexed
event out to webhook subscribers (see [`docs/webhooks.md`](./webhooks.md)).

```mermaid
sequenceDiagram
    autonumber
    actor SME as SME (Issuer)
    participant FE as Frontend (Next.js)
    participant Wallet as Stellar Wallet (Freighter)
    participant SC as Invoice Contract (Soroban)
    participant POOL as Pool Contract (Soroban)
    participant RPC as Soroban RPC
    participant IX_LIS as Indexer Listener (Go)
    participant DB as PostgreSQL DB
    participant WH as Webhook subscribers

    Note over SME, SC: 1. Underwrite attestation (prerequisite for listing)
    SC-->>RPC: Emits AttestationSubmitted (agent_id, risk_score)
    IX_LIS->>RPC: getEvents(topic: "AttestationSubmitted")
    RPC-->>IX_LIS: AttestationSubmitted Event (XDR)
    IX_LIS->>DB: Store attestation on invoice row
    IX_LIS->>WH: Dispatch webhook (invoice attested)

    Note over SME, Wallet: 2. Listing (SME-signed)
    SME->>FE: Set discount & list for financing
    FE->>Wallet: Sign list_for_financing(invoice_id, discount_bps)
    Wallet-->>FE: Signed transaction
    FE->>RPC: sendTransaction
    RPC->>SC: Executes list_for_financing()<br/>checks stored Attestation first
    SC-->>RPC: Emits InvoiceListed Event (XDR)
    IX_LIS->>RPC: getEvents(topic: "InvoiceListed")
    RPC-->>IX_LIS: InvoiceListed Event (XDR)
    IX_LIS->>DB: Update Invoice (status: "Listed")
    IX_LIS->>WH: Dispatch webhook (invoice.listed)

    Note over FE, POOL: 3. Funding (LP-signed)
    FE->>Wallet: Sign pool fund_invoice(invoice_id)
    Wallet-->>FE: Signed transaction
    FE->>RPC: sendTransaction
    RPC->>POOL: Executes fund_invoice()<br/>escrow.lock + release_to_issuer + mark_funded
    POOL-->>RPC: Emits InvoiceFunded Event (XDR)
    IX_LIS->>RPC: getEvents(topic: "InvoiceFunded")
    RPC-->>IX_LIS: InvoiceFunded Event (XDR)
    IX_LIS->>DB: Update Invoice (status: "Funded") + SyncPoolStats
    IX_LIS->>WH: Dispatch webhook (invoice.funded)
```
