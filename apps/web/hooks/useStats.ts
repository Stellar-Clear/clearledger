import { useQuery } from "@tanstack/react-query";
import { getProtocolStats, ProtocolStats } from "@/lib/api";

/**
 * Custom hook for fetching protocol statistics from the indexer.
 *
 * Provides protocol-wide statistics including registered issuers, total invoices,
 * and other metrics. All data is fetched from the /stats endpoint with caching
 * and automatic refetching.
 *
 * @returns An object containing:
 *   - `stats` — Protocol statistics, or `undefined` while loading.
 *   - `isLoading` — `true` while stats are being fetched.
 *   - `error` — Fetch error, or `null` if none.
 *   - `refetch` — Function to manually re-trigger the stats query.
 *
 * @example
 * const { stats, isLoading, error } = useStats();
 */
export function useStats() {
  const query = useQuery({
    queryKey: ["protocolStats"],
    queryFn: () => getProtocolStats(),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data fresh for 30 seconds
    retry: 3,
  });

  return {
    stats: query.data,
    isLoading: query.isLoading,
    error: query.error,
    updatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}
