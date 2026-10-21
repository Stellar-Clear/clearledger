"use client";

import React, { useState } from "react";
import {
  ExternalLink,
  CheckCircle,
  XCircle,
  Copy,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTxHistory, isRateLimitError } from "@/hooks/useTxHistory";
import { SkeletonShimmer } from "./SkeletonLoader";

interface TxHistoryProps {
  address: string;
  poolOnly?: boolean;
}

function TxRowSkeleton() {
  return (
    <div className="flex justify-between items-center bg-slate-950/45 border border-slate-900 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <SkeletonShimmer className="w-5 h-5 rounded-full" />
        <div className="space-y-1.5">
          <SkeletonShimmer className="h-3.5 w-28" />
          <SkeletonShimmer className="h-3 w-20" />
        </div>
      </div>
      <div className="text-right space-y-1.5">
        <SkeletonShimmer className="h-3.5 w-16 ml-auto" />
        <SkeletonShimmer className="h-3 w-24 ml-auto" />
      </div>
    </div>
  );
}

export function TxHistory({ address, poolOnly = false }: TxHistoryProps) {
  const {
    transactions,
    isLoading,
    error,
    hasNext,
    hasPrev,
    goNext,
    goPrev,
    page,
    refetch,
  } = useTxHistory(address);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const visibleTransactions = poolOnly
    ? transactions.filter(
        (tx) => tx.type === "Pool Deposit" || tx.type === "Pool Withdraw",
      )
    : transactions;

  const handleCopy = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    } catch {
      // fallback
    }
  };

  const getStellarExpertUrl = (hash: string) => {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Transaction History</h3>
        {page > 1 && (
          <span className="text-xs text-slate-500 font-mono">Page {page}</span>
        )}
      </div>

      {error && (
        <div className="text-center py-6">
          <p className="text-rose-400 text-sm mb-2">
            {isRateLimitError(error)
              ? "Horizon is rate limiting this request. Please wait a moment."
              : "Failed to load transactions"}
          </p>
          <button
            onClick={() => refetch()}
            className="text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Try again
          </button>
        </div>
      )}

      {!error && isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <TxRowSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && !isLoading && visibleTransactions.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-6">
          {poolOnly
            ? "No pool deposits or withdrawals found for this wallet on this page."
            : "No ClearLedger transactions found for this wallet."}
        </p>
      )}

      {!error && !isLoading && visibleTransactions.length > 0 && (
        <>
          <div className="space-y-3">
            {visibleTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex justify-between items-center bg-slate-950/45 border border-slate-900 rounded-xl p-4 transition-all hover:bg-slate-900/60"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {tx.status === "success" ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="font-semibold text-white text-sm block truncate">
                      {tx.type}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(tx.timestamp * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {tx.amount && (
                    <span className="text-sm font-bold text-white block">
                      {tx.amount} {tx.token || "USDC"}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 justify-end mt-1">
                    <button
                      onClick={() => handleCopy(tx.hash)}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      title="Copy transaction hash"
                    >
                      {copiedHash === tx.hash ? (
                        <span className="text-emerald-400 text-[10px] font-mono">
                          Copied!
                        </span>
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <a
                      href={getStellarExpertUrl(tx.hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-mono"
                    >
                      {tx.hash.slice(0, 6)}...{tx.hash.slice(-4)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-800/60">
            <button
              onClick={goPrev}
              disabled={!hasPrev}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 hover:text-white hover:bg-slate-800/60"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <span className="text-xs text-slate-500 font-mono">
              Page {page}
            </span>
            <button
              onClick={goNext}
              disabled={!hasNext}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 hover:text-white hover:bg-slate-800/60"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
