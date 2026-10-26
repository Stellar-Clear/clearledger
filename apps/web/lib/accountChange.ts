import { StrKey } from "@stellar/stellar-sdk";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Returns true only for a classic Stellar account public key (StrKey `G...`).
 * Secret seeds, contract IDs, muxed addresses, empty and non-string values are
 * rejected so a malformed wallet report can never become the active account.
 */
export function isValidAccountAddress(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}

function keyContains(node: unknown, address: string, depth = 0): boolean {
  if (node === address) return true;
  if (depth > 4 || node === null || typeof node !== "object") return false;
  return Object.values(node as Record<string, unknown>).some((child) =>
    keyContains(child, address, depth + 1),
  );
}

/** True when a react-query key is scoped to `address` (balances, positions, history, profile...). */
export function isScopedToAddress(queryKey: QueryKey, address: string): boolean {
  return keyContains(queryKey as unknown, address);
}

/**
 * Cancels and evicts every cached query scoped to the previous account.
 * Cancelling first stops in-flight requests from the old address; removing the
 * queries detaches them, so a late response can never land in state that now
 * belongs to the newly selected address.
 */
export async function clearAccountScopedQueries(
  queryClient: QueryClient,
  previousAddress: string,
): Promise<void> {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) =>
      isScopedToAddress(query.queryKey, previousAddress),
  };
  await queryClient.cancelQueries(filters);
  queryClient.removeQueries(filters);
}
