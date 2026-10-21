# SDK Reference

The TypeScript SDK in `packages/sdk` wraps all Soroban contract calls.
Import from `@clearledger/sdk` in the monorepo or use the workspace package.

## Runnable example

> A complete, runnable example lives at [`examples/sdk-quickstart/`](../../examples/sdk-quickstart/).
> It is a framework-free Node/TypeScript script that calls
> `RegistryClient.isVerified()`, `PoolClient.getStats()` and
> `InvoiceClient.getByStatus()` against Stellar testnet. From the repo root:
>
> ```bash
> pnpm --filter sdk-quickstart start
> ```

## Setup

```typescript
import { configureSDK } from "@clearledger/sdk";

configureSDK({
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractIds: {
    registry: process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID!,
    invoice: process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID!,
    pool: process.env.NEXT_PUBLIC_POOL_CONTRACT_ID!,
    escrow: process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID!,
  },
});
```

Then import the individual clients directly:

```typescript
import {
  RegistryClient,
  InvoiceClient,
  PoolClient,
  EscrowClient,
  TokenClient,
  AgentRegistryClient,
} from "@clearledger/sdk";

const registry = new RegistryClient(
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID!,
);
const invoice = new InvoiceClient(process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID!);
const pool = new PoolClient(process.env.NEXT_PUBLIC_POOL_CONTRACT_ID!);
const escrow = new EscrowClient(process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID!);
const usdc = TokenClient.forUSDC();
// AgentRegistryClient targets the external Underwrite agent-registry contract
// (deployed from the separate `underwrite-contract` repo), not ClearLedger's own
// issuer/buyer registry. Its contract ID comes from the Underwrite deployment.
const agents = new AgentRegistryClient(
  process.env.NEXT_PUBLIC_AGENT_REGISTRY_CONTRACT_ID!,
);
```

> **Note:** All write methods (`writeContract`) require a `signerPublicKey` argument — the Freighter wallet address that will sign the transaction. All read methods (`readContract`) also require it to build and simulate the transaction.

---

## Registry Client

```typescript
// Check if an address is verified
const verified = await registry.isVerified(publicKey, signerPublicKey);

// Get a full profile
const profile = await registry.getProfile(publicKey, signerPublicKey);
// profile.address, profile.role ("issuer" | "buyer"), profile.verified, profile.registeredAt

// Register as issuer (requires Freighter signature)
const txHash = await registry.registerIssuer(
  publicKey,
  { company: "Acme Ltd", country: "NG" },
  signerPublicKey,
);

// Register as buyer
await registry.registerBuyer(
  publicKey,
  { company: "Buyer Corp", country: "US" },
  signerPublicKey,
);

// Revoke an address (admin only)
await registry.revoke(publicKey, signerPublicKey);
```

---

## Agent Registry Client

`AgentRegistryClient` (`packages/sdk/src/clients/agentRegistry.ts`) reads from
Underwrite's external **agent-registry** contract (deployed from the separate
`underwrite-contract` repo) — not ClearLedger's own issuer/buyer `RegistryClient`.
This is the client to use when inspecting the Underwrite agent that attested an
invoice via `invoice_contract.submit_attestation`: the invoice's
`attestationAgentId` field gives you the `agentId` to look up here.

```typescript
import { AgentRegistryClient } from "@clearledger/sdk";

const agents = new AgentRegistryClient(
  process.env.NEXT_PUBLIC_AGENT_REGISTRY_CONTRACT_ID!,
);

// Look up the agent that attested an invoice
const agent = await agents.getAgent("agent_underwrite", signerPublicKey);
console.log(agent.active); // true — authorized to attest
```

The returned `Agent` object has the following shape:

```typescript
interface Agent {
  agentId: string; // on-chain Symbol identifier, e.g. "agent_underwrite"
  pubkey: string; // Stellar public key registered for this agent
  active: boolean; // whether the agent is currently authorized to attest
  registeredAt: number; // Unix timestamp (seconds) of registration
}
```

