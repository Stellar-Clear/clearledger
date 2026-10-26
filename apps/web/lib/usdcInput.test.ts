import { describe, expect, it } from "vitest";
import { formatUsdcStroops, parseUsdcInput } from "./usdcInput";

describe("USDC locale input", () => {
  it.each([
    ["12.34", 123_400_000n],
    ["12,34", 123_400_000n],
    ["1.234,56", 12_345_600_000n],
    ["1,234.56", 12_345_600_000n],
    ["1 234,5678901", 12_345_678_901n],
    [".5", 5_000_000n],
    ["1,234,567", 12_345_670_000_000n],
  ])("parses %s exactly to stroops", (input, expected) => {
    expect(parseUsdcInput(input)).toBe(expected);
  });

  it.each(["", "1,2,3", "1.12345678", "1e3", "-1", "abc"]) (
    "rejects invalid amount %s",
    (input) => expect(parseUsdcInput(input)).toBeNull(),
  );

  it("formats normalized USDC without losing stroop precision", () => {
    expect(formatUsdcStroops(12_345_678_901n)).toBe("1,234.5678901");
  });
});
