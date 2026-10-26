# pool_contract

USDC liquidity pool with share-based LP accounting. The share price grows as
invoices repay with yield.

### initialize

```rust
initialize(env: Env, admin: Address)
```

Sets the admin address. Can only be called once. Panics if called again.
SDK: `PoolClient.initialize(adminAddress, signerPublicKey)` —
`packages/sdk/src/clients/pool.ts`.

### deposit

```rust
deposit(env: Env, lp: Address, usdc_amount: u128) -> u128
```

Transfers `usdc_amount` USDC from `lp` to the pool and issues shares.
Returns the number of shares issued. `lp.require_auth()` is enforced.

### withdraw

```rust
withdraw(env: Env, lp: Address, shares: u128) -> u128
```

Burns `shares` and transfers the corresponding USDC value back to `lp`.
Returns the USDC amount transferred. Panics if available liquidity is insufficient.

### fund_invoice

```rust
fund_invoice(env: Env, invoice_id: BytesN<32>) -> bool
```

Funds a `Listed` invoice. Calculates `funded_amount`, calls `escrow_contract.lock()`,
calls `escrow_contract.release_to_issuer()`, and calls `invoice_contract.mark_funded()`.
All in one transaction.

### receive_repayment

```rust
receive_repayment(env: Env, invoice_id: BytesN<32>, amount: u128) -> bool
```

Called only by `invoice_contract` during repayment. Records the repayment,
calculates yield, and increases total pool deposits (which raises share price).

### handle_default

```rust
handle_default(env: Env, invoice_id: BytesN<32>) -> bool
```

Called by `invoice_contract` on default. Calls `escrow_contract.handle_default()`
to recover funds — but escrow holds nothing for a funded invoice (the funded
amount was already released to the issuer inside `fund_invoice`), so in practice
nothing is recovered. Reduces total deposits by the funded amount: the pool takes
a principal loss of up to the full funded amount, shared across all LP shares.

### get_stats

```rust
get_stats(env: Env) -> PoolStats
```

Returns current pool statistics. Read-only, no auth required.

```rust
PoolStats {
  total_deposits: u128,
  total_funded: u128,
  available_liquidity: u128,
  utilization_rate_bps: u32,
  total_yield_distributed: u128,
  active_invoice_count: u32,
  total_shares: u128,
}
```

### get_config_v1

```rust
get_config_v1(env: Env) -> PoolConfigV1
```

Returns the versioned pool configuration without authorization and remains
available while paused. Its `paused` field reports the emergency circuit-breaker
state. The web app reads this flag through `PoolClient.getPauseState()` and
disables LP writes until the state is confirmed.

### get_utilization_rate

```rust
get_utilization_rate(env: Env) -> u32
```

Returns the current pool utilization rate in basis points (`total_funded / total_deposits × 10_000`).
Read-only, no auth required. Returns `0` when `total_deposits` is zero. Panics with
`Overflow` if scaling `total_funded` into basis points would overflow.

### get_lp_position

```rust
get_lp_position(env: Env, lp: Address) -> LPPosition
```

Returns the current position for a given LP address. Returns a zero-value
`LPPosition` if the address has no shares — does not panic.

```rust
LPPosition {
  shares: u128,
  usdc_value: u128,
  yield_earned: u128,
  deposit_count: u32,
}
```
