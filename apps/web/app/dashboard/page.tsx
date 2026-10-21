"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/shared/PageLayout";
import { InvoiceTable } from "@/components/invoice/InvoiceTable";
import { InvoiceCard } from "@/components/invoice/InvoiceCard";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useInvoiceList } from "@/hooks/useInvoices";
import { useRecentEvents } from "@/hooks/useEvents";
import { useWalletStore } from "@/store/wallet";
import { useProfile } from "@/hooks/useProfile";
import { WalletConnect } from "@/components/shared/WalletConnect";
import {
  InvoiceTableSkeleton,
  ActivityTimelineSkeleton,
} from "@/components/shared/SkeletonLoader";
import { Layers, Plus, CheckCircle2, Circle, Lock } from "lucide-react";
import { Invoice } from "@/types";
import { motion, AnimatePresence } from "framer-motion";
import { formatAmount } from "@/lib/assets";
import { truncateAddress } from "@/lib/format";
import { useFocusTrap } from "@/hooks/useFocusTrap";

const InvoiceForm = dynamic(
  () => import("@/components/invoice/InvoiceForm").then((m) => m.InvoiceForm),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
      </div>
    ),
  },
);

// User-facing strings live in `messages/en.json` under the "Dashboard"
// namespace; see docs/developer-guide/i18n.md for the migration pattern.
export default function SMEDashboard() {
  const t = useTranslations("Dashboard");
  const address = useWalletStore((s) => s.address);
  const connected = useWalletStore((s) => s.connected);
  const role = useWalletStore((s) => s.role);
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceLimit, setInvoiceLimit] = useState(20);
  const { invoices, isLoading, total, totalPages } = useInvoiceList({
    issuer: address || undefined,
    page: invoicePage,
    limit: invoiceLimit,
  });
  const { events, isLoading: eventsLoading } = useRecentEvents(10);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { isVerified } = useProfile();
  const createModalRef = useFocusTrap<HTMLDivElement>(
    showCreateModal,
    () => setShowCreateModal(false),
    { inertBackground: true },
  );

  useEffect(() => {
    setSelectedInvoice(null);
  }, [invoicePage, invoiceLimit, address]);

  // Compute stats
  const totalFunded = invoices.reduce((sum, inv) => sum + inv.fundedAmount, 0n);
  const totalInvoicesCreated = invoices.length;
  const totalListed = invoices.filter((i) => i.status === "Listed").length;
  const totalFundedActive = invoices.filter(
    (i) =>
      i.status === "Funded" ||
      i.status === "Active" ||
      i.status === "Confirmed",
  ).length;

  const handlePageChange = (page: number) => {
    setInvoicePage(page);
    setSelectedInvoice(null);
  };

  const handleLimitChange = (limit: number) => {
    setInvoiceLimit(limit);
    setInvoicePage(1);
    setSelectedInvoice(null);
  };

  const formatEventDisplay = (event: (typeof events)[number]) => {
    const typeMap: Record<string, string> = {
      InvoiceCreated: t("activity.types.created"),
      create: t("activity.types.created"),
      InvoiceListed: t("activity.types.listed"),
      list_for_financing: t("activity.types.listed"),
      InvoiceFunded: t("activity.types.funded"),
      fund_invoice: t("activity.types.funded"),
      InvoiceShipped: t("activity.types.shipped"),
      mark_shipped: t("activity.types.shipped"),
      DeliveryConfirmed: t("activity.types.deliveryConfirmed"),
      confirm_delivery: t("activity.types.deliveryConfirmed"),
      InvoiceRepaid: t("activity.types.repaid"),
      repay: t("activity.types.repaid"),
      InvoiceDefaulted: t("activity.types.defaulted"),
      trigger_default: t("activity.types.defaulted"),
    };
    const type = typeMap[event.event_type] || event.event_type;
    const invId: string = event.data?.invoice_id || "";
    const invShort = invId
      ? t("activity.invoiceRef", { id: invId.slice(0, 4) })
      : "";
    let details = "";
    switch (event.event_type) {
      case "InvoiceCreated":
      case "create":
        details = t("activity.details.created", {
          invoice: invShort,
          buyer: event.data?.buyer
            ? `${event.data.buyer.slice(0, 4)}...`
            : t("activity.unknownBuyer"),
        });
        break;
      case "InvoiceListed":
      case "list_for_financing":
        details = t("activity.details.listed", { invoice: invShort });
        break;
      case "InvoiceFunded":
      case "fund_invoice":
        details = t("activity.details.funded", { invoice: invShort });
        break;
      case "InvoiceShipped":
      case "mark_shipped":
        details = t("activity.details.shipped", { invoice: invShort });
        break;
      case "DeliveryConfirmed":
      case "confirm_delivery":
        details = t("activity.details.deliveryConfirmed", {
          invoice: invShort,
        });
        break;
      case "InvoiceRepaid":
      case "repay":
        details = t("activity.details.repaid", { invoice: invShort });
        break;
      case "InvoiceDefaulted":
      case "trigger_default":
        details = t("activity.details.defaulted", { invoice: invShort });
        break;
      default:
        details = invShort || t("activity.details.fallback");
    }
    const now = Math.floor(Date.now() / 1000);
    const diff = now - event.ledger_closed_at;
    let time = "";
    if (diff < 60) time = t("activity.time.justNow");
    else if (diff < 3600)
      time = t("activity.time.minutesAgo", { minutes: Math.floor(diff / 60) });
    else if (diff < 86400)
      time = t("activity.time.hoursAgo", { hours: Math.floor(diff / 3600) });
    else time = t("activity.time.daysAgo", { days: Math.floor(diff / 86400) });
    return { id: event.id, type, details, time };
  };

  if (!connected) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center text-center py-20 max-w-md mx-auto min-h-[70vh]">
          <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg mb-6 shadow-[0_0_20px_rgba(0,212,170,0.15)]">
            <Layers className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-2xl font-bold font-mono tracking-wider text-white uppercase mb-2">
            {t("connectPrompt.title")}
          </h1>
          <p className="text-slate-400 text-xs font-mono mb-8 leading-relaxed">
            {t("connectPrompt.body")}
          </p>
          <WalletConnect />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="space-y-8 py-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border/40 pb-5">
          <div>
            <h1 className="text-xl font-bold font-mono tracking-wider uppercase text-white">
              {t("header.title")}
            </h1>
            <p className="text-slate-500 text-xs font-mono mt-1">
              {t("header.operator", {
                address: address ? truncateAddress(address) : "",
                role: role.toUpperCase(),
              })}
            </p>
          </div>

          <button
            onClick={() => {
              if (!isVerified) return;
              setShowCreateModal(true);
            }}
            disabled={!isVerified}
            className={`font-bold uppercase tracking-wider text-xs rounded px-4 py-2.5 flex items-center gap-1.5 transition-all ${
              isVerified
                ? "bg-primary hover:bg-primary-hover text-black shadow-[0_0_15px_rgba(0,212,170,0.1)]"
                : "bg-neutral-800 text-slate-500 border border-neutral-700 cursor-not-allowed opacity-60"
            }`}
            title={!isVerified ? t("header.createInvoiceLocked") : undefined}
          >
            <Plus className="w-4 h-4" />
            <span>{t("header.createInvoice")}</span>
          </button>
        </div>

        {/* Onboarding checklist — shown only while the user is unverified */}
        {!isVerified && (
          <div className="bg-card border border-border rounded-lg p-5 space-y-4 shadow-[0_0_25px_rgba(0,212,170,0.03)]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full border border-primary/30 bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-primary text-xs font-bold font-mono">
                  !
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold font-mono tracking-wider text-white uppercase">
                  {t("checklist.title")}
                </h3>
                <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
                  {t("checklist.description")}
                </p>
              </div>
            </div>

            {/* Step 1: Connect Wallet — always completed by this point */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold font-mono text-white">
                  {t("checklist.connectWallet.title")}
                </span>
                <p className="text-[10px] text-slate-500 truncate">
                  {t("checklist.connectWallet.description")}
                </p>
              </div>
              <span className="text-[9px] font-bold font-mono text-primary uppercase shrink-0">
                {t("checklist.connectWallet.status")}
              </span>
            </div>

            {/* Step 2: Register Profile — pending action */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <Circle className="w-5 h-5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold font-mono text-amber-400">
                  {t("checklist.registerProfile.title")}
                </span>
                <p className="text-[10px] text-slate-500 truncate">
                  {t("checklist.registerProfile.description")}
                </p>
              </div>
              <span className="text-[9px] font-bold font-mono text-amber-400 uppercase shrink-0">
                {t("checklist.registerProfile.status")}
              </span>
            </div>

            {/* Step 3: Create Invoice — locked behind verification */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card">
              <Lock className="w-5 h-5 text-slate-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold font-mono text-slate-400">
                  {t("checklist.createInvoice.title")}
                </span>
                <p className="text-[10px] text-slate-500 truncate">
                  {t("checklist.createInvoice.description")}
                </p>
              </div>
              <span className="text-[9px] font-bold font-mono text-slate-600 uppercase shrink-0">
                {t("checklist.createInvoice.status")}
              </span>
            </div>

            {/* CTA to profile registration page */}
            <Link
              href="/profile"
              className="w-full mt-2 bg-primary hover:bg-primary-hover text-black font-bold uppercase tracking-wider text-xs rounded px-4 py-2.5 flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(0,212,170,0.1)] transition-all"
            >
              <span>{t("checklist.cta")}</span>
            </Link>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-card border border-border rounded-lg p-4 font-mono">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
              {t("stats.created.label")}
            </span>
            <span className="text-lg font-bold text-white block mt-1">
              {totalInvoicesCreated}
            </span>
            <span className="text-[9px] text-slate-600">
              {t("stats.created.hint")}
            </span>
          </div>

          <div className="bg-card border border-border rounded-lg p-4 font-mono">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
              {t("stats.listed.label")}
            </span>
            <span className="text-lg font-bold text-primary block mt-1">
              {totalListed}
            </span>
            <span className="text-[9px] text-slate-600">
              {t("stats.listed.hint")}
            </span>
          </div>

          <div className="bg-card border border-border rounded-lg p-4 font-mono">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
              {t("stats.fundedActive.label")}
            </span>
            <span className="text-lg font-bold text-sky-400 block mt-1">
              {totalFundedActive}
            </span>
            <span className="text-[9px] text-slate-600">
              {t("stats.fundedActive.hint")}
            </span>
          </div>

          <div className="bg-card border border-border rounded-lg p-4 font-mono">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
              {t("stats.repaid.label")}
            </span>
            <span className="text-lg font-bold text-emerald-400 block mt-1">
              {invoices.filter((i) => i.status === "Repaid").length}
            </span>
            <span className="text-[9px] text-slate-600">
              {t("stats.repaid.hint")}
            </span>
          </div>

          <div className="bg-card border border-border rounded-lg p-4 font-mono md:col-span-1 lg:col-span-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
              {t("stats.financed.label")}
            </span>
            <span className="text-lg font-bold text-white block mt-1 truncate">
              {formatAmount(totalFunded)}
            </span>
            <span className="text-[9px] text-slate-600">
              {t("stats.financed.hint")}
            </span>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main Invoices Section (Left / Center) */}
          <div className="lg:col-span-8 space-y-6">
            <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white">
              {t("invoices.title")}
            </h2>

            {isLoading ? (
              <InvoiceTableSkeleton />
            ) : (
              <ErrorBoundary context="InvoiceTable">
                <InvoiceTable
                  invoices={invoices}
                  onSelectInvoice={(invoice) => setSelectedInvoice(invoice)}
                  activeId={selectedInvoice?.id}
                  role={role}
                  emptyStateTitle={t("invoices.emptyState.title")}
                  emptyStateDescription={t("invoices.emptyState.description")}
                  emptyStateAction={{
                    label: t("invoices.emptyState.action"),
                    onClick: () => setShowCreateModal(true),
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
            )}

            {/* Recent activity timeline */}
            {eventsLoading ? (
              <ActivityTimelineSkeleton />
            ) : (
              <ErrorBoundary context="ActivityLog">
                <div className="bg-card border border-border rounded-lg p-5 space-y-4">
                  <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider border-b border-border/40 pb-2">
                    {t("activity.title")}
                  </h3>
                  <div className="space-y-3 font-mono text-xs">
                    {events.length === 0 && (
                      <p className="text-slate-500 text-[10px] py-4 text-center">
                        {t("activity.empty")}
                      </p>
                    )}
                    {events.map((event) => {
                      const display = formatEventDisplay(event);
                      return (
                        <div
                          key={event.id}
                          className="flex justify-between items-start gap-4 p-2 border-b border-border/20 last:border-0"
                        >
                          <div className="space-y-1">
                            <span className="text-primary font-bold">
                              {display.type}
                            </span>
                            <p className="text-[10px] text-slate-400">
                              {display.details}
                            </p>
                          </div>
                          <span className="text-[9px] text-slate-500 text-right">
                            {display.time}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </ErrorBoundary>
            )}
          </div>

          {/* Side Management Panel (Right) */}
          <div className="lg:col-span-4 space-y-6">
            <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white">
              {t("console.title")}
            </h2>

            <ErrorBoundary context="ManagementConsole">
              <AnimatePresence mode="wait">
                {selectedInvoice ? (
                  <motion.div
                    key={selectedInvoice.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold font-mono text-slate-500 uppercase">
                        {t("console.selectedDetails")}
                      </span>
                      <button
                        onClick={() => setSelectedInvoice(null)}
                        className="text-[10px] font-mono text-primary hover:underline uppercase font-bold"
                      >
                        {t("console.clear")}
                      </button>
                    </div>
                    <InvoiceCard
                      invoice={selectedInvoice}
                      role={role}
                      isSelected
                    />

                    {/* Additional invoice details */}
                    <Link
                      href={`/invoice/${selectedInvoice.id}`}
                      className="w-full bg-[#0d131a] border border-border hover:border-primary/50 text-slate-300 hover:text-white font-bold text-xs uppercase tracking-wider py-2 rounded text-center block font-mono"
                    >
                      {t("console.viewAuditLedger")}
                    </Link>
                  </motion.div>
                ) : (
                  <div className="bg-card/45 border border-dashed border-border rounded-lg p-6 text-center text-slate-500 font-mono text-[10px] py-20 uppercase tracking-wider">
                    {t("console.emptyState")}
                  </div>
                )}
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {/* Create Invoice Dialog Modal */}
      {showCreateModal && (
        <div
          ref={createModalRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("createModal.label")}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#080c10]/95 backdrop-blur-sm p-0 md:p-4"
          onClick={() => setShowCreateModal(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowCreateModal(false);
          }}
        >
          <div
            className="w-full max-w-lg relative bg-card border md:border-border rounded-t-2xl md:rounded-lg max-h-[92vh] md:max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-border/40 shrink-0">
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider">
                {t("createModal.title")}
              </span>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-500 hover:text-white font-bold font-mono text-xs uppercase px-2 py-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {t("createModal.close")}
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain p-5 pt-3">
              <InvoiceForm
                onSuccess={() => {
                  setShowCreateModal(false);
                  setSelectedInvoice(null);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
