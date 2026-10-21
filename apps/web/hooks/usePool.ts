import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPoolStats, getLPPosition } from "@/lib/api";
import { PoolClient } from "@clearledger/sdk";
import { useWalletStore } from "@/store/wallet";
import { showSuccessToast } from "@/lib/toast";
import { createErrorHandler } from "@/lib/errors";
import { useTokenAllowance } from "./useTokenAllowance";
import { useAppError } from "./useAppError";
import type { AssetType } from "@/types";

const { handleMutationError } = createErrorHandler("usePool");

const poolContractID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID || "";

interface DepositArguments {
  amount: bigint;
  asset: AssetType;
}

/**
 * Custom hook for interacting with the ClearLedger liquidity pool contract.
 *
 * Provides pool statistics, the connected wallet's LP position, and mutations
 * for depositing and withdrawing liquidity. All on-chain mutations require a
 * connected wallet.
 */
export function usePool() {
  const queryClient = useQueryClient();
  const address = useWalletStore((s) => s.address);
  const { ensureAllowance } = useTokenAllowance();
  const { error: appError, handleError, clearError } = useAppError();

  const poolClient = useMemo(() => {
    try {
      return new PoolClient(poolContractID);
    } catch {
      return null;
    }
  }, []);

  const statsQuery = useQuery({
    queryKey: ["poolStats"],
    queryFn: () => getPoolStats(),
    refetchInterval: 45000,
    staleTime: 45000,
  });

  const positionQuery = useQuery({
    queryKey: ["lpPosition", address],
    queryFn: () => getLPPosition(address!),
    enabled: !!address,
  });

  const depositMutation = useMutation({
    mutationFn: async ({ amount, asset }: DepositArguments) => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      // Issued assets require an allowance. Native XLM does not.
      if (asset === "USDC") {
        await ensureAllowance(poolContractID, amount);
      }

      if (!poolClient) throw new Error("Pool client not available");
      return poolClient.deposit(address, amount, address);
    },
    onSuccess: (txHash: string) => {
      clearError();
      // PoolClient resolves only after Soroban RPC confirms transaction success.
      queryClient.invalidateQueries({ queryKey: ["poolStats"] });
      queryClient.invalidateQueries({ queryKey: ["lpPosition", address] });
      queryClient.invalidateQueries({ queryKey: ["recentEvents"] });
      queryClient.invalidateQueries({ queryKey: ["txHistory", address] });
      showSuccessToast("Deposit Complete", txHash);
    },
    onError: (error) => {
      handleMutationError(error, "Deposit Failed");
      handleError(error, "Deposit failed");
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async ({ shares }: { shares: bigint }) => {
      if (!address) {
        throw new Error("Wallet not connected");
      }
      if (!poolClient) throw new Error("Pool client not available");
      return poolClient.withdraw(address, shares, address);
    },
    onSuccess: (txHash: string) => {
      clearError();
      queryClient.invalidateQueries({ queryKey: ["poolStats"] });
      queryClient.invalidateQueries({ queryKey: ["lpPosition", address] });
      queryClient.invalidateQueries({ queryKey: ["recentEvents"] });
      queryClient.invalidateQueries({ queryKey: ["txHistory", address] });
      showSuccessToast("Withdrawal Complete", txHash);
    },
    onError: (error) => {
      handleMutationError(error, "Withdrawal Failed");
      handleError(error, "Withdrawal failed");
    },
  });

  return {
    stats: statsQuery.data,
    isStatsLoading: statsQuery.isLoading,
    statsError: statsQuery.error,
    refetchStats: statsQuery.refetch,

    position: positionQuery.data,
    isPositionLoading: positionQuery.isLoading,
    positionError: positionQuery.error,
    refetchPosition: positionQuery.refetch,

    deposit: depositMutation.mutateAsync,
    isDepositing: depositMutation.isPending,
    depositError: depositMutation.error,

    withdraw: withdrawMutation.mutateAsync,
    isWithdrawing: withdrawMutation.isPending,
    withdrawError: withdrawMutation.error,

    appError,
  };
}
