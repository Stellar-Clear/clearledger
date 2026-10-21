# Stellar Mainnet Setup Guide

This guide maps ClearLedger's Testnet configuration to the values and endpoints you would need to target the Stellar Mainnet. It covers environment variables, RPC endpoints, contract deployment, and network switching.

> **Configuration reference only.** Passing through this guide does not make the service production-ready, and Mainnet deployment is not currently supported. See [Production Readiness Gates](../PRODUCTION_READINESS.md) for the audit, deployment, RPC, API, monitoring, wallet, recovery, and compliance work required first.

## Overview

The main difference between testnet and mainnet deployments is the network configuration:

| Aspect                 | Testnet                                                    | Mainnet                                                   |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| **Network Name**       | `testnet`                                                  | `mainnet`                                                 |
| **Horizon URL**        | `https://horizon-testnet.stellar.org`                      | `https://horizon.stellar.org`                             |
| **Soroban RPC URL**    | `https://soroban-testnet.stellar.org`                      | `https://soroban.stellar.org`                             |
| **Network Passphrase** | `Test SDF Network ; September 2015`                        | `Public Global Stellar Network ; September 2015`          |
| **USDC Issuer**        | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV` |

---

## Environment Variables for Mainnet

### Network Configuration

```bash
# Network identifier
NEXT_PUBLIC_STELLAR_NETWORK=mainnet

# Horizon REST API endpoint for querying transactions and account data
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org

# Soroban RPC endpoint for smart contract interactions
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org

# Network passphrase used for transaction signing (must match network)
NEXT_PUBLIC_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
```

**Important:** The network passphrase must match exactly. Transactions signed with the wrong passphrase will be rejected.

### Contract IDs

Replace these with your deployed mainnet contract addresses:

```bash
# Registry contract (stores service provider metadata)
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Invoice contract (handles invoice issuance and management)
NEXT_PUBLIC_INVOICE_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Escrow contract (manages payment escrow between parties)
NEXT_PUBLIC_ESCROW_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Liquidity Pool contract (manages LP deposits and yield distribution)
NEXT_PUBLIC_POOL_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Note:** Contract IDs are 56-character strings starting with `C`. You will obtain these from your smart contract deployment process. See [Smart Contracts Overview](../smart-contracts/overview.md) for deployment instructions.

### USDC Configuration

```bash
# USDC issuer on Stellar mainnet
NEXT_PUBLIC_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV

# USDC asset code (should remain the same for all networks)
NEXT_PUBLIC_USDC_ASSET_CODE=USDC
```

**Warning:** Using the wrong USDC issuer will prevent transactions with actual USDC tokens on mainnet. Always verify the issuer address.

### Backend Configuration

For the indexer and backend services:

```bash
# Indexer HTTP server port
API_PORT=8080

# Poll interval for Soroban events (in milliseconds)
# Recommended: 5000 (5 seconds) for mainnet to reduce RPC rate limits
INDEXER_POLL_INTERVAL_MS=5000

# JWT secret for authentication (use a strong, random value)
JWT_SECRET=your-strong-random-secret-here

# JWT token expiry time (in hours)
JWT_EXPIRY_HOURS=24

# Indexer API URL (exposed to frontend)
NEXT_PUBLIC_API_BASE_URL=https://your-indexer-domain.com

# Database connection strings (Neon Postgres)
DATABASE_URL=postgresql://user:pass@host/mainnet-db?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host/mainnet-db?sslmode=require
```

**Database:** For production mainnet, create a separate database to isolate mainnet data from testnet. Update `DATABASE_URL` credentials accordingly.

---

## Mainnet RPC Endpoints

### Horizon API

**URL:** `https://horizon.stellar.org`

