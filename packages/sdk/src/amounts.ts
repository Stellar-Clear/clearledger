/**
 * Number of stroops per whole USDC unit (10^7 = 1 USDC).
 *
 * Stellar on-chain amounts are u128 integers denominated in stroops.
 * All SDK financial methods accept and return `bigint` in stroops.
 */
export const STROOPS_PER_USDC = 10_000_000;
/** Maximum magnitude representable by Soroban's u128 amount fields. */
export const MAX_STROOPS = (1n << 128n) - 1n;

/**
 * Converts a stroop-denominated bigint to a human-readable USDC string
 * with exactly two decimal places.
 *
 * @param stroops - The amount in stroops (10^7 = 1 USDC).
 * @returns A formatted string, e.g. `"1.00"`, `"1000.50"`, `"0.01"`.
 *
 * @example
 * ```ts
 * toUsdc(BigInt(10_000_000)); // "1.00"
 * toUsdc(BigInt(10_005_000_000)); // "1000.50"
 * toUsdc(0n); // "0.00"
 * ```
 */
export function toUsdc(stroops: bigint): string {
  if (typeof stroops !== "bigint") {
    throw new TypeError("Stroop amounts must be bigint values");
  }
  if (stroops > MAX_STROOPS || stroops < -MAX_STROOPS) {
    throw new RangeError("Stroop amount exceeds the u128 range");
  }
  const whole = stroops / BigInt(STROOPS_PER_USDC);
  const fraction = stroops % BigInt(STROOPS_PER_USDC);

  // Absolute value for formatting; track sign separately.
  const negative = stroops < 0n;
  const absWhole = negative ? -whole : whole;
  const absFraction = negative ? -fraction : fraction;

  const fractionStr = absFraction.toString().padStart(7, "0").slice(0, 2);
  return `${negative ? "-" : ""}${absWhole.toString()}.${fractionStr}`;
}

/**
 * Parses a USDC decimal string into a stroop-denominated bigint.
 *
 * Accepts integers (`"100"`) and decimals with up to 7 fractional digits
 * (`"1000.50"`, `"0.0000001"`). Extra fractional digits beyond 7 are
 * truncated (not rounded).
 *
 * @param usdc - A decimal string, e.g. `"1000.50"`.
 * @returns The amount in stroops as a bigint.
 * @throws {Error} If the input is not a valid decimal number.
 *
 * @example
 * ```ts
 * fromUsdc("1000.50"); // 10005000000n
 * fromUsdc("1"); // 10000000n
 * fromUsdc("0.01"); // 100000n
 * ```
 */
export function fromUsdc(usdc: string): bigint {
  const trimmed = usdc.trim();

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount: "${usdc}"`);
  }

  const negative = trimmed.startsWith("-");
  const magnitude = negative ? trimmed.slice(1) : trimmed;

  const [intPart, fracPart = ""] = magnitude.split(".");
  // Pad or truncate fractional part to exactly 7 digits (stroops precision).
  const paddedFrac = fracPart.padEnd(7, "0").slice(0, 7);

  const stroops = BigInt(intPart + paddedFrac);
  if (stroops > MAX_STROOPS) {
    throw new RangeError("USDC amount exceeds the u128 range");
  }
  return negative ? -stroops : stroops;
}
