/**
 * Unit tests for parsePoolStats — feat/sdk-poolstats-totalshares
 *
 * Tests that:
 *  1. totalShares is parsed correctly from a plain JS object (camelCase key)
 *  2. totalShares is parsed correctly from a Map with snake_case key
 *     (mirrors the output of scValToNative on a Soroban ScVal map)
 *  3. totalShares defaults to 0n when the field is absent (backward compat)
 *  4. The PoolStats TypeScript interface includes totalShares: bigint
 */

import { describe, it, expect } from "vitest";
import { parsePoolStats, parsePoolPauseState } from "./schemas.js";
import type { PoolStats } from "./index.js";

// Helper: build a minimal valid PoolStats plain object with all required fields.
function baseStats(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    total_deposits: 1_000_000n,
    total_funded: 500_000n,
    available_liquidity: 500_000n,
    utilization_rate_bps: 5000,
    total_yield_distributed: 10_000n,
    active_invoice_count: 3,
    ...overrides,
  };
}

describe("parsePoolStats — totalShares", () => {
  it("parses total_shares from a plain object (snake_case keys from scValToNative)", () => {
    const raw = baseStats({ total_shares: 250_000n });
    const result: PoolStats = parsePoolStats(raw);

    expect(typeof result.totalShares, "totalShares should be a bigint").toBe(
      "bigint",
    );
    expect(result.totalShares, "totalShares should equal the input value").toBe(
      250_000n,
    );
  });

  it("parses total_shares from a Map (scValToNative returns Map for Soroban struct)", () => {
    const map = new Map<string, unknown>([
      ["total_deposits", 1_000_000n],
      ["total_funded", 500_000n],
      ["available_liquidity", 500_000n],
      ["utilization_rate_bps", 5000],
      ["total_yield_distributed", 10_000n],
      ["active_invoice_count", 3],
      ["total_shares", 999_888n], // ← the field under test
    ]);

    const result: PoolStats = parsePoolStats(map);
    expect(
      result.totalShares,
      "totalShares should be correctly read from a Map with snake_case key",
    ).toBe(999_888n);
  });

  it("coerces numeric total_shares to bigint", () => {
    // Contract may return number for small values depending on SDK version.
    const raw = baseStats({ total_shares: 42 });
    const result: PoolStats = parsePoolStats(raw);

    expect(
      result.totalShares,
      "numeric total_shares should be coerced to bigint",
    ).toBe(42n);
  });

  it("coerces string total_shares to bigint", () => {
    const raw = baseStats({ total_shares: "123456789012345678901234567890" });
    const result: PoolStats = parsePoolStats(raw);

    expect(
      result.totalShares,
      "string total_shares should be coerced to bigint",
    ).toBe(123456789012345678901234567890n);
  });

  it("defaults totalShares to 0n when field is absent (backward compatibility)", () => {
    // Old contract responses without total_shares should still parse safely.
    const raw = baseStats(); // no total_shares key
    const result: PoolStats = parsePoolStats(raw);

    expect(
      result.totalShares,
      "absent total_shares should default to 0n via bigintSchema preprocess",
    ).toBe(0n);
  });

  it("parses all existing PoolStats fields alongside totalShares (no regression)", () => {
    const raw = baseStats({ total_shares: 777n });
    const result: PoolStats = parsePoolStats(raw);

    expect(result.totalDeposits).toBe(1_000_000n);
    expect(result.totalFunded).toBe(500_000n);
    expect(result.availableLiquidity).toBe(500_000n);
    expect(result.utilizationRateBps).toBe(5000);
    expect(result.totalYieldDistributed).toBe(10_000n);
    expect(result.activeInvoiceCount).toBe(3);
    expect(result.totalShares).toBe(777n);
  });

  it("TypeScript interface check — totalShares: bigint is assignable", () => {
    // Compile-time + runtime check: if `PoolStats` is missing `totalShares`,
    // the literal below fails TypeScript; the runtime assertion is a
    // belt-and-suspenders confirmation that the field is a bigint.
    const stats: PoolStats = {
      totalDeposits: 1_000_000n,
      totalFunded: 500_000n,
      availableLiquidity: 500_000n,
      utilizationRateBps: 5000,
      totalYieldDistributed: 10_000n,
      activeInvoiceCount: 3,
      totalShares: 250_000n, // ← must compile without error
    };
    expect(typeof stats.totalShares, "totalShares should be a bigint").toBe(
      "bigint",
    );
  });
});

describe("parsePoolPauseState", () => {
  it.each([true, false])("parses the contract pause flag %s", (paused) => {
    expect(parsePoolPauseState({ paused })).toBe(paused);
  });

  it("parses snake-case fields from a Soroban map", () => {
    expect(parsePoolPauseState(new Map([["paused", true]]))).toBe(true);
  });

  it("rejects a missing or malformed pause flag", () => {
    expect(() => parsePoolPauseState({})).toThrow(/boolean pause state/);
    expect(() => parsePoolPauseState({ paused: "true" })).toThrow(
      /boolean pause state/,
    );
  });
});
