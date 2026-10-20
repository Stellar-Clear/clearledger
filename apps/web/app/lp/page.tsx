"use client";

import React, { useEffect, useMemo, useState } from "react";
import { PageLayout } from "@/components/shared/PageLayout";
import { WalletConnect } from "@/components/shared/WalletConnect";
import { SimulationPreview } from "@/components/shared/SimulationPreview";
import {
  LPPositionCardSkeleton,
  PoolStatsPanelSkeleton,
} from "@/components/shared/SkeletonLoader";
import { usePool } from "@/hooks/usePool";
import { useWalletStore } from "@/store/wallet";
import { useConfirmDialogStore } from "@/store/confirmDialog";
import { PoolClient, type SimulationResult } from "@clearledger/sdk";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { formatAmount } from "@/lib/assets";
import { useInvoiceList } from "@/hooks/useInvoices";

const poolContractID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID || "";
const STROOPS_PER_UNIT = 10_000_000;

type StatsWithSharePrice = {
  totalDeposits?: bigint;
  availableLiquidity?: bigint;
  totalFunded?: bigint;
  totalYieldDistributed?: bigint;
  activeInvoiceCount?: number;
  utilizationRateBps?: number;
  sharePrice?: bigint | number | string;
};

function formatSharePrice(
  value: bigint | number | string | undefined,
): number | null {
  if (value === undefined) return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return typeof value === "bigint" || numericValue >= STROOPS_PER_UNIT
    ? numericValue / STROOPS_PER_UNIT
    : numericValue;
}

function formatShareValue(value: bigint | undefined): string {
  return formatAmount(value ?? 0n);
}

