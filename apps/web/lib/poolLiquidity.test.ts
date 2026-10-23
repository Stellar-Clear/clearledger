import { describe, expect, it } from "vitest";
import { explainPoolLiquidity } from "./poolLiquidity";

describe("explainPoolLiquidity", () => {
  it("reports unallocated liquidity as withdrawable when some is free", () => {
    expect(explainPoolLiquidity({ totalDeposits: 1_000n, totalFunded: 400n, availableLiquidity: 600n })).toEqual({
      deposits: 1_000n,
      committed: 400n,
      available: 600n,
      state: "available",
    });
  });

  it("reports fully committed when deposits exist but none is free", () => {
    expect(explainPoolLiquidity({ totalDeposits: 1_000n, totalFunded: 1_000n, availableLiquidity: 0n }).state).toBe(
      "fully-committed",
    );
  });

  it("reports an empty pool when there are no deposits", () => {
    expect(explainPoolLiquidity({ totalDeposits: 0n, totalFunded: 0n, availableLiquidity: 0n }).state).toBe("empty");
  });

  it("treats missing stats as an empty pool", () => {
    expect(explainPoolLiquidity({})).toEqual({ deposits: 0n, committed: 0n, available: 0n, state: "empty" });
  });

  it("clamps negative values to zero", () => {
    expect(explainPoolLiquidity({ totalDeposits: -5n, totalFunded: -1n, availableLiquidity: -2n }).state).toBe("empty");
  });
});
