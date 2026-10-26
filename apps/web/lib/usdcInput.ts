const STROOPS_PER_USDC = 10_000_000n;

/** Parse common decimal/grouping separators without converting through float. */
export function parseUsdcInput(input: string): bigint | null {
  let value = input.trim().replace(/[\s\u00a0\u202f'’]/g, "");
  if (!value || !/^\d[\d.,]*$|^[.,]\d[\d.,]*$/.test(value)) return null;

  const hasComma = value.includes(",");
  const hasPeriod = value.includes(".");
  let decimalSeparator: "." | "," | null = null;

  if (hasComma && hasPeriod) {
    decimalSeparator = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    const [whole, fraction, ...extra] = value.split(decimalSeparator);
    const validWhole = new RegExp(
      `^(?:\\d+|\\d{1,3}(?:\\${groupingSeparator}\\d{3})+)$`,
    );
    if (extra.length > 0 || !validWhole.test(whole) || !/^\d+$/.test(fraction)) {
      return null;
    }
    value = `${whole.replaceAll(groupingSeparator, "")}.${fraction}`;
  } else if (hasComma || hasPeriod) {
    const separator = hasComma ? "," : ".";
    const occurrences = value.split(separator).length - 1;
    if (occurrences === 1) {
      decimalSeparator = separator;
    } else {
      const groupingPattern = separator === "," ? /^\d{1,3}(?:,\d{3})+$/ : /^\d{1,3}(?:\.\d{3})+$/;
      if (!groupingPattern.test(value)) return null;
      value = value.replaceAll(separator, "");
    }
  }

  if (decimalSeparator) value = value.replace(decimalSeparator, ".");
  const [whole = "0", fraction = ""] = value.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > 7) {
    return null;
  }

  return BigInt(whole || "0") * STROOPS_PER_USDC + BigInt(fraction.padEnd(7, "0") || "0");
}

export function formatUsdcStroops(amount: bigint): string {
  const whole = amount / STROOPS_PER_USDC;
  const fraction = (amount % STROOPS_PER_USDC).toString().padStart(7, "0");
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${groupedWhole}.${trimmedFraction}` : groupedWhole;
}
