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
import { PoolPerformanceChart } from "@/components/shared/PoolPerformanceChart";
import { useInvoiceList } from "@/hooks/useInvoices";
import { ExternalLink } from "lucide-react";
import { TxHistory } from "@/components/shared/TxHistory";
import { explainPoolLiquidity } from "@/lib/poolLiquidity";
import { LpYieldDisclosure } from "@/components/shared/LpYieldDisclosure";

const poolContractID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID || "";
const explorerNetwork = ["mainnet", "public"].includes(
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase(),
)
  ? "public"
  : "testnet";
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
  const amount = value ?? 0n;
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = (absolute / BigInt(STROOPS_PER_UNIT)).toString();
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % BigInt(STROOPS_PER_UNIT))
    .toString()
    .padStart(7, "0");
  return `${negative ? "-" : ""}${groupedWhole}.${fraction} USDC`;
}

function parseQuotedShares(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export default function LPDashboard() {
  const connected = useWalletStore((s) => s.connected);
  const address = useWalletStore((s) => s.address);
  const network = useWalletStore((s) => s.network);
  const friendbotUrl =
    network?.trim().toLowerCase() === "testnet" && address
      ? `https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`
      : null;
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
  const [withdrawSimDetails, setWithdrawSimDetails] =
    useState<SimulationResult | null>(null);
  const [withdrawSimError, setWithdrawSimError] = useState<string | null>(null);
  const [isWithdrawSimulating, setIsWithdrawSimulating] = useState(false);

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

  useEffect(() => {
    const shares = Number(withdrawShares);
    if (!address || !Number.isFinite(shares) || shares <= 0) {
      setWithdrawSimDetails(null);
      setWithdrawSimError(null);
      setIsWithdrawSimulating(false);
      return;
    }

    setWithdrawSimDetails(null);
    let active = true;
    const timer = setTimeout(async () => {
      setIsWithdrawSimulating(true);
      setWithdrawSimError(null);
      try {
        const shareStroops = BigInt(Math.floor(shares * STROOPS_PER_UNIT));
        const client = new PoolClient(poolContractID);
        const result = await client.simulateTransaction(
          "withdraw",
          [
            new Address(address).toScVal(),
            nativeToScVal(shareStroops, { type: "u128" }),
          ],
          address,
        );
        if (active) setWithdrawSimDetails(result);
      } catch (error) {
        if (active) {
          setWithdrawSimError(
            error instanceof Error ? error.message : "Simulation failed",
          );
        }
      } finally {
        if (active) setIsWithdrawSimulating(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [address, withdrawShares]);

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
    if (isWithdrawSimulating || withdrawSimError || !withdrawSimDetails) return;
    const shares = Number(withdrawShares);
    if (!Number.isFinite(shares) || shares <= 0) return;

    const shareAmount = BigInt(Math.floor(shares * STROOPS_PER_UNIT));
    requestConfirmation({
      label: "Withdraw LP liquidity",
      invoiceId: address || "LP position",
      contractId: poolContractID,
      asset: "USDC LP shares",
      amount: `${withdrawShares} shares`,
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
  const quotedShares = parseQuotedShares(simDetails?.expectedResult);
  const networkLabel =
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase() ===
    "mainnet"
      ? "Stellar Mainnet"
      : "Stellar Testnet";
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
  const enteredShares = Number(withdrawShares);
  const previewShares =
    Number.isFinite(enteredShares) && enteredShares > 0
      ? BigInt(Math.floor(enteredShares * STROOPS_PER_UNIT))
      : 0n;
  const estimatedPositionValue =
    position?.shares && previewShares > 0n
      ? (position.usdcValue * previewShares) / position.shares
      : 0n;
  const availableLiquidity = typedStats?.availableLiquidity ?? 0n;
  const estimatedWithdrawal =
    estimatedPositionValue < availableLiquidity
      ? estimatedPositionValue
      : availableLiquidity;
  const exceedsPosition = Boolean(
    position?.shares && previewShares > position.shares,
  );
  const exceedsLiquidity = estimatedPositionValue > availableLiquidity;
  const liquidity = explainPoolLiquidity(typedStats ?? {});
  const liquidityExplanation = {
    available: "Unallocated liquidity is USDC not yet funded into invoices. It is the most you can withdraw from the pool right now.",
    "fully-committed": "All deposited liquidity is committed to active invoices, so withdrawals are unavailable until those invoices are repaid.",
    empty: "The pool has no deposits yet, so there is nothing to withdraw.",
  }[liquidity.state];

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
              <div className="w-full md:max-w-xs">
                <LpYieldDisclosure />
              </div>
            </div>
          )}
        </section>

        <section aria-label="Historical LP utilization" className="space-y-2">
          <p className="text-xs text-slate-500">
            USDC pool · {networkLabel} · indexed pool snapshots
          </p>
          <PoolPerformanceChart title="LP Utilization History" />
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
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500">
                    {position?.depositCount ?? 0} deposits
                  </span>
                  {poolContractID && (
                    <a
                      href={`https://stellar.expert/explorer/${explorerNetwork}/contract/${poolContractID}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      aria-label="View LP share token contract on Stellar Expert"
                    >
                      Contract <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
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
              <LpYieldDisclosure />
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
            <LpYieldDisclosure />
            <aside className="rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
              <p className="font-semibold text-amber-200">Before depositing on Testnet</p>
              <p className="mt-1">
                Keep test XLM in your account for Soroban transaction fees and
                the account reserve. Use the Testnet Friendbot to fund this
                wallet with test XLM.
              </p>
              {friendbotUrl ? (
                <a
                  href={friendbotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-10 items-center rounded-md border border-amber-300/40 px-3 font-semibold text-amber-100 underline underline-offset-4 hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  Fund this wallet with Testnet XLM
                </a>
              ) : (
                <p className="mt-3">
                  Connect Freighter on Testnet to get a Friendbot link for your
                  public account address.
                </p>
              )}
              <p className="mt-3 font-semibold text-amber-100">
                Friendbot only needs your public account address. Never share or
                enter your secret key or recovery phrase.
              </p>
            </aside>
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
            {quotedShares !== null && (
              <p className="text-xs text-slate-300" aria-live="polite">
                Expected LP shares from contract simulation: {formatShareValue(quotedShares)}
              </p>
            )}
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
            <LpYieldDisclosure />
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
            <SimulationPreview
              details={withdrawSimDetails}
              error={withdrawSimError}
              isLoading={isWithdrawSimulating}
            />
            <div className="space-y-1 rounded border border-border/60 bg-slate-950/60 p-3 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Estimated USDC withdrawal</span>
                <span className="font-mono text-white">
                  {formatShareValue(estimatedWithdrawal)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Pool liquidity available</span>
                <span className="font-mono text-white">
                  {formatShareValue(availableLiquidity)}
                </span>
              </div>
              <div className="space-y-1 border-t border-border/40 pt-2 text-[10px] text-slate-400">
                <p>
                  Deposits {formatShareValue(liquidity.deposits)} USDC · Committed to active invoices{" "}
                  {formatShareValue(liquidity.committed)} USDC · Unallocated {formatShareValue(liquidity.available)} USDC
                </p>
                <p>{liquidityExplanation}</p>
              </div>
              <p className="pt-1 text-[10px] text-slate-500">
                Estimate uses the latest indexed position and pool snapshot; the confirmed amount may change.
              </p>
              {(exceedsPosition || exceedsLiquidity) && (
                <p role="alert" className="pt-1 text-[10px] text-amber-300">
                  {exceedsPosition
                    ? "Requested shares exceed your current position."
                    : "Requested withdrawal exceeds current pool liquidity."}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={
                isWithdrawing ||
                isWithdrawSimulating ||
                !!withdrawSimError ||
                !withdrawSimDetails ||
                !position?.shares ||
                previewShares <= 0n ||
                exceedsPosition ||
                exceedsLiquidity
              }
              className="rounded border border-rose-500/60 px-4 py-2 font-semibold text-rose-300 disabled:opacity-50"
            >
              {isWithdrawing ? "Withdrawing..." : "Withdraw Shares"}
            </button>
          </form>
        </div>
        {address && (
          <section aria-labelledby="lp-history-heading" className="space-y-2">
            <div>
              <h2
                id="lp-history-heading"
                className="text-sm font-bold uppercase tracking-wider text-white"
              >
                Deposit and Withdrawal History
              </h2>
              <p className="text-xs text-slate-500">
                Confirmed Stellar account transactions; recent ledger activity may take a moment to appear.
              </p>
            </div>
            <TxHistory address={address} poolOnly />
          </section>
        )}
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
