"use client";

import React from "react";
import { useBalances } from "@/hooks/useBalances";
import { useWalletStore } from "@/store/wallet";

export function XlmFeeGuidance() {
  const connected = useWalletStore((state) => state.connected);
  const { balances, loading, error } = useBalances();

  let walletGuidance = "Connect a wallet to check its XLM balance.";
  if (connected) {
    if (loading) {
      walletGuidance = "Checking your connected wallet’s XLM balance…";
    } else if (error || balances.xlm === null) {
      walletGuidance = "XLM balance unavailable. Make sure your wallet has XLM before signing.";
    } else {
      const xlm = Number(balances.xlm);
      const formattedXlm = Number.isFinite(xlm)
        ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(xlm)
        : "unavailable";
      walletGuidance = xlm > 0
        ? `Connected wallet: ${formattedXlm} XLM. Keep XLM available for fees.`
        : "No XLM found in the connected wallet. Fund it with Testnet XLM before signing.";
    }
  }

  return (
    <div
      role="status"
      aria-label="XLM transaction fee guidance"
      className="border-b border-sky-500/20 bg-sky-500/5 px-4 py-2 text-sky-200"
    >
      <p className="mx-auto max-w-7xl text-xs leading-5">
        Stellar network and Soroban transaction fees are paid in XLM. {walletGuidance}
      </p>
    </div>
  );
}