> **Note:** `getAgent` is a read-only (simulated) call with no on-chain side
> effects, and `AgentRegistryClient` exposes no `initialize` method. There is
> currently no `InvoiceClient` wrapper for `submit_attestation` (tracked in
> #815) — attestations are submitted directly against the contract.

---

## Invoice Client

```typescript
// Create an invoice
const txHash = await invoice.create(
  issuerPublicKey,
  buyerPublicKey,
  BigInt(10_000_000_000), // 1000 USDC in stroops
  Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60, // 60 days
  signerPublicKey,
);

// List for financing
await invoice.listForFinancing(invoiceIdHex, 200, signerPublicKey); // 200 bps = 2%

// Advance invoice lifecycle
await invoice.markShipped(invoiceIdHex, signerPublicKey);
await invoice.confirmDelivery(invoiceIdHex, confirmerAddress, signerPublicKey);
await invoice.repay(invoiceIdHex, signerPublicKey);
await invoice.triggerDefault(invoiceIdHex, signerPublicKey);

// Read invoices
const inv = await invoice.get(invoiceIdHex, signerPublicKey);
const byIssuer = await invoice.getByIssuer(issuerPublicKey, signerPublicKey);
const byBuyer = await invoice.getByBuyer(buyerPublicKey, signerPublicKey);
const listed = await invoice.getByStatus("Listed", signerPublicKey);
```

The returned `Invoice` object has the following shape:

```typescript
interface Invoice {
  id: string; // hex string of BytesN<32>
  issuer: string;
  buyer: string;
  faceValue: bigint; // in stroops
  asset: "USDC" | "XLM";
  discountBps: number;
  fundedAmount: bigint;
  dueDate: number; // Unix timestamp (seconds)
  status: InvoiceStatus; // "Created" | "Listed" | "Funded" | "Active" | "Confirmed" | "Repaid" | "Defaulted"
  createdAt: number;
  fundedAt: number | null;
  shippedAt: number | null;
  issuerConfirmed: boolean;
  buyerConfirmed: boolean;
  buyerConfirmedAt: number | null;
  repaidAt: number | null;
}
```

---

## Pool Client

```typescript
// Get pool stats
const stats = await pool.getStats(signerPublicKey);
// stats.availableLiquidity   — bigint, in stroops
// stats.totalDeposits        — bigint
// stats.totalFunded          — bigint
// stats.utilizationRateBps   — number
// stats.totalYieldDistributed — bigint
// stats.activeInvoiceCount   — number

// Get utilization rate as a standalone call
const rateBps = await pool.getUtilizationRate(signerPublicKey);

// Before deposit or any other pool/invoice operation that transfers USDC,
// ensure the target contract has sufficient token allowance (see Token Client below).
await usdc.allowance(
  lpPublicKey,
  process.env.NEXT_PUBLIC_POOL_CONTRACT_ID!,
  signerPublicKey,
);
await usdc.approve(
  lpPublicKey,
  process.env.NEXT_PUBLIC_POOL_CONTRACT_ID!,
  BigInt(1_000_000_000_000),
  expirationLedger,
  signerPublicKey,
);

// Deposit USDC (returns tx hash)
const txHash = await pool.deposit(
  lpPublicKey,
  BigInt(1_000_000_000_000),
  signerPublicKey,
);

// Withdraw by share amount
await pool.withdraw(lpPublicKey, shareAmount, signerPublicKey);

// Get LP position
const position = await pool.getLPPosition(lpPublicKey, signerPublicKey);
// position.shares        — bigint
// position.usdcValue     — bigint, current USDC value of shares
// position.yieldEarned   — bigint
// position.depositCount  — number

// Fund an invoice from pool liquidity
await pool.fundInvoice(invoiceIdHex, signerPublicKey);

// Record a repayment back into the pool
await pool.receiveRepayment(invoiceIdHex, repaymentAmount, signerPublicKey);
```

---

## Token Client

`TokenClient` wraps the USDC Stellar Asset Contract (SAC) allowance methods. USDC deposits and repayments call `transfer_from` through the pool or invoice contract, so the spender must be approved before the financial operation is submitted. The web app's `useTokenAllowance` hook performs this check automatically.

```typescript
import { TokenClient } from "@clearledger/sdk";

const usdc = TokenClient.forUSDC();
const allowance = await usdc.allowance(
  userPublicKey,
  spenderContractId,
  signerPublicKey,
);

if (allowance < amount) {
  const latestLedger = await server.getLatestLedger();
  await usdc.approve(
    userPublicKey,
    spenderContractId,
    amount,
    latestLedger.sequence + 535_680,
    signerPublicKey,
  );
}
```

- `TokenClient.forUSDC()` derives the configured USDC SAC contract ID.
- `allowance(from, spender, signerPublicKey)` reads the current allowance in stroops.
- `approve(from, spender, amount, expirationLedger, signerPublicKey)` submits the approval transaction.
- Use the pool contract as `spenderContractId` for deposits and the invoice contract for repayments. In the web app, see `useTokenAllowance` for the reusable implementation.

---

## Escrow Client

```typescript
// Lock USDC in escrow for an invoice
await escrow.lock(invoiceIdHex, amount, signerPublicKey);

// Release locked funds to the issuer (on successful delivery)
await escrow.releaseToIssuer(invoiceIdHex, signerPublicKey);

// Release funds back to the pool with repayment amount
await escrow.releaseToPool(invoiceIdHex, repaymentAmount, signerPublicKey);

// Handle a default event
await escrow.handleDefault(invoiceIdHex, signerPublicKey);

// Read currently locked amount
const locked = await escrow.getLocked(invoiceIdHex, signerPublicKey);
```

---

## Simulating Transactions

Every client inherits `simulateTransaction` from `BaseContractClient`. Use it to estimate fees and preview return values **without** submitting to the network. This is useful for building confirmation UIs or checking whether a call will succeed.

```typescript
import { nativeToScVal, xdr, Address } from "@stellar/stellar-sdk";

// Simulate a deposit to estimate fees before signing
const simulation = await pool.simulateTransaction(
  "deposit",
  [
    new Address(lpPublicKey).toScVal(),
    nativeToScVal(BigInt(1_000_000_000_000), { type: "u128" }),
  ],
  signerPublicKey,
);

console.log(simulation.functionName); // "deposit"
console.log(simulation.estimatedFeeXlm); // e.g. "0.0001234"
console.log(simulation.expectedResult); // parsed return value (if any)
console.log(simulation.footprintSize); // number of ledger entries touched
```

The return type is:

```typescript
{
  estimatedFeeXlm: string; // total fee (base + resource) in XLM
  functionName: string; // the method name you passed in
  expectedResult: any; // scValToNative() of the retval, or undefined
  footprintSize: number; // read-only + read-write ledger entry count
}
```

`simulateTransaction` throws if the simulation itself fails (e.g. bad arguments, insufficient liquidity), so you can catch errors early before asking the user to sign.

---

## Amount Formatting

All amounts in the SDK are `bigint` in stroops (1 USDC = 10,000,000 stroops). Use these helpers to convert:

```typescript
import { toUsdc, fromUsdc } from "@clearledger/sdk";

toUsdc(BigInt(10_000_000)); // → "1.00"
fromUsdc("1000.50"); // → BigInt(10005000000)
```

> Never pass `number` to amount arguments — JavaScript numbers cannot represent `u128` values accurately. Always use `BigInt`.

---

## Error Handling

Use `decodeSorobanError` to map known ClearLedger contract errors to stable SDK
codes while retaining the original response for diagnostics:

```ts
import { decodeSorobanError } from "@clearledger/sdk";

const decoded = decodeSorobanError(rawSorobanError);
if (decoded.code === "PROFILE_NOT_FOUND") {
  // Handle a missing registry profile.
}
console.debug(decoded.raw); // Original RPC error text is preserved.
```

Unknown contract errors return `code: null` and a generic message; inspect
`raw` when additional diagnostics are needed.

All SDK calls throw on failure. Failures surface as typed errors so consumers
can branch with `instanceof` instead of string-matching `err.message`:

```typescript
import {
  SimulationError,
  MissingReturnValueError,
  TransactionSendError,
  TransactionFailedError,
  TransactionTimeoutError,
} from "@clearledger/sdk";

try {
  const txHash = await invoice.create(...);
  console.log("Created:", txHash);
} catch (err) {
  if (err instanceof SimulationError) {
    // Soroban RPC rejected the simulation for err.method
    console.warn("Simulation failed:", err.method, err.cause);
  } else if (err instanceof MissingReturnValueError) {
    // Simulation succeeded but returned no value for err.method
    console.warn("No return value:", err.method);
  } else if (err instanceof TransactionSendError) {
    // Signed transaction was rejected at submission (err.sorobanError if set)
    console.warn("Send failed:", err.method, err.sorobanError);
  } else if (err instanceof TransactionFailedError) {
    // Transaction was accepted and confirmed as FAILED on-chain
    console.warn("Failed on-chain:", err.method);
  } else if (err instanceof TransactionTimeoutError) {
    // Transaction was sent but confirmation timed out
    console.warn("Timed out, tx hash:", err.txHash);
  } else {
    // Signing error, invalid input, or network error
    console.error(err.message);
  }
}
```

Every typed error records the contract method name it was raised for, and the
simulation- and send-related classes additionally carry the underlying Soroban
error where the RPC returned one. The SDK automatically retries transient
network errors up to 3 times with exponential backoff before throwing.
