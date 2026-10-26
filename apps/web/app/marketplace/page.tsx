"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/shared/PageLayout";
import { InvoiceTable } from "@/components/invoice/InvoiceTable";
import { InvoiceCard } from "@/components/invoice/InvoiceCard";
import { InvoiceCompareModal } from "@/components/invoice/InvoiceCompareModal";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useInvoiceList } from "@/hooks/useInvoices";
import { usePool } from "@/hooks/usePool";
import { useWalletStore } from "@/store/wallet";
import { useProfile } from "@/hooks/useProfile";
import { Invoice } from "@/types";
import { formatAmount } from "@/lib/assets";
import {
  sortInvoicesDeterministically,
  type InvoiceSortKey,
  type SortDirection,
} from "@/lib/invoiceSort";
import { downloadInvoicesCSV } from "@/lib/invoiceCsv";
import { getInvoices, getRecentEvents } from "@/lib/api";
import {
  DEFAULT_MARKETPLACE_FILTERS,
  filterInvoicesByDueDateAndAsset,
  parseMarketplaceUrl,
  type MarketplaceFilters,
} from "@/lib/marketplaceFilters";
import {
  ShieldAlert,
  RotateCcw,
  Save,
  Trash2,
  Menu,
  Download,
} from "lucide-react";

const MARKETPLACE_FILTERS_KEY = "clearledger:marketplace:filters";
const MARKETPLACE_PRESETS_KEY = "clearledger:marketplace:presets";

interface FilterPreset {
  name: string;
  filters: MarketplaceFilters;
  createdAt: number;
}

function readFiltersFromStorage(): MarketplaceFilters | null {
  try {
    const stored = window.localStorage.getItem(MARKETPLACE_FILTERS_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_MARKETPLACE_FILTERS,
      ...parsed,
    };
  } catch {
    return null;
  }
}

function writeFiltersToStorage(filters: MarketplaceFilters): void {
  try {
    window.localStorage.setItem(
      MARKETPLACE_FILTERS_KEY,
      JSON.stringify(filters),
    );
  } catch {
    // Storage disabled — in-memory state still applies for this session.
  }
}

