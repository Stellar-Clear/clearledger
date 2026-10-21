"use client";

import React from "react";
import { PageLayout } from "@/components/shared/PageLayout";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { PoolPerformanceChart } from "@/components/shared/PoolPerformanceChart";
import { SkeletonShimmer } from "@/components/shared/SkeletonLoader";
import { useStats } from "@/hooks/useStats";

export function formatCompactUsdc(value: string | undefined): string | null {
  if (value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `$${numeric.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  })}`;
}

function StatTile({
  label,
  value,
  isLoading,
  hasError,
  updatedAt,
}: {
  label: string;
  value: string | null;
  isLoading: boolean;
  hasError: boolean;
  updatedAt: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {isLoading ? (
        <SkeletonShimmer className="mt-2 h-7 w-24" />
      ) : hasError || value === null ? (
        <span className="mt-1 block font-mono text-2xl font-bold text-slate-600">
          —
        </span>
      ) : (
        <span className="mt-1 block font-mono text-2xl font-bold text-white">
          {value}
        </span>
      )}
      <span className="mt-2 block text-[10px] text-slate-500">
        Source: indexer statistics
        {updatedAt > 0 && ` · Updated ${new Date(updatedAt).toLocaleString()}`}
      </span>
    </div>
  );
}

/**
 * Public protocol analytics dashboard. Intentionally wallet-free: every
 * tile and the performance chart render from unauthenticated indexer
 * endpoints so visitors and LPs can inspect TVL, volume, and utilization
 * without connecting a wallet.
 */
export default function AnalyticsClient() {
  const { stats, isLoading, error, updatedAt } = useStats();
  const hasError = error != null;

  return (
    <PageLayout>
      <div className="mx-auto max-w-5xl space-y-6 py-4">
        <div>
          <h1 className="text-xl font-bold uppercase text-white">
            Protocol Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Total value locked, funding volume, and pool utilization across the
            ClearLedger protocol.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Figures reflect Stellar Testnet activity only.{" "}
            <a
              href="https://github.com/Stellar-Clear/clearledger/blob/main/docs/ANALYTICS_METRICS.md"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Read the metric definitions and on-chain sources
            </a>
            .
          </p>
        </div>

        <section aria-label="Protocol statistics" className="space-y-3">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Total USDC Financed"
              value={formatCompactUsdc(stats?.total_usdc_financed)}
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Pool Utilization"
              value={
                stats
                  ? `${(stats.pool_utilization_bps / 100).toFixed(1)}%`
                  : null
              }
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Average Yield"
              value={
                stats ? `${(stats.average_yield_bps / 100).toFixed(2)}%` : null
              }
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Registered Issuers"
              value={stats ? String(stats.registered_issuers) : null}
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Total Invoices"
              value={
                stats ? stats.total_invoices.toLocaleString("en-US") : null
              }
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Active Invoices"
              value={
                stats
                  ? stats.active_invoice_count.toLocaleString("en-US")
                  : null
              }
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Invoices Repaid"
              value={stats ? stats.total_repaid.toLocaleString("en-US") : null}
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
            <StatTile
              label="Invoices Defaulted"
              value={
                stats ? stats.total_defaulted.toLocaleString("en-US") : null
              }
              isLoading={isLoading}
              hasError={hasError}
              updatedAt={updatedAt}
            />
          </div>
          {hasError && (
            <p className="text-xs font-mono text-slate-500">
              Live stats are temporarily unavailable — showing placeholders.
            </p>
          )}
        </section>

        <ErrorBoundary context="PoolPerformanceChart">
          <PoolPerformanceChart />
        </ErrorBoundary>
      </div>
    </PageLayout>
  );
}
