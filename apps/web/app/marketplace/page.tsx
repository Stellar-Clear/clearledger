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
import { getRecentEvents } from "@/lib/api";
import { ShieldAlert, RotateCcw, Save, Trash2, Menu } from "lucide-react";

const MARKETPLACE_FILTERS_KEY = "clearledger:marketplace:filters";
const MARKETPLACE_PRESETS_KEY = "clearledger:marketplace:presets";

interface MarketplaceFilters {
  statusFilter: string;
  minAmount: string;
  maxAmount: string;
  maxDiscount: string;
}

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
      statusFilter: parsed.statusFilter ?? "Listed",
      minAmount: parsed.minAmount ?? "",
      maxAmount: parsed.maxAmount ?? "",
      maxDiscount: parsed.maxDiscount ?? "500",
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
  const indexerFreshness = useQuery({
    queryKey: ["marketplace", "indexer-freshness"],
    queryFn: () => getRecentEvents(1),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceLimit, setInvoiceLimit] = useState(20);
  const [showPresetsDropdown, setShowPresetsDropdown] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState("");

  // Filter States - initialized from localStorage
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const stored = readFiltersFromStorage();
    return stored?.statusFilter ?? "Listed";
  });
  const [minAmount, setMinAmount] = useState<string>(() => {
    const stored = readFiltersFromStorage();
    return stored?.minAmount ?? "";
  });
  const [maxAmount, setMaxAmount] = useState<string>(() => {
    const stored = readFiltersFromStorage();
    return stored?.maxAmount ?? "";
  });
  const [maxDiscount, setMaxDiscount] = useState<string>(() => {
    const stored = readFiltersFromStorage();
    return stored?.maxDiscount ?? "500";
  });

  // Persist filters to localStorage on change
  useEffect(() => {
    writeFiltersToStorage({ statusFilter, minAmount, maxAmount, maxDiscount });
  }, [statusFilter, minAmount, maxAmount, maxDiscount]);

  const { invoices, isLoading, total, totalPages } = useInvoiceList({
    status: statusFilter === "ALL" ? undefined : statusFilter,
    page: invoicePage,
    limit: invoiceLimit,
  });

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const handleSelectInvoice = useCallback(
    (invoice: Invoice) => setSelectedInvoice(invoice),
    [],
  );

  useEffect(() => {
    setInvoicePage(1);
    setSelectedInvoice(null);
  }, [statusFilter, minAmount, maxAmount, maxDiscount]);

  // Filter and Sort Invoices
  const filteredAndSortedInvoices = useMemo(() => {
    let result = [...invoices];

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

    // Sort by Face Value Descending by default
    return result.sort((a, b) => {
      if (b.faceValue > a.faceValue) return 1;
      if (b.faceValue < a.faceValue) return -1;
      return 0;
    });
  }, [invoices, minAmount, maxAmount, maxDiscount]);

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
      filters: { statusFilter, minAmount, maxAmount, maxDiscount },
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
              <p className="mt-2 text-[10px] font-mono text-slate-500" aria-live="polite">
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
        <div className="bg-[#0d131a] border border-border rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-4 font-mono text-xs items-end">
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

        {/* Marketplace Contents */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Marketplace List (Left) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white">
                {t("invoices.title", {
                  count: filteredAndSortedInvoices.length,
                })}
              </h2>
              {isLoading && (
                <span className="text-xs text-primary animate-pulse font-mono uppercase">
                  {t("syncing")}
                </span>
              )}
            </div>

            {/* Invoices Table */}
            <ErrorBoundary context="InvoiceList">
              <InvoiceTable
                invoices={filteredAndSortedInvoices}
                onSelectInvoice={handleSelectInvoice}
                activeId={selectedInvoice?.id}
                role={role}
                selectable
                selectedIds={selectedInvoiceIds}
                onSelectionChange={handleSelectionChange}
                emptyStateTitle={t("invoices.emptyState.title")}
                emptyStateDescription={
                  `No invoices match status ${statusFilter === "ALL" ? "any" : statusFilter}, amount ${minAmount || "any"}–${maxAmount || "any"} USDC, and maximum discount ${maxDiscount || "any"} bps. Clear the filters to see eligible invoices.`
                }
                emptyStateAction={{
                  label: t("invoices.emptyState.action"),
                  onClick: () => {
                    setStatusFilter("Listed");
                    setMinAmount("");
                    setMaxAmount("");
                    setMaxDiscount("500");
                    setSelectedInvoice(null);
                    setInvoicePage(1);
                    writeFiltersToStorage({
                      statusFilter: "Listed",
                      minAmount: "",
                      maxAmount: "",
                      maxDiscount: "500",
                    });
                  },
                }}
                pagination={{
                  page: invoicePage,
                  limit: invoiceLimit,
                  total,
                  totalPages,
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
