# Environment Variables

| Variable                           | Where needed       | Description                              | Example                                              |
| ---------------------------------- | ------------------ | ---------------------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK`      | Frontend + Backend | Network name                             | `testnet`                                            |
| `NEXT_PUBLIC_HORIZON_URL`          | Frontend + Backend | Horizon REST API endpoint                | `https://horizon-testnet.stellar.org`                |
| `NEXT_PUBLIC_SOROBAN_RPC_URL`      | Frontend + Backend | Soroban RPC endpoint                     | `https://soroban-testnet.stellar.org`                |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE`   | Frontend + Backend | Stellar network passphrase               | `Test SDF Network ; September 2015`                  |
| `NEXT_PUBLIC_REGISTRY_CONTRACT_ID` | Frontend + Backend | Deployed registry contract address       | `CCGH...`                                            |
| `NEXT_PUBLIC_INVOICE_CONTRACT_ID`  | Frontend + Backend | Deployed invoice contract address        | `CCZN...`                                            |
| `NEXT_PUBLIC_ESCROW_CONTRACT_ID`   | Frontend + Backend | Deployed escrow contract address         | `CC3E...`                                            |
| `NEXT_PUBLIC_POOL_CONTRACT_ID`     | Frontend + Backend | Deployed pool contract address           | `CDBJ...`                                            |
| `NEXT_PUBLIC_USDC_ISSUER`          | Frontend + Backend | USDC issuer on Stellar testnet           | `GBBD...`                                            |
| `NEXT_PUBLIC_USDC_ASSET_CODE`      | Frontend + Backend | USDC asset code                          | `USDC`                                               |
| `NEXT_PUBLIC_API_BASE_URL`         | Frontend only      | Indexer API base URL                     | `http://localhost:8080`                              |
| `CSP_ENFORCE`                      | Frontend only      | Enforce the CSP (default: report-only)   | `true`                                               |
| `STELLAR_NETWORK`                  | Backend only       | Network name                             | `testnet`                                            |
| `HORIZON_URL`                      | Backend only       | Horizon REST API endpoint                | `https://horizon-testnet.stellar.org`                |
| `SOROBAN_RPC_URL`                  | Backend only       | Soroban RPC endpoint                     | `https://soroban-testnet.stellar.org`                |
| `NETWORK_PASSPHRASE`               | Backend only       | Stellar network passphrase               | `Test SDF Network ; September 2015`                  |
| `REGISTRY_CONTRACT_ID`             | Backend only       | Deployed registry contract address       | `CCGH...`                                            |
| `INVOICE_CONTRACT_ID`              | Backend only       | Deployed invoice contract address        | `CCZN...`                                            |
| `ESCROW_CONTRACT_ID`               | Backend only       | Deployed escrow contract address         | `CC3E...`                                            |
| `POOL_CONTRACT_ID`                 | Backend only       | Deployed pool contract address           | `CDBJ...`                                            |
| `AGENT_REGISTRY_CONTRACT`          | Backend only       | Deployed agent-registry contract address | `CABC...`                                            |
| `USDC_ISSUER`                      | Backend only       | USDC issuer on Stellar testnet           | `GBBD...`                                            |
| `USDC_ASSET_CODE`                  | Backend only       | USDC asset code                          | `USDC`                                               |
| `DATABASE_URL`                     | Backend only       | Neon pooled connection string            | `postgresql://user:pass@host/db?sslmode=require`     |
| `DATABASE_URL_UNPOOLED`            | Backend only       | Neon direct connection string            | `postgresql://user:pass@host/db?sslmode=require`     |
| `API_PORT`                         | Backend only       | Indexer HTTP port (fallback: `PORT`)     | `8080`                                               |
| `INDEXER_POLL_INTERVAL_MS`         | Backend only       | Soroban event poll interval              | `5000`                                               |
| `INDEXER_CONFIRMATION_DEPTH`       | Backend only       | Reorg buffer; ledgers behind tip (0=off) | `3`                                                  |
| `JWT_SECRET`                       | Backend only       | Secret for JWT signing                   | `your-secret-here`                                   |
| `JWT_EXPIRY_HOURS`                 | Backend only       | JWT token expiry                         | `24`                                                 |
| `ALLOWED_ORIGINS`                  | Backend only       | Allowed CORS origins for the indexer API | `http://localhost:3000` |

> **Note:** `CSP_ENFORCE` is read by the web app's middleware at request time, so it takes effect on restart or redeploy without a rebuild. See [Security Headers](security-headers.md).

> **Note:** `AGENT_REGISTRY_CONTRACT` is deployed from Underwrite's separate `underwrite-contract` repo, not from this monorepo.

> **Note:** Provider RPC URLs with embedded API keys are safe to use in `SOROBAN_RPC_URL`. Hosted Soroban RPC providers commonly authenticate via a key in the URL path or query string, and the indexer never echoes that URL to clients: transport errors from `CallSorobanRPC` are unwrapped to the operation name and underlying cause, and API handlers log backend errors server-side while responding with a generic message plus a request id (see issue #921).

## Source of truth

- **Local dev (backend):** Root `.env.local` (loaded by godotenv)
- **Local dev (frontend):** `apps/web/.env.local` (loaded by Next.js)
- **Production (backend):** Render dashboard → Environment Variables
- **Production (frontend):** Vercel dashboard → Environment Variables

## Database

The project uses **Neon Serverless Postgres** for the database. The connection string is managed via `neonctl`:

```bash
# Pull latest Neon env vars into .env.local
npx neonctl env pull
```

This updates `DATABASE_URL` and `DATABASE_URL_UNPOOLED` with the correct credentials. Never hardcode these in `.env` or commit them to git.