function readPresetsFromStorage(address?: string): FilterPreset[] {
  try {
    const key = address
      ? `${MARKETPLACE_PRESETS_KEY}_${address}`
      : MARKETPLACE_PRESETS_KEY;
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePresetsToStorage(
  presets: FilterPreset[],
  address?: string,
): void {
  try {
    const key = address
      ? `${MARKETPLACE_PRESETS_KEY}_${address}`
      : MARKETPLACE_PRESETS_KEY;
    window.localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    // Storage disabled
  }
}

// User-facing strings live in `messages/en.json` under the "Marketplace"
// namespace; see docs/developer-guide/i18n.md for the migration pattern.
export default function Marketplace() {
  const t = useTranslations("Marketplace");
  const connected = useWalletStore((s) => s.connected);
  const address = useWalletStore((s) => s.address);
  const role = useWalletStore((s) => s.role);
  const { isVerified } = useProfile();
  const { stats, isStatsLoading } = usePool();
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceLimit, setInvoiceLimit] = useState(20);
  const indexerFreshness = useQuery({
    queryKey: ["marketplace", "indexer-freshness"],
    queryFn: () => getRecentEvents(1),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const [showPresetsDropdown, setShowPresetsDropdown] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState("");

  // URL values take precedence so filtered views can be shared and bookmarked.
  const [initialFilters] = useState(() =>
    parseMarketplaceUrl(
      typeof window === "undefined" ? "" : window.location.search,
      readFiltersFromStorage() ?? DEFAULT_MARKETPLACE_FILTERS,
    ),
  );
  const [statusFilter, setStatusFilter] = useState(initialFilters.statusFilter);
  const [minAmount, setMinAmount] = useState(initialFilters.minAmount);
  const [maxAmount, setMaxAmount] = useState(initialFilters.maxAmount);
  const [dueFrom, setDueFrom] = useState(initialFilters.dueFrom);
  const [dueTo, setDueTo] = useState(initialFilters.dueTo);
  const [assetFilter, setAssetFilter] = useState<MarketplaceFilters["asset"]>(
    initialFilters.asset,
  );
  const [sortKey, setSortKey] = useState<InvoiceSortKey>("faceValue");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [maxDiscount, setMaxDiscount] = useState(initialFilters.maxDiscount);

  // Keep local preferences and the shareable URL in sync.
  useEffect(() => {
    const filters = {
      statusFilter,
      minAmount,
      maxAmount,
      maxDiscount,
      dueFrom,
      dueTo,
      asset: assetFilter,
    };
    writeFiltersToStorage(filters);
    const url = new URL(window.location.href);
    const values: Record<string, string> = {
      status: statusFilter,
      dueFrom,
      dueTo,
      asset: assetFilter,
      minAmount,
      maxAmount,
      maxDiscount,
    };
    for (const [key, value] of Object.entries(values)) {
      if (
        !value ||
        (key === "status" && value === "Listed") ||
        (key === "asset" && value === "ALL") ||
        (key === "maxDiscount" && value === "500")
      ) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [
    statusFilter,
    minAmount,
    maxAmount,
    maxDiscount,
    dueFrom,
    dueTo,
    assetFilter,
  ]);

  const hasClientFilters = Boolean(
    minAmount ||
      maxAmount ||
      maxDiscount !== "500" ||
      dueFrom ||
      dueTo ||
      assetFilter !== "ALL",
  );

  const { invoices, isLoading, total, totalPages } = useInvoiceList({
    status: statusFilter === "ALL" ? undefined : statusFilter,
    page: hasClientFilters ? 1 : invoicePage,
    limit: hasClientFilters ? 100 : invoiceLimit,
  });
  const allMatchingInvoices = useQuery({
    queryKey: ["marketplace", "all-invoices", statusFilter],
    enabled: hasClientFilters,
    queryFn: async ({ signal }) => {
      const firstPage = await getInvoices(
        {
          status: statusFilter === "ALL" ? undefined : statusFilter,
          page: 1,
          limit: 100,
        },
        signal,
      );
      const results = [...firstPage.data];
      for (let start = 2; start <= firstPage.totalPages; start += 5) {
        const pages = Array.from(
          { length: Math.min(5, firstPage.totalPages - start + 1) },
          (_, index) => start + index,
        );
        const nextPages = await Promise.all(
          pages.map((page) =>
            getInvoices(
              {
                status: statusFilter === "ALL" ? undefined : statusFilter,
                page,
                limit: 100,
              },
              signal,
            ),
          ),
        );
        for (const page of nextPages) results.push(...page.data);
      }
      return results;
    },
    staleTime: 15_000,
  });

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const handleSelectInvoice = useCallback(
    (invoice: Invoice) => setSelectedInvoice(invoice),
    [],
  );

  useEffect(() => {
    setInvoicePage(1);
    setSelectedInvoice(null);
  }, [
    statusFilter,
    minAmount,
    maxAmount,
    maxDiscount,
    dueFrom,
    dueTo,
    assetFilter,
  ]);

  // Filter and Sort Invoices
  const filteredAndSortedInvoices = useMemo(() => {
    let result = filterInvoicesByDueDateAndAsset(
      hasClientFilters ? (allMatchingInvoices.data ?? []) : invoices,
      {
        dueFrom,
        dueTo,
        asset: assetFilter,
      },
    );

    // Filter by Min Amount
    if (minAmount) {
      const minStroops = BigInt(parseFloat(minAmount) * 10_000_000);
      result = result.filter((inv) => inv.faceValue >= minStroops);
    }

    // Filter by Max Amount
    if (maxAmount) {
      const maxStroops = BigInt(parseFloat(maxAmount) * 10_000_000);
      result = result.filter((inv) => inv.faceValue <= maxStroops);
    }

    // Filter by Max Discount Rate (bps)
    const discBps = parseInt(maxDiscount, 10);
    if (!isNaN(discBps)) {
      result = result.filter((inv) => inv.discountBps <= discBps);
    }

    return sortInvoicesDeterministically(result, sortKey, sortDir);
  }, [
    invoices,
    allMatchingInvoices.data,
    hasClientFilters,
    minAmount,
    maxAmount,
    maxDiscount,
    dueFrom,
    dueTo,
    assetFilter,
    sortKey,
    sortDir,
  ]);

  const pageInvoices = hasClientFilters
    ? filteredAndSortedInvoices.slice(
        (invoicePage - 1) * invoiceLimit,
        invoicePage * invoiceLimit,
      )
    : filteredAndSortedInvoices;
  const invoiceResultCount = hasClientFilters
    ? filteredAndSortedInvoices.length
    : total;
  const invoiceResultPages = hasClientFilters
    ? Math.max(1, Math.ceil(filteredAndSortedInvoices.length / invoiceLimit))
    : totalPages;
  const isInvoiceListLoading =
    isLoading || (hasClientFilters && allMatchingInvoices.isLoading);

  const handlePageChange = (page: number) => {
    setInvoicePage(page);
    setSelectedInvoice(null);
  };

  const handleLimitChange = (limit: number) => {
    setInvoiceLimit(limit);
    setInvoicePage(1);
    setSelectedInvoice(null);
  };

  // Multi-select state for comparison
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);

  // Presets state
  const [presets, setPresets] = useState<FilterPreset[]>(() =>
    readPresetsFromStorage(address ?? undefined),
  );

  // Persist presets to localStorage on change
  useEffect(() => {
    writePresetsToStorage(presets, address ?? undefined);
  }, [presets, address]);

  // Handle preset selection
  const applyPreset = (preset: FilterPreset) => {
    setStatusFilter(preset.filters.statusFilter);
    setMinAmount(preset.filters.minAmount);
    setMaxAmount(preset.filters.maxAmount);
    setMaxDiscount(preset.filters.maxDiscount);
    setDueFrom(preset.filters.dueFrom ?? "");
    setDueTo(preset.filters.dueTo ?? "");
    setAssetFilter(preset.filters.asset ?? "ALL");
    setShowPresetsDropdown(false);
  };

  // Save current filters as a preset
  const savePreset = () => {
    if (!newPresetName.trim()) return;
    if (presets.length >= 10) {
      alert("Maximum of 10 saved presets reached. Please delete one first.");
      return;
    }
    const newPreset: FilterPreset = {
      name: newPresetName.trim(),
      filters: {
        statusFilter,
        minAmount,
        maxAmount,
        maxDiscount,
        dueFrom,
        dueTo,
        asset: assetFilter,
      },
      createdAt: Date.now(),
    };
    setPresets([...presets, newPreset]);
    setNewPresetName("");
    setShowPresetsDropdown(false);
  };

  // Delete a preset
  const deletePreset = (id: string) => {
    setPresets(presets.filter((_, index) => index.toString() !== id));
    setShowPresetsDropdown(false);
  };

  // Start editing a preset name
  const startEditingPreset = (id: string, name: string) => {
    setEditingPresetId(id);
    setEditingPresetName(name);
  };

  // Save edited preset name
  const saveEditedPreset = (id: string) => {
    if (!editingPresetName.trim()) return;
    setPresets(
      presets.map((p, index) =>
        index.toString() === id ? { ...p, name: editingPresetName.trim() } : p,
      ),
    );
    setEditingPresetId(null);
    setEditingPresetName("");
  };

  // Calculate funded amount preview (face value - discount fee)
  const calculateFundingValue = (faceValue: bigint, discountBps: number) => {
    const value = Number(faceValue);
    const fee = value * (discountBps / 10000);
    return BigInt(Math.floor(value - fee));
  };

  // Get selected invoices for comparison
  const selectedInvoices = useMemo(
    () =>
      filteredAndSortedInvoices.filter((inv) =>
        selectedInvoiceIds.includes(inv.id),
      ),
    [filteredAndSortedInvoices, selectedInvoiceIds],
  );

  // Handle selection change from InvoiceTable
  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedInvoiceIds(ids.slice(0, 4)); // Cap at 4 for comparison
  }, []);

  return (
    <PageLayout>
      <div className="space-y-8 py-4">
        {/* Header */}
        <div className="border-b border-border/40 pb-5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-xl font-bold font-mono tracking-wider uppercase text-white">
                {t("header.title")}
              </h1>
              <p className="text-slate-500 text-xs font-mono mt-1">
                {t("header.description")}
              </p>
              <p
                className="mt-2 text-[10px] font-mono text-slate-500"
                aria-live="polite"
              >
                {indexerFreshness.isFetching
                  ? "Refreshing indexed data…"
                  : indexerFreshness.data?.[0]
                    ? `Latest indexed event: ledger ${indexerFreshness.data[0].ledger} · ${new Date(indexerFreshness.data[0].ledger_closed_at * 1000).toLocaleString()}`
                    : indexerFreshness.isError
                      ? "Indexer freshness is temporarily unavailable."
                      : "Waiting for indexed events."}
              </p>
            </div>

            {/* Top Available Liquidity indicator */}
            <div className="bg-[#0d131a] border border-border rounded-lg px-4 py-2 text-right font-mono">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">
                {t("header.liquidityLabel")}
              </span>
              <span className="text-sm font-bold text-primary block mt-0.5">
                {isStatsLoading
                  ? t("syncing")
                  : formatAmount(stats?.availableLiquidity)}
              </span>
            </div>
          </div>
        </div>

        {/* Warning Banner for Unverified Profiles */}
        {connected && !isVerified && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3 font-mono text-xs text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.02)]">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold uppercase">
                {t("verificationBanner.title")}
              </span>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                {t.rich("verificationBanner.body", {
                  link: (chunks) => (
                    <Link
                      href="/profile"
                      className="text-primary hover:underline font-bold"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-[#0d131a] border border-border rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-4 font-mono text-xs items-end">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase">
              {t("filters.status.label")}
            </span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSelectedInvoice(null);
              }}
              className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="ALL">{t("filters.status.options.all")}</option>
              <option value="Created">
                {t("filters.status.options.created")}
              </option>
              <option value="Listed">
                {t("filters.status.options.listed")}
              </option>
              <option value="Funded">
                {t("filters.status.options.funded")}
              </option>
              <option value="Active">
                {t("filters.status.options.active")}
              </option>
              <option value="Confirmed">
                {t("filters.status.options.confirmed")}
              </option>
              <option value="Repaid">
                {t("filters.status.options.repaid")}
              </option>
              <option value="Defaulted">
                {t("filters.status.options.defaulted")}
              </option>
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="marketplace-due-from"
              className="text-[10px] text-slate-500 font-bold uppercase"
            >
              {t("filters.dueFrom")}
            </label>
            <input
              id="marketplace-due-from"
              type="date"
              value={dueFrom}
              onChange={(event) => setDueFrom(event.target.value)}
              className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="marketplace-due-to"
              className="text-[10px] text-slate-500 font-bold uppercase"
            >
              {t("filters.dueTo")}
            </label>
            <input
              id="marketplace-due-to"
              type="date"
              min={dueFrom || undefined}
              value={dueTo}
              onChange={(event) => setDueTo(event.target.value)}
              className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="marketplace-asset"
              className="text-[10px] text-slate-500 font-bold uppercase"
            >
              {t("filters.asset.label")}
            </label>
            <select
              id="marketplace-asset"
              value={assetFilter}
              onChange={(event) =>
                setAssetFilter(
                  event.target.value as MarketplaceFilters["asset"],
                )
              }
              className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary"
            >
              <option value="ALL">{t("filters.asset.all")}</option>
              <option value="USDC">USDC</option>
              <option value="XLM">XLM</option>
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="marketplace-min-value"
              className="text-[10px] text-slate-500 font-bold uppercase"
            >
              {t("filters.minValue.label")}
            </label>
            <input
              id="marketplace-min-value"
              type="number"
              placeholder={t("filters.minValue.placeholder")}
              className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="marketplace-max-value"
              className="text-[10px] text-slate-500 font-bold uppercase"
            >
              {t("filters.maxValue.label")}
            </label>
            <input
              id="marketplace-max-value"
              type="number"
              placeholder={t("filters.maxValue.placeholder")}
              className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500 font-bold uppercase">
                {t("filters.maxDiscount.label")}
              </span>
              <span className="text-primary font-bold">
                {(parseInt(maxDiscount) / 100).toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="500"
              step="50"
              className="w-full accent-primary bg-slate-900 h-1.5 rounded"
              value={maxDiscount}
              onChange={(e) => setMaxDiscount(e.target.value)}
              aria-label={t("filters.maxDiscount.ariaLabel")}
              aria-valuenow={parseInt(maxDiscount)}
              aria-valuemin={50}
              aria-valuemax={500}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="marketplace-sort"
              className="text-[10px] text-slate-500 font-bold uppercase"
            >
              Sort this page by
            </label>
            <div className="flex gap-2">
              <select
                id="marketplace-sort"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as InvoiceSortKey)}
                className="w-full bg-[#080c10] border border-border rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-primary"
              >
                <option value="faceValue">Face value</option>
                <option value="dueDate">Due date</option>
                <option value="discountBps">Discount (bps)</option>
              </select>
              <select
                aria-label="Sort direction"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as SortDirection)}
                className="bg-[#080c10] border border-border rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-primary"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
            <p className="text-[10px] text-slate-500">
              Sorts the invoices loaded on this page. Discount is stored in
              basis points (100 bps = 1%).
            </p>
          </div>

          {/* Saved Searches / Presets */}
          <div className="relative space-y-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase">
              Saved Searches
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPresetsDropdown(!showPresetsDropdown)}
                className="w-full bg-[#080c10] border border-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-primary cursor-pointer flex items-center justify-between text-left hover:border-primary/40 transition-colors"
                aria-haspopup="listbox"
                aria-expanded={showPresetsDropdown}
              >
                <span className="truncate pr-6">
                  {presets.length > 0
                    ? `${presets.length} preset${presets.length !== 1 ? "s" : ""} saved`
                    : "No saved searches"}
                </span>
                <Menu className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              {showPresetsDropdown && (
                <div
                  className="absolute bottom-full left-0 right-0 mb-2 bg-[#0d131a] border border-border rounded-lg p-2 shadow-xl z-10 font-mono text-xs max-h-80 overflow-auto"
                  role="listbox"
                >
                  {/* Save current filters as new preset */}
                  <div className="border-b border-border/40 pb-2 mb-2 flex gap-2">
                    <input
                      type="text"
                      placeholder="Preset name..."
                      className="flex-1 bg-[#080c10] border border-border rounded px-2 py-1.5 text-white focus:outline-none focus:border-primary text-[11px]"
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && savePreset()}
                      aria-label="New preset name"
                    />
                    <button
                      type="button"
                      onClick={savePreset}
                      disabled={!newPresetName.trim() || presets.length >= 10}
                      className="px-3 py-1.5 bg-primary text-black font-bold uppercase text-[10px] rounded hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Presets list */}
                  {presets.length === 0 ? (
                    <p className="text-slate-500 text-center py-2 text-[10px]">
                      No saved searches yet
                    </p>
                  ) : (
                    <ul className="space-y-1" role="listbox">
                      {presets.map((preset, index) => (
                        <li key={index} className="relative">
                          {editingPresetId === index.toString() ? (
                            <div className="flex gap-2 p-2">
                              <input
                                type="text"
                                className="flex-1 bg-[#080c10] border border-primary rounded px-2 py-1 text-white focus:outline-none text-[11px]"
                                value={editingPresetName}
                                onChange={(e) =>
                                  setEditingPresetName(e.target.value)
                                }
                                onKeyDown={(e) =>
                                  e.key === "Enter"
                                    ? saveEditedPreset(index.toString())
                                    : undefined
                                }
                                onBlur={() =>
                                  saveEditedPreset(index.toString())
                                }
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  saveEditedPreset(index.toString())
                                }
                                className="px-2 py-1 text-primary hover:underline text-[10px]"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between p-2 hover:bg-slate-900/50 rounded">
                              <button
                                type="button"
                                onClick={() => applyPreset(preset)}
                                className="flex-1 text-left text-white hover:text-primary transition-colors flex items-center gap-2"
                                role="option"
                                aria-selected="false"
                              >
                                <span className="font-bold">{preset.name}</span>
                                <span className="text-slate-500 text-[9px]">
                                  ({preset.filters.statusFilter}
                                  {", "}
                                  {preset.filters.minAmount || "0"}
                                  {"-"}
                                  {preset.filters.maxAmount || "∞"} ≤
                                  {Number(preset.filters.maxDiscount) / 100}%)
                                </span>
                              </button>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditingPreset(
                                      index.toString(),
                                      preset.name,
                                    );
                                  }}
                                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                                  aria-label="Rename preset"
                                >
                                  <Menu className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePreset(index.toString());
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                                  aria-label="Delete preset"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Cap notice */}
                  {presets.length >= 10 && (
                    <p className="text-amber-400 text-[9px] text-center pt-2 border-t border-border/40">
                      Maximum of 10 presets reached
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mb-4 rounded border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-400">
          Issuers must complete profile verification before listing. Buyers can
          fund listed invoices after connecting a wallet; status changes appear
          after Testnet events are indexed.
        </p>

        {/* Marketplace Contents */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Marketplace List (Left) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex justify-between items-center gap-3">
              <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white">
                {t("invoices.title", {
                  count: invoiceResultCount,
                })}
              </h2>
              <div className="flex items-center gap-3">
                {isInvoiceListLoading && (
                  <span className="text-xs text-primary animate-pulse font-mono uppercase">
                    {t("syncing")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => downloadInvoicesCSV(filteredAndSortedInvoices)}
                  disabled={filteredAndSortedInvoices.length === 0}
                  className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-slate-300 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Invoices Table */}
            <ErrorBoundary context="InvoiceList">
              <InvoiceTable
                invoices={pageInvoices}
                onSelectInvoice={handleSelectInvoice}
                activeId={selectedInvoice?.id}
                role={role}
                selectable
                selectedIds={selectedInvoiceIds}
                onSelectionChange={handleSelectionChange}
                emptyStateTitle={t("invoices.emptyState.title")}
                emptyStateDescription={`No invoices match the selected status, due-date range, funding asset, amount, and discount filters.`}
                emptyStateAction={{
                  label: t("invoices.emptyState.action"),
                  onClick: () => {
                    setStatusFilter("Listed");
                    setMinAmount("");
                    setMaxAmount("");
                    setMaxDiscount("500");
                    setDueFrom("");
                    setDueTo("");
                    setAssetFilter("ALL");
                    setSelectedInvoice(null);
                    setInvoicePage(1);
                    writeFiltersToStorage({
                      statusFilter: "Listed",
                      minAmount: "",
                      maxAmount: "",
                      maxDiscount: "500",
                      dueFrom: "",
                      dueTo: "",
                      asset: "ALL",
                    });
                  },
                }}
                pagination={{
                  page: invoicePage,
                  limit: invoiceLimit,
                  total: invoiceResultCount,
                  totalPages: invoiceResultPages,
                  onPageChange: handlePageChange,
                  onLimitChange: handleLimitChange,
                }}
              />
            </ErrorBoundary>

            {/* Compare Selected Toolbar */}
            {selectedInvoiceIds.length >= 2 && (
              <div className="bg-[#0d131a] border border-primary/20 rounded-lg p-4 flex items-center justify-between gap-4 font-mono text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-primary font-bold uppercase">
                    {selectedInvoiceIds.length} selected
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    (max 4 for comparison)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCompareModal(true)}
                  disabled={selectedInvoiceIds.length > 4}
                  className="px-4 py-2 bg-primary text-black font-bold uppercase tracking-wider rounded hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Compare Selected
                </button>
              </div>
            )}

            {/* Compare Modal */}
            {showCompareModal && selectedInvoices.length >= 2 && (
              <InvoiceCompareModal
                invoices={selectedInvoices}
                onClose={() => setShowCompareModal(false)}
              />
            )}
          </div>

          {/* Console Management Center (Right) */}
          <div className="lg:col-span-4 space-y-4">
            <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white">
              {t("console.title")}
            </h2>

            <ErrorBoundary context="ManagementCenter">
              {selectedInvoice ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-slate-500 uppercase">
                      {t.rich("console.role", {
                        role: connected ? role : t("console.publicView"),
                        strong: (chunks) => (
                          <strong className="text-primary uppercase">
                            {chunks}
                          </strong>
                        ),
                      })}
                    </span>
                    <button
                      onClick={() => setSelectedInvoice(null)}
                      className="text-primary hover:underline uppercase font-bold"
                    >
                      {t("console.clear")}
                    </button>
                  </div>

                  {/* LP Action: Fund from Pool Preview */}
                  {selectedInvoice.status === "Listed" &&
                    role === "lp" &&
                    connected && (
                      <div className="bg-[#0d131a] border border-primary/20 rounded p-4 text-xs font-mono space-y-2">
                        <span className="text-primary font-bold block uppercase text-[10px] tracking-wider">
                          {t("console.fundingPreview.title")}
                        </span>
                        <div className="flex justify-between">
                          <span>{t("console.fundingPreview.faceValue")}</span>
                          <span>
                            {formatAmount(
                              selectedInvoice.faceValue,
                              selectedInvoice.asset,
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between text-primary font-bold">
                          <span>
                            {t("console.fundingPreview.fundedCost", {
                              bps: selectedInvoice.discountBps,
                            })}
                          </span>
                          <span>
                            {formatAmount(
                              calculateFundingValue(
                                selectedInvoice.faceValue,
                                selectedInvoice.discountBps,
                              ),
                              selectedInvoice.asset,
                            )}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 pt-1 leading-normal border-t border-border/20 mt-1">
                          {t("console.fundingPreview.note")}
                        </div>
                      </div>
                    )}

                  {!connected && (
                    <p
                      role="status"
                      className="text-xs font-mono text-slate-400"
                    >
                      {t("console.connectToAct")}
                    </p>
                  )}
                  <InvoiceCard
                    invoice={selectedInvoice}
                    role={connected ? role : undefined}
                    isSelected
                  />
                </div>
              ) : (
                <div className="bg-card border border-dashed border-border rounded-lg p-6 text-center text-slate-500 font-mono text-[10px] py-20 uppercase tracking-wider">
                  <p className="mb-2 font-bold text-slate-400">
                    {t("console.emptyState.title")}
                  </p>
                  <p className="normal-case text-slate-500 leading-relaxed max-w-[200px] mx-auto">
                    {t("console.emptyState.description")}
                  </p>
                </div>
              )}
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