- **Purpose:** Query account balances, transaction history, and payment information
- **Rate Limits:** Standard SDF rate limits apply (typically 3600 requests/hour)
- **Documentation:** [Horizon API Reference](https://developers.stellar.org/docs/apis/horizon)

Example Horizon requests:

```bash
# Get account details
curl https://horizon.stellar.org/accounts/GXXXXXXXXX

# Get account transactions
curl https://horizon.stellar.org/accounts/GXXXXXXXXX/transactions
```

### Soroban RPC

**URL:** `https://soroban.stellar.org`

- **Purpose:** Submit and query Soroban smart contract transactions
- **Rate Limits:** Subject to network congestion and SDF limits
- **Documentation:** [Soroban RPC Reference](https://developers.stellar.org/docs/learn/networks/testnet#soroban-rpc)

Example Soroban RPC requests:

```bash
# Get Soroban instance (core-related data)
curl -X POST https://soroban.stellar.org \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getNetwork",
    "params": []
  }'

# Submit contract transaction
curl -X POST https://soroban.stellar.org \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "sendTransaction",
    "params": ["<transaction_envelope>"]
  }'
```

---

## Freighter Wallet Configuration

### Network Switching

Freighter allows users to switch between Stellar networks (testnet/mainnet). The network passphrase must match the Freighter configuration.

**Freighter Network Settings:**

1. **Testnet:**
   - Name: `Stellar Testnet`
   - Passphrase: `Test SDF Network ; September 2015`
   - Horizon URL: `https://horizon-testnet.stellar.org`

2. **Mainnet:**
   - Name: `Stellar Mainnet` (pre-configured in Freighter)
   - Passphrase: `Public Global Stellar Network ; September 2015`
   - Horizon URL: `https://horizon.stellar.org`

### User Instructions for Mainnet

Users need to:

1. Install [Freighter Wallet](https://www.freighter.app/) browser extension
2. Add USDC token to their Freighter wallet:
   - Issuer: `GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV`
   - Code: `USDC`
3. Switch to "Stellar Mainnet" network in Freighter
4. Fund their account with XLM for transaction fees
5. Open ClearLedger application with mainnet environment variables

### Frontend Implementation

The ClearLedger frontend reads the network configuration from environment variables. The network passphrase is used to:

- **Sign transactions** (`lib/freighter.ts` uses it via `stellar-sdk`)
- **Validate network compatibility** with Freighter
- **Verify Soroban RPC responses**

The SDK automatically uses `NEXT_PUBLIC_NETWORK_PASSPHRASE` from the config:

```typescript
// apps/web/lib/api.ts
import { DEFAULT_NETWORK } from "@clearledger/sdk";

// Transactions are signed with the network passphrase
const transaction = new Transaction(
  envelope,
  DEFAULT_NETWORK.networkPassphrase,
);
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Deploy all smart contracts to mainnet and note contract IDs
- [ ] Verify USDC issuer address (`GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV`)
- [ ] Create separate production database for mainnet
- [ ] Generate strong JWT secret (use `openssl rand -hex 32`)
- [ ] Test all environment variables in staging environment first

### Frontend Deployment (Vercel/hosting platform)

1. Set environment variables in your hosting platform dashboard:

   ```
   NEXT_PUBLIC_STELLAR_NETWORK=mainnet
   NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
   NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org
   NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
   NEXT_PUBLIC_REGISTRY_CONTRACT_ID=<your-contract-id>
   NEXT_PUBLIC_INVOICE_CONTRACT_ID=<your-contract-id>
   NEXT_PUBLIC_ESCROW_CONTRACT_ID=<your-contract-id>
   NEXT_PUBLIC_POOL_CONTRACT_ID=<your-contract-id>
   NEXT_PUBLIC_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV
   NEXT_PUBLIC_USDC_ASSET_CODE=USDC
   NEXT_PUBLIC_API_BASE_URL=https://your-indexer-domain.com
   ```

2. Deploy the frontend

### Indexer/Backend Deployment (Render/hosting platform)

1. Set environment variables in your hosting platform dashboard:

   ```
   API_PORT=8080
   INDEXER_POLL_INTERVAL_MS=5000
   JWT_SECRET=<your-generated-secret>
   JWT_EXPIRY_HOURS=24
   DATABASE_URL=<your-mainnet-db-connection>
   DATABASE_URL_UNPOOLED=<your-mainnet-db-connection>
   ```

2. Run database migrations:

   ```bash
   # In indexer directory
   psql -h <your-db-host> -U <user> -d <database> -f db/migrations/001_initial.sql
   ```

3. Deploy the indexer service

### Post-Deployment

- [ ] Test user registration and wallet connection with mainnet
- [ ] Create test invoice and verify escrow operations
- [ ] Verify LP deposit and yield calculations
- [ ] Monitor indexer logs for event processing errors
- [ ] Check database for correct transaction records
- [ ] Load test with realistic transaction volume
- [ ] Set up monitoring/alerting for RPC endpoint failures

---

## Testing on Mainnet

### Account Setup

1. Create or use an existing Stellar mainnet account
2. Fund with minimum XLM for transaction fees (~1-2 XLM)
3. Add USDC trustline:
   ```bash
   stellar pay --testnet \
     --source-account <your-account> \
     --destination <your-account> \
     --asset-code USDC \
     --asset-issuer GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV \
     --amount 0
   ```

### Transaction Verification

1. Use Horizon to verify transactions:

   ```bash
   curl https://horizon.stellar.org/transactions/<tx-hash>
   ```

2. Use Stellar Expert Explorer for UI-based verification:
   - https://stellar.expert/explorer/public

3. Monitor indexer logs for event processing

---

## Troubleshooting

### "Invalid network passphrase" Error

**Cause:** Network passphrase mismatch between environment config and Freighter

**Solution:**

- Verify `NEXT_PUBLIC_NETWORK_PASSPHRASE` is exactly: `Public Global Stellar Network ; September 2015`
- Ensure Freighter is switched to "Stellar Mainnet"
- Clear browser cache and restart

### "Contract not found" Error

**Cause:** Contract ID doesn't exist on mainnet or is incorrect

**Solution:**

- Verify contract ID starts with `C` and is 56 characters
- Check contract was deployed to mainnet (not testnet)
- Use Stellar Expert to verify contract exists: `https://stellar.expert/explorer/public/contract/<contract-id>`

### Transactions Fail with "Rate Limited"

**Cause:** Exceeding Soroban RPC rate limits

**Solution:**

- Increase `INDEXER_POLL_INTERVAL_MS` to 10000 (10 seconds)
- Implement transaction queuing in indexer
- Consider setting up a private Soroban RPC endpoint

### Database Connection Errors

**Cause:** Incorrect `DATABASE_URL` or network connectivity issues

**Solution:**

- Verify database credentials and host are correct
- Check database is accessible from deployment environment
- Ensure SSL mode is enabled (`sslmode=require`)
- Test connection: `psql postgresql://user:pass@host/db?sslmode=require`

---

## Additional Resources

- [Stellar Mainnet Documentation](https://developers.stellar.org/docs/learn/networks/public-network)
- [Soroban RPC API Reference](https://soroban.stellar.org/)
- [Horizon API Reference](https://developers.stellar.org/docs/apis/horizon)
- [Smart Contracts Deployment](../smart-contracts/overview.md)
- [Testnet Setup](environment-variables.md)
- [Freighter Wallet Documentation](https://www.freighter.app/)

---

## Comparing Testnet vs Mainnet

For a quick reference when migrating configurations:

```bash
# TESTNET
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

# MAINNET
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
NEXT_PUBLIC_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4SHAHTQO62OJJVTIL7FWRVJRNRQWWIV
```
