import { describe, it, expect } from "vitest";
import { toUsdc, fromUsdc, MAX_STROOPS, STROOPS_PER_USDC } from "./amounts.js";

describe("toUsdc", () => {
  it('converts 1 USDC (10_000_000 stroops) to "1.00"', () => {
    expect(toUsdc(BigInt(10_000_000))).toBe("1.00");
  });

  it("converts 1000.50 USDC", () => {
    expect(toUsdc(BigInt(10_005_000_000))).toBe("1000.50");
  });

  it('converts zero stroops to "0.00"', () => {
    expect(toUsdc(0n)).toBe("0.00");
  });

  it("converts a small fractional amount", () => {
    // 0.01 USDC = 100_000 stroops
    expect(toUsdc(BigInt(100_000))).toBe("0.01");
  });

  it('converts 1 stroop to "0.00" (below display precision)', () => {
    expect(toUsdc(1n)).toBe("0.00");
  });

  it("handles large values", () => {
    // 1_000_000 USDC
    expect(toUsdc(BigInt(10_000_000_000_000))).toBe("1000000.00");
  });

  it("handles negative amounts", () => {
    expect(toUsdc(BigInt(-10_000_000))).toBe("-1.00");
  });

  it("handles negative fractional amounts", () => {
    expect(toUsdc(BigInt(-10_005_000_000))).toBe("-1000.50");
  });

  it("formats the maximum u128 stroop amount without losing precision", () => {
    expect(toUsdc(MAX_STROOPS)).toBe(
      `${MAX_STROOPS / BigInt(STROOPS_PER_USDC)}.${(MAX_STROOPS % BigInt(STROOPS_PER_USDC)).toString().padStart(7, "0").slice(0, 2)}`,
    );
  });

  it("rejects amounts outside the u128 range", () => {
    expect(() => toUsdc(MAX_STROOPS + 1n)).toThrow(RangeError);
  });

  it("rounds down sub-cent remainders", () => {
    // 0.009 USDC = 90_000 stroops → "0.00" (displayed as 0.00)
    expect(toUsdc(BigInt(90_000))).toBe("0.00");
    // 0.014 USDC = 140_000 stroops → "0.01"
    expect(toUsdc(BigInt(140_000))).toBe("0.01");
  });
});

describe("fromUsdc", () => {
  it('parses "1000.50" to 10_005_000_000 stroops', () => {
    expect(fromUsdc("1000.50")).toBe(BigInt(10_005_000_000));
  });

  it('parses "1" to 10_000_000 stroops', () => {
    expect(fromUsdc("1")).toBe(BigInt(10_000_000));
  });

  it('parses "0.01" to 100_000 stroops', () => {
    expect(fromUsdc("0.01")).toBe(BigInt(100_000));
  });

  it('parses "0" to 0n', () => {
    expect(fromUsdc("0")).toBe(0n);
  });

  it("parses an integer with no decimal point", () => {
    expect(fromUsdc("42")).toBe(BigInt(420_000_000));
  });

  it("truncates extra fractional digits beyond 7", () => {
    // "0.00000001" has 8 fractional digits; the 8th is truncated
    expect(fromUsdc("0.00000001")).toBe(0n);
    // "0.0000001" is exactly 1 stroop
    expect(fromUsdc("0.0000001")).toBe(1n);
  });

  it("pads fractional digits shorter than 7", () => {
    // "0.1" → 0.1000000 → 1_000_000
    expect(fromUsdc("0.1")).toBe(BigInt(1_000_000));
  });

  it("handles negative amounts", () => {
    expect(fromUsdc("-1000.50")).toBe(BigInt(-10_005_000_000));
  });

  it("handles whitespace around the input", () => {
    expect(fromUsdc("  42.00  ")).toBe(BigInt(420_000_000));
  });

  it("throws on invalid input", () => {
    expect(() => fromUsdc("abc")).toThrow("Invalid USDC amount");
    expect(() => fromUsdc("1.2.3")).toThrow("Invalid USDC amount");
    expect(() => fromUsdc("")).toThrow("Invalid USDC amount");
  });

  it("rejects a decimal whose integer value exceeds u128", () => {
    expect(() => fromUsdc("34028236692093846346337460743176821145")).toThrow(
      RangeError,
    );
  });
});

describe("round-trip consistency", () => {
  const cases: [bigint, string][] = [
    [0n, "0.00"],
    [100_000n, "0.01"],
    [10_000_000n, "1.00"],
    [10_005_000_000n, "1000.50"],
    [10_000_000_000_000n, "1000000.00"],
  ];

  it.each(cases)(
    "fromUsdc(toUsdc(%s)) preserves the stroop value for %s USDC",
    (stroops, _expected) => {
      const formatted = toUsdc(stroops);
      const roundTripped = fromUsdc(formatted);
      expect(roundTripped).toBe(stroops);
    },
  );
});
