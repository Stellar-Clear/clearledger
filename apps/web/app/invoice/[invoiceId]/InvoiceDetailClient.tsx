"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageLayout } from "@/components/shared/PageLayout";
import { useInvoice } from "@/hooks/useInvoices";
import { useInvoiceDetailActions } from "@/hooks/useInvoiceDetailActions";
import { useWalletStore } from "@/store/wallet";
import { InvoiceStatus } from "@/components/invoice/InvoiceStatus";
import { InvoiceStatusTimeline } from "@/components/invoice/InvoiceStatusTimeline";
import { Button } from "@/components/ui/button";
import { TransactionPending } from "@/components/shared/TransactionPending";
import {
  Calendar,
  ShieldAlert,
  Copy,
  Check,
  ArrowLeft,
  ChevronRight,
  FileDown,
  Loader2,
  Lock,
  Users,
  Activity,
  TrendingUp,
  Share2,
} from "lucide-react";
import { formatAmount } from "@/lib/assets";
import { truncateAddress } from "@/lib/format";
import { generateInvoicePdf } from "@/lib/invoicePdf";

interface InvoiceDetailClientProps {
  invoiceId: string;
}

export default function InvoiceDetailClient({
  invoiceId,
}: InvoiceDetailClientProps) {
  const router = useRouter();
  const connected = useWalletStore((s) => s.connected);
  const role = useWalletStore((s) => s.role);

  const { invoice, isLoading, refetch } = useInvoice(invoiceId);
  const {
    submitting,
    error,
    showPending,
    pendingHash,
    pendingText,
    setShowPending,
    ship,
    confirm,
    repay,
    markDefault,
  } = useInvoiceDetailActions(invoiceId, refetch);

  const [copiedId, setCopiedId] = useState(false);
  const [copiedIssuer, setCopiedIssuer] = useState(false);
  const [copiedBuyer, setCopiedBuyer] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setInvoiceUrl(window.location.href);
    }
  }, []);

  const copyToClipboard = async (
    text: string,
    type: "id" | "issuer" | "buyer" | "link",
  ) => {
    await navigator.clipboard.writeText(text);
    switch (type) {
      case "id":
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
        break;
      case "issuer":
        setCopiedIssuer(true);
        setTimeout(() => setCopiedIssuer(false), 2000);
        break;
      case "buyer":
        setCopiedBuyer(true);
        setTimeout(() => setCopiedBuyer(false), 2000);
        break;
      case "link":
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
        break;
    }
  };

  /**
   * Builds the invoice PDF client-side. Runs without a connected wallet, so
   * the read-only public invoice pages can export a record too.
   */
  const downloadPdf = async () => {
    if (!invoice || isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfError(null);
    try {
      await generateInvoicePdf(invoice);
    } catch (error) {
      setPdfError(
        error instanceof Error
          ? error.message
          : "Could not generate the invoice PDF.",
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const shareMessage = useMemo(() => {
    if (!invoice) return "";
    return `ClearLedger Invoice ${invoice.id} — ${formatAmount(invoice.faceValue)} USDC`;
  }, [invoice]);

  const whatsappUrl = useMemo(() => {
    return `https://wa.me/?text=${encodeURIComponent(`${shareMessage} ${invoiceUrl}`)}`;
  }, [invoiceUrl, shareMessage]);

  const telegramUrl = useMemo(() => {
    return `https://t.me/share/url?url=${encodeURIComponent(invoiceUrl)}&text=${encodeURIComponent(shareMessage)}`;
  }, [invoiceUrl, shareMessage]);

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center py-20 min-h-[50vh] font-mono text-xs text-primary animate-pulse uppercase">
          Fetching invoice state from ledger...
        </div>
      </PageLayout>
    );
  }

  if (!invoice) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center py-20 min-h-[50vh] text-center max-w-sm mx-auto space-y-4">
          <ShieldAlert className="w-12 h-12 text-amber-500" />
          <h1 className="text-md font-bold font-mono text-white uppercase">
            Ledger entry not found
          </h1>
          <p className="text-slate-500 text-xs font-mono">
            The invoice ID: {invoiceId} was not found on-chain. Please verify
            the address.
          </p>
          <Button
            className="border border-border text-slate-300 font-mono text-xs uppercase px-4 py-2 hover:bg-slate-900"
            onClick={() => router.push("/dashboard")}
          >
            Return to Dashboard
          </Button>
        </div>
      </PageLayout>
    );
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  const secondsRemaining = Number(invoice.dueDate) - nowSecs;
  const daysRemaining = Math.ceil(secondsRemaining / (24 * 3600));
  const isOverdue = secondsRemaining < 0;
  const canShip = connected && role === "issuer" && invoice.status === "Funded";
  const canConfirm =
    connected && role === "buyer" && invoice.status === "Active";
  const canRepay =
    connected && role === "buyer" && invoice.status === "Confirmed";
  const canDefault = connected && invoice.status === "Confirmed" && isOverdue;

  return (
    <PageLayout>
      <div className="space-y-6 py-4">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold font-mono uppercase tracking-wider">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-slate-500 transition-colors hover:text-white flex-shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-700 flex-shrink-0" />
          <Link
            href="/dashboard"
            className="text-slate-500 transition-colors hover:text-white flex-shrink-0"
          >
            Invoices
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-700 flex-shrink-0" />
          <span className="text-slate-400 truncate">
            Invoice #{truncateAddress(invoice.id)}
          </span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-md font-bold font-mono text-white truncate">
                INVOICE AUDIT LEDGER
              </h1>
              <InvoiceStatus status={invoice.status} />
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs text-slate-500 flex-wrap">
              <span className="truncate">
                HASH: <strong className="text-slate-400">{invoice.id}</strong>
              </span>
              <button
                onClick={() => copyToClipboard(invoice.id, "id")}
                className="text-slate-600 hover:text-primary transition-colors flex-shrink-0"
                aria-label="Copy invoice ID"
              >
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
          <div className="bg-[#0d131a] border border-border rounded px-4 py-2 font-mono text-right flex-shrink-0">
            <span className="text-[10px] text-slate-500 font-bold uppercase block">
              Face Value Obligations
            </span>
            <span className="text-lg font-bold text-white block mt-0.5 truncate">
              {formatAmount(invoice.faceValue)}
            </span>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Soroban Transaction Progress
          </h3>
          <InvoiceStatusTimeline invoice={invoice} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider border-b border-border/40 pb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-primary" />
                Obligation Parties
              </h3>
              <div className="space-y-4 font-mono text-xs">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-2.5 bg-[#080c10]/40 rounded border border-border/30">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">
                      SME Issuer (Vendor)
                    </span>
                    <span className="text-slate-300 break-all select-all font-bold">
                      {invoice.issuer}
                    </span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(invoice.issuer, "issuer")}
                    className="self-end sm:self-center border border-border bg-[#0d131a] text-slate-400 hover:text-white px-2 py-1 rounded flex items-center gap-1"
                  >
                    {copiedIssuer ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedIssuer ? "COPIED" : "COPY"}</span>
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-2.5 bg-[#080c10]/40 rounded border border-border/30">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">
                      Buyer Party (Debtor)
                    </span>
                    <span className="text-slate-300 break-all select-all font-bold">
                      {invoice.buyer}
                    </span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(invoice.buyer, "buyer")}
                    className="self-end sm:self-center border border-border bg-[#0d131a] text-slate-400 hover:text-white px-2 py-1 rounded flex items-center gap-1"
                  >
                    {copiedBuyer ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedBuyer ? "COPIED" : "COPY"}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider border-b border-border/40 pb-2 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-primary" />
                Escrow Security Vault
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
                <div className="bg-[#080c10] border border-border/40 p-3 rounded">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">
                    {invoice.asset} Locked in Escrow
                  </span>
                  <span className="text-md font-bold text-sky-400 block mt-1">
                    {invoice.status === "Funded" ||
                    invoice.status === "Active" ||
                    invoice.status === "Confirmed"
                      ? formatAmount(invoice.faceValue, invoice.asset)
                      : `0.00 ${invoice.asset}`}
                  </span>
                </div>
                <div className="bg-[#080c10] border border-border/40 p-3 rounded">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">
                    Escrow Condition
                  </span>
                  <span className="text-slate-300 block mt-1 font-bold">
                    {invoice.status === "Funded"
                      ? "Locked (Awaiting SME shipment proof)"
                      : invoice.status === "Active"
                        ? "Locked (Goods Shipped, Awaiting Buyer delivery confirmation)"
                        : invoice.status === "Confirmed"
                          ? "Active (Delivered, Awaiting Buyer repayment)"
                          : invoice.status === "Repaid"
                            ? "Released (Repayment completed)"
                            : "Unlocked / Empty"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#0d131a] border border-border rounded-lg p-5 space-y-4">
              <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider border-b border-border/40 pb-2 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                Maturity Parameters
              </h3>
              <div className="space-y-4 font-mono text-xs">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-slate-500">Maturity Date:</span>
                  <span className="text-slate-300 font-bold">
                    {new Date(invoice.dueDate * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-slate-500">Maturity Status:</span>
                  <span
                    className={`font-bold ${isOverdue && invoice.status !== "Repaid" ? "text-amber-500" : "text-slate-300"}`}
                  >
                    {isOverdue && invoice.status !== "Repaid"
                      ? "OVERDUE"
                      : `${daysRemaining} days remaining`}
                  </span>
                </div>
                <div className="flex flex-wrap justify-between gap-2 border-t border-border/20 pt-3">
                  <span className="text-slate-500">Discount Rate:</span>
                  <span className="text-primary font-bold">
                    {invoice.discountBps > 0
                      ? `${(invoice.discountBps / 100).toFixed(2)}%`
                      : "—"}
                  </span>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-slate-500">Net Discount Fee:</span>
                  <span className="text-slate-300 font-bold">
                    {formatAmount(
                      BigInt(invoice.faceValue) - BigInt(invoice.fundedAmount),
                      invoice.asset,
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-[#0d131a] border border-border rounded-lg p-5 space-y-4">
              <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider border-b border-border/40 pb-2 flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5 text-primary" />
                Share Invoice
              </h3>
              <div className="space-y-3 text-xs font-mono">
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={downloadPdf}
                  disabled={isExportingPdf}
                  aria-busy={isExportingPdf}
                >
                  <span>
                    {isExportingPdf ? "Generating PDF..." : "Download PDF"}
                  </span>
                  {isExportingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                </Button>
                {pdfError && (
                  <p
                    className="text-xs font-mono text-red-400"
                    role="alert"
                    aria-live="assertive"
                  >
                    {pdfError}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() =>
                    copyToClipboard(invoiceUrl || window.location.href, "link")
                  }
                  disabled={!invoiceUrl}
                >
                  <span className="truncate">
                    {copiedLink ? "LINK COPIED" : "Copy Invoice Link"}
                  </span>
                  <Copy className="w-3.5 h-3.5 flex-shrink-0" />
                </Button>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <a
                    className="border border-border rounded px-2 py-2 text-center text-slate-300 hover:text-white"
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                  <a
                    className="border border-border rounded px-2 py-2 text-center text-slate-300 hover:text-white"
                    href={telegramUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Telegram
                  </a>
                </div>
              </div>
            </div>

            {(canShip || canConfirm || canRepay || canDefault) && (
              <div className="bg-[#0d131a] border border-border rounded-lg p-5 space-y-3">
                <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-primary" />
                  Available Action
                </h3>
                {canShip && (
                  <Button
                    className="w-full"
                    disabled={submitting}
                    onClick={ship}
                  >
                    MARK GOODS SHIPPED
                  </Button>
                )}
                {canConfirm && (
                  <Button
                    className="w-full"
                    disabled={submitting}
                    onClick={confirm}
                  >
                    CONFIRM DELIVERY
                  </Button>
                )}
                {canRepay && (
                  <Button
                    className="w-full"
                    disabled={submitting}
                    onClick={repay}
                  >
                    REPAY INVOICE
                  </Button>
                )}
                {canDefault && (
                  <Button
                    className="w-full"
                    disabled={submitting}
                    onClick={markDefault}
                  >
                    DEFAULT INVOICE
                  </Button>
                )}
                {error && (
                  <p
                    className="text-xs font-mono text-red-400"
                    role="alert"
                    aria-live="assertive"
                  >
                    Transaction failed: {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <TransactionPending
        isOpen={showPending}
        txHash={pendingHash}
        statusText={pendingText}
        onClose={() => setShowPending(false)}
      />
    </PageLayout>
  );
}
