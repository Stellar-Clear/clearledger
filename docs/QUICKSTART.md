# Stellar Testnet Quickstart

This guide takes a new contributor from a clean checkout to a running ClearLedger
web app, a connected Freighter wallet, and one read-only Soroban contract call on
Stellar Testnet.

> **Testnet only.** ClearLedger is an experimental, unaudited prototype. This
> guide uses Stellar Testnet, testnet assets and no real funds. It is not a
> mainnet deployment guide. Testnet assets have no promised redemption value, and
> the protocol does not guarantee funding, repayment or returns. Do not use a
> mainnet wallet or send real money.

You do not need to deploy contracts for this guide. The current Testnet contract
IDs are already checked into the environment templates. You also do not need the
Go indexer or PostgreSQL for the wallet connection and read-only contract call;
some API-backed parts of the web app will show unavailable data until the
indexer is running (see [Local Setup](developer-guide/local-setup.md)).

## What you need

- Node.js 20+
- pnpm 9+
- Git
- The [Freighter](https://www.freighter.app/) browser extension
- A Stellar Testnet account funded with Testnet XLM
- Optional, for the contract call: the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
  (`stellar`)

## 1. Get the code and install dependencies

```bash
git clone https://github.com/Stellar-Clear/clearledger.git
cd clearledger
pnpm install
pnpm --filter @clearledger/sdk build
```

The web app imports the workspace SDK package `@clearledger/sdk`, whose entry
point is `packages/sdk/dist/index.js`. Build the SDK once after a fresh install so
that `pnpm dev` can resolve it.

## 2. Configure the Testnet environment

From the repository root:

```bash
cp .env.example .env.local
```

The root `.env.example` already contains the Testnet network settings and the
current contract IDs. No contract deployment or ID changes are needed. Confirm
the critical values:

```bash
grep -E '^NEXT_PUBLIC_(STELLAR_NETWORK|HORIZON_URL|SOROBAN_RPC_URL|NETWORK_PASSPHRASE|REGISTRY_CONTRACT_ID|INVOICE_CONTRACT_ID|POOL_CONTRACT_ID|ESCROW_CONTRACT_ID)=' .env.local
```

You should see:

```text
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=CCGHK4XJA23BVPTADPCOUV76G2KYAAAKQIKPF35FN5RFP2TT47TXWQNT
NEXT_PUBLIC_INVOICE_CONTRACT_ID=CCZN4GM5O7D6RGI4P4FCKIB5HMRKDWOWY7M3YZ637XZFCGM7SXGIVAZ6
NEXT_PUBLIC_POOL_CONTRACT_ID=CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45
NEXT_PUBLIC_ESCROW_CONTRACT_ID=CC3EDR7B64Y5KZEJETATNVUWYGPHGUAR2V2QYTUCDOZJMYY3XEVAIGQB
```

`apps/web/next.config.mjs` loads the root `.env.local`, so this single file
configures the Next.js app. For a web-only alternative, see
[`apps/web/.env.example`](../apps/web/.env.example). For every variable and which
process reads it, see [Environment Variables](developer-guide/environment-variables.md).

### Current Testnet contracts

These are the addresses in the checked-in templates and are the ones this guide
uses:

| Contract          | Testnet address                                            |
| ----------------- | ---------------------------------------------------------- |
| registry_contract | `CCGHK4XJA23BVPTADPCOUV76G2KYAAAKQIKPF35FN5RFP2TT47TXWQNT` |
| invoice_contract  | `CCZN4GM5O7D6RGI4P4FCKIB5HMRKDWOWY7M3YZ637XZFCGM7SXGIVAZ6` |
| pool_contract     | `CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45` |
| escrow_contract   | `CC3EDR7B64Y5KZEJETATNVUWYGPHGUAR2V2QYTUCDOZJMYY3XEVAIGQB` |

Contract source and deployment tooling live in the companion
[`clearledger-contracts`](https://github.com/Stellar-Clear/clearledger-contracts)
repository. See [Smart Contracts Overview](smart-contracts/overview.md) for how
the four contracts call each other.

## 3. Start the web app

From the repository root:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app starts without
PostgreSQL or the indexer. Until the indexer is running, API-backed lists and
protocol statistics may show empty or unavailable data; that is expected for this
web-only path and does not affect wallet connection or the read-only Soroban call
below.

For the complete web app, indexer and PostgreSQL stack, follow
[Local Setup](developer-guide/local-setup.md#full-local-stack-with-docker-compose).

## 4. Connect Freighter on Testnet

1. Install [Freighter](https://www.freighter.app/) and create or import an
   account. Keep the recovery phrase private; never paste it into this repository
   or an environment file.
2. In Freighter, switch the network to **Testnet** before connecting.
3. Fund the account with Testnet XLM. Use the [Stellar Friendbot](https://friendbot.stellar.org)
   or the command below with your public key.
4. Return to `http://localhost:3000` and click **CONNECT WALLET** in the top
   navigation.
5. Approve the Freighter connection request. The app shows a **Testnet** badge and
   your truncated address; use the copy icon to copy the full public key.

Fund the account:

```bash
export TESTNET_ACCOUNT="G..."
curl -sS "https://friendbot.stellar.org?addr=${TESTNET_ACCOUNT}"
```

Replace `G...` with the full address copied from the app or Freighter. Keep the
quotes so the shell treats the whole public key as one value. The wallet address must exist on Testnet
before a Soroban read simulation can look up its account sequence number.

The app validates the Freighter network during connection. If Freighter is on
another network, the connection is rejected with a wrong-network message. Switch
Freighter to Testnet and connect again.

## 5. Make one read-only Soroban call

This call reads the pool contract's public statistics. It uses
`get_stats` on the current Testnet pool contract
`CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45`.

If `stellar` is not installed, install it using the official
[Stellar CLI instructions](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli),
then check it is available:

```bash
stellar --version
```

Run the call with the same Testnet public key you used above:

```bash
export TESTNET_ACCOUNT="G..."
stellar contract invoke \
  --id CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45 \
  --network testnet \
  --source-account "$TESTNET_ACCOUNT" \
  --send=no \
  -- get_stats
```

`--send=no` simulates the call and returns the result without signing or
submitting a transaction. It creates no ledger writes and requires no secret key;
the public key is only used to look up the source account.

**Expected result:** a `PoolStats` JSON object. On the current deployment at the
time of writing, the command returns:

```json
{"active_invoice_count":0,"available_liquidity":"0","max_utilization_bps":8500,"total_deposits":"0","total_funded":"0","total_loss_realised":"0","total_shares":"0","total_yield_distributed":"0","utilization_rate_bps":0}
```

The exact numbers depend on current Testnet pool activity, so your `total_deposits`,
`total_funded` and related values may differ. A successful call should still
return the same fields: `active_invoice_count`, `available_liquidity`,
`max_utilization_bps`, `total_deposits`, `total_funded`, `total_loss_realised`,
`total_shares`, `total_yield_distributed` and `utilization_rate_bps`.

If you get that object, the Testnet RPC, the current pool contract ID and the
`get_stats` function are all working. You have completed one end-to-end read-only
Soroban call.

To inspect the same contract in a browser, open the
[pool contract on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45).

## Troubleshooting

- **`Contract ID is required` or missing environment variables:** make sure
  `.env.local` is at the repository root (not only in `apps/web`) and restart
  `pnpm dev` after changing it.
- **`Cannot find module '@clearledger/sdk'`:** run
  `pnpm --filter @clearledger/sdk build` again, then restart the dev server.
- **Wrong-network error in the app:** switch Freighter to **Testnet**, then
  reconnect. The app deliberately rejects other networks.
- **Friendbot fails or the CLI reports the account is missing:** check the public
  key is a valid `G...` Testnet address, request funding again, and wait a few
  seconds for the ledger to close.
- **Soroban RPC timeout:** retry the command. Public Testnet RPC endpoints can be
  rate-limited or temporarily slow.
- **Unexpected contract result:** confirm the pool contract ID is
  `CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45` and that
  `NEXT_PUBLIC_STELLAR_NETWORK=testnet`.

## Next steps

- [Local Setup](developer-guide/local-setup.md)
- [Environment Variables](developer-guide/environment-variables.md)
- [Smart Contracts Overview](smart-contracts/overview.md)
- [Architecture](ARCHITECTURE.md)
- [Security Policy](../SECURITY.md)
- [Documentation index](README.md)