export default function LPDashboard() {
  const connected = useWalletStore((s) => s.connected);
  const address = useWalletStore((s) => s.address);
  const {
    deposit,
    withdraw,
    isDepositing,
    isWithdrawing,
    stats,
    isStatsLoading,
    position,
    isPositionLoading,
  } = usePool();
  const requestConfirmation = useConfirmDialogStore((state) => state.request);
  const {
    invoices: invoiceSnapshot,
    total: invoiceSnapshotTotal,
    isLoading: isInvoiceSnapshotLoading,
  } = useInvoiceList({ page: 1, limit: 100 });
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [simDetails, setSimDetails] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    const amount = Number(depositAmount);
    if (!address || !Number.isFinite(amount) || amount <= 0) {
      setSimDetails(null);
      setSimError(null);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setIsSimulating(true);
      setSimError(null);
      try {
        const amountStroops = BigInt(Math.floor(amount * STROOPS_PER_UNIT));
        const client = new PoolClient(poolContractID);
        const result = await client.simulateTransaction(
          "deposit",
          [
            new Address(address).toScVal(),
            nativeToScVal(amountStroops, { type: "u128" }),
          ],
          address,
        );
        if (active) setSimDetails(result);
      } catch (error) {
        if (active) {
          setSimError(
            error instanceof Error ? error.message : "Simulation failed",
          );
        }
      } finally {
        if (active) setIsSimulating(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [address, depositAmount]);

  if (!connected) {
    return (
      <PageLayout>
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6">
          <h1 className="text-2xl font-bold text-white">Connect Your Wallet</h1>
          <WalletConnect />
        </div>
      </PageLayout>
    );
  }

  const handleDeposit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    await deposit({
      amount: BigInt(Math.floor(amount * STROOPS_PER_UNIT)),
      asset: "USDC",
    });
    setDepositAmount("");
  };

  const handleWithdraw = (event: React.FormEvent) => {
    event.preventDefault();
    const shares = Number(withdrawShares);
    if (!Number.isFinite(shares) || shares <= 0) return;

    const shareAmount = BigInt(Math.floor(shares * STROOPS_PER_UNIT));
    requestConfirmation({
      label: "Withdraw LP liquidity",
      invoiceId: address || "LP position",
      fn: async () => {
        await withdraw({ shares: shareAmount });
        setWithdrawShares("");
      },
    });
  };

  const typedStats: StatsWithSharePrice | undefined = stats;
  const utilization = Math.min(
    100,
    Math.max(0, (typedStats?.utilizationRateBps ?? 0) / 100),
  );
  const sharePrice = formatSharePrice(typedStats?.sharePrice);
  const activeInvoiceSnapshot = useMemo(
    () =>
      invoiceSnapshot.filter((invoice) =>
        ["Funded", "Active", "Confirmed"].includes(invoice.status),
      ),
    [invoiceSnapshot],
  );
  const indexedCommitted = activeInvoiceSnapshot.reduce(
    (total, invoice) => total + invoice.fundedAmount,
    0n,
  );
  const snapshotComplete = invoiceSnapshotTotal <= invoiceSnapshot.length;
  const poolSnapshotMatches =
    typedStats &&
    snapshotComplete &&
    activeInvoiceSnapshot.length === typedStats.activeInvoiceCount &&
    indexedCommitted === typedStats.totalFunded;

  return (
    <PageLayout>
      <div className="mx-auto max-w-5xl space-y-6 py-4">
        <div>
          <h1 className="text-xl font-bold uppercase text-white">
            Liquidity Provider Portal
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Supply USDC liquidity, track pool performance, and manage your
            position.
          </p>
        </div>

        <section aria-labelledby="pool-overview-heading" className="space-y-3">
          <h2
            id="pool-overview-heading"
            className="text-sm font-bold uppercase tracking-wider text-white"
          >
            Pool Overview
          </h2>
          {isStatsLoading ? (
            <PoolStatsPanelSkeleton />
          ) : (
            <div className="bg-card border border-border rounded-lg p-6 flex flex-col md:flex-row items-center gap-8">
              <div
                className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-full border-[8px] border-slate-900"
                style={{
                  background: `conic-gradient(#00d4aa ${utilization}%, #17212b ${utilization}% 100%)`,
                }}
              >
                <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-card">
                  <span className="text-2xl font-bold text-white">
                    {utilization.toFixed(1)}%
                  </span>
                  <span className="text-[10px] uppercase text-slate-500">
                    Utilization
                  </span>
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-6">
                <Stat
                  label="Total Deposits"
                  value={formatShareValue(typedStats?.totalDeposits)}
                />
                <Stat
                  label="Available Liquidity"
                  value={formatShareValue(typedStats?.availableLiquidity)}
                />
                <Stat
                  label="Yield Distributed"
                  value={formatShareValue(typedStats?.totalYieldDistributed)}
                />
                <Stat
                  label="Active Invoices"
                  value={String(typedStats?.activeInvoiceCount ?? 0)}
                />
                {sharePrice !== null && (
                  <Stat
                    label="Share Price"
                    value={`${sharePrice.toFixed(4)} USDC`}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="commitments-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="commitments-heading"
              className="text-sm font-bold uppercase tracking-wider text-white"
            >
              Active Invoice Commitments
            </h2>
            <span className="text-[10px] text-slate-500">
              Indexer snapshot: {activeInvoiceSnapshot.length} of {invoiceSnapshotTotal} invoices
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-2 gap-4 border-b border-border/40 p-4 sm:grid-cols-3">
              <Stat
                label="Invoice funded amount"
                value={isInvoiceSnapshotLoading ? "Loading…" : formatShareValue(indexedCommitted)}
              />
              <Stat
                label="Pool locked amount"
                value={formatShareValue(typedStats?.totalFunded)}
              />
              <Stat
                label="Pool active invoice count"
                value={String(typedStats?.activeInvoiceCount ?? 0)}
              />
            </div>
            {!isInvoiceSnapshotLoading && !snapshotComplete && (
              <p className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                Reconciliation is partial: the indexer returned the first 100 of {invoiceSnapshotTotal} invoices.
              </p>
            )}
            {!isInvoiceSnapshotLoading && snapshotComplete && typedStats && !poolSnapshotMatches && (
              <p role="status" className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                The invoice index and pool totals do not match. Refresh the indexer snapshot before relying on these figures.
              </p>
            )}
            {activeInvoiceSnapshot.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">
                {isInvoiceSnapshotLoading ? "Loading invoice snapshot…" : "No funded or active invoices in the current indexer snapshot."}
              </p>
            ) : (
              <ul className="max-h-64 divide-y divide-border/30 overflow-y-auto">
                {activeInvoiceSnapshot.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
                    <a href={`/invoice/${invoice.id}`} className="truncate font-mono text-primary hover:underline">
                      {invoice.id.slice(0, 10)}…
                    </a>
                    <span className="text-slate-400">{invoice.status}</span>
                    <span className="shrink-0 font-mono text-white">
                      {formatShareValue(invoice.fundedAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="position-heading" className="space-y-3">
          <h2
            id="position-heading"
            className="text-sm font-bold uppercase tracking-wider text-white"
          >
            My Position
          </h2>
          {isPositionLoading ? (
            <LPPositionCardSkeleton />
          ) : (
            <div className="bg-[#0d131a] border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Active LP Position
                </span>
                <span className="text-[10px] text-slate-500">
                  {position?.depositCount ?? 0} deposits
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat
                  label="Current USDC Value"
                  value={formatShareValue(position?.usdcValue)}
                />
                <Stat
                  label="Redeemable Shares"
                  value={formatShareValue(position?.shares)}
                />
                <Stat
                  label="Accrued Yield"
                  value={formatShareValue(position?.yieldEarned)}
                />
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleDeposit}
            className="space-y-4 rounded-lg border border-border bg-card p-6"
          >
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">
              Deposit USDC
            </h2>
            <label
              htmlFor="deposit-amount"
              className="block text-sm text-slate-300"
            >
              Deposit amount
            </label>
            <input
              id="deposit-amount"
              type="number"
              min="0"
              step="any"
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              className="w-full rounded border border-border bg-slate-950 px-3 py-2 text-white"
            />
            <SimulationPreview
              details={simDetails}
              error={simError}
              isLoading={isSimulating}
            />
            <button
              type="submit"
              disabled={isDepositing}
              className="rounded bg-primary px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              {isDepositing ? "Depositing..." : "Deposit USDC"}
            </button>
          </form>

          <form
            onSubmit={handleWithdraw}
            className="space-y-4 rounded-lg border border-border bg-card p-6"
          >
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">
              Withdraw Liquidity
            </h2>
            <label
              htmlFor="withdraw-shares"
              className="block text-sm text-slate-300"
            >
              Shares to redeem
            </label>
            <input
              id="withdraw-shares"
              type="number"
              min="0"
              step="any"
              value={withdrawShares}
              onChange={(event) => setWithdrawShares(event.target.value)}
              className="w-full rounded border border-border bg-slate-950 px-3 py-2 text-white"
            />
            <p className="text-xs text-slate-500">
              Available: {formatShareValue(position?.shares)}
            </p>
            <button
              type="submit"
              disabled={isWithdrawing || !position?.shares}
              className="rounded border border-rose-500/60 px-4 py-2 font-semibold text-rose-300 disabled:opacity-50"
            >
              {isWithdrawing ? "Withdrawing..." : "Withdraw Shares"}
            </button>
          </form>
        </div>
      </div>
    </PageLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span className="block text-sm font-semibold text-white">{value}</span>
    </div>
  );
}
