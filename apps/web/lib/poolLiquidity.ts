/**
 * Explains why pool liquidity can be unavailable for withdrawal.
 *
 * Pool deposits are either unallocated (`availableLiquidity`, which can be
 * withdrawn now) or committed to active invoices (`totalFunded`, which is
 * locked until those invoices are repaid). All values are stroops.
 */

export type PoolLiquidityState = "available" | "fully-committed" | "empty";

export interface PoolLiquidityBreakdown {
  deposits: bigint;
  committed: bigint;
  available: bigint;
  state: PoolLiquidityState;
}

export interface PoolLiquidityStats {
  totalDeposits?: bigint;
  totalFunded?: bigint;
  availableLiquidity?: bigint;
}

function nonNegative(value: bigint | undefined): bigint {
  const amount = value ?? 0n;
  return amount < 0n ? 0n : amount;
}

/**
 * Derive the withdrawal state from the latest pool statistics.
 *
 * - `available`: unallocated liquidity exists and can be withdrawn now.
 * - `fully-committed`: deposits exist, but all of them fund active invoices.
 * - `empty`: the pool has no deposits.
 *
 * @example
 * ```ts
 * explainPoolLiquidity({ totalDeposits: 100n, totalFunded: 100n, availableLiquidity: 0n });
 * // { deposits: 100n, committed: 100n, available: 0n, state: "fully-committed" }
 * ```
 */
export function explainPoolLiquidity(stats: PoolLiquidityStats): PoolLiquidityBreakdown {
  const deposits = nonNegative(stats.totalDeposits);
  const committed = nonNegative(stats.totalFunded);
  const available = nonNegative(stats.availableLiquidity);

  let state: PoolLiquidityState;
  if (available > 0n) state = "available";
  else if (deposits > 0n) state = "fully-committed";
  else state = "empty";

  return { deposits, committed, available, state };
}
