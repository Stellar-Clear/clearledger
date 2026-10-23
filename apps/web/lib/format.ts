/**
 * Truncates a blockchain address for display, showing the first 6 and last 4 characters.
 *
 * @param addr - The full address string to truncate.
 * @returns The truncated address with ellipsis, or an empty string if the input is falsy.
 *
 * @example
 * ```ts
 * truncateAddress("GBBD47IF6LZ72Y..."); // "GBBD47...Y..."
 * ```
 */
export function truncateAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Formats a Unix timestamp in seconds as a date, for display only. Uses the
 * browser locale unless `locale` is given.
 *
 * @example
 * ```ts
 * formatDate(1_700_000_000); // "Nov 14, 2023"
 * ```
 */
export function formatDate(unixSeconds: number, locale?: string): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a Unix timestamp in seconds as a date and time, for display only.
 * Uses the browser locale unless `locale` is given.
 *
 * @example
 * ```ts
 * formatDateTime(1_700_000_000); // "Nov 14, 2023, 10:13 PM" (depends on time zone)
 * ```
 */
export function formatDateTime(unixSeconds: number, locale?: string): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats basis points as a percentage string, for display only. Contract
 * calls keep the integer basis points; never send the formatted string.
 *
 * @example
 * ```ts
 * formatBps(1250, 2); // "12.50%"
 * ```
 */
export function formatBps(bps: number, fractionDigits = 2): string {
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}
