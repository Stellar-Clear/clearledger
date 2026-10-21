"use client";

import React from "react";
import { Invoice } from "@/types";
import { formatAmount } from "@/lib/assets";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface InvoiceCompareModalProps {
  invoices: Invoice[];
  onClose: () => void;
}

const COMPARISON_FIELDS: Array<{
  key: string;
  label: string;
  render: (invoice: Invoice) => React.ReactNode;
}> = [
  {
    key: "id",
    label: "Invoice ID",
    render: (inv) => (
      <code className="font-mono text-xs text-primary break-all">{inv.id}</code>
    ),
  },
  {
    key: "issuer",
    label: "Issuer",
    render: (inv) => (
      <code className="font-mono text-xs text-slate-400 break-all">
        {inv.issuer}
      </code>
    ),
  },
  {
    key: "buyer",
    label: "Buyer",
    render: (inv) => (
      <code className="font-mono text-xs text-slate-400 break-all">
        {inv.buyer}
      </code>
    ),
  },
  {
    key: "faceValue",
    label: "Face Value",
    render: (inv) => (
      <span className="font-bold text-white font-mono text-sm">
        {formatAmount(inv.faceValue, inv.asset)}
      </span>
    ),
  },
  {
    key: "asset",
    label: "Asset",
    render: (inv) => (
      <span className="font-mono text-xs text-slate-300 uppercase">
        {inv.asset}
      </span>
    ),
  },
  {
    key: "discountBps",
    label: "Discount Rate",
    render: (inv) => (
      <span className="font-mono text-sm text-slate-300">
        {inv.discountBps > 0 ? `${(inv.discountBps / 100).toFixed(2)}%` : "—"}
      </span>
    ),
  },
  {
    key: "fundedAmount",
    label: "Funded Amount",
    render: (inv) => (
      <span className="font-mono text-sm text-white">
        {formatAmount(inv.fundedAmount, inv.asset)}
      </span>
    ),
  },
  {
    key: "dueDate",
    label: "Due Date",
    render: (inv) => (
      <span className="font-mono text-xs text-slate-400">
        {new Date(inv.dueDate * 1000).toLocaleDateString()}
      </span>
    ),
  },
  {
    key: "createdAt",
    label: "Created",
    render: (inv) => (
      <span className="font-mono text-xs text-slate-400">
        {new Date(inv.createdAt * 1000).toLocaleString()}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    render: (inv) => <InvoiceStatusBadge status={inv.status} />,
  },
];

function InvoiceStatusBadge({ status }: { status: Invoice["status"] }) {
  const statusStyles: Record<Invoice["status"], string> = {
    Created: "bg-slate-500/20 text-slate-300",
    Listed: "bg-sky-500/20 text-sky-400",
    Funded: "bg-blue-500/20 text-blue-400",
    Active: "bg-emerald-500/20 text-emerald-400",
    Confirmed: "bg-amber-500/20 text-amber-400",
    Repaid: "bg-primary/20 text-primary",
    Defaulted: "bg-red-500/20 text-red-400",
  };

  const label: Record<Invoice["status"], string> = {
    Created: "CREATED",
    Listed: "LISTED",
    Funded: "FUNDED",
    Active: "ACTIVE",
    Confirmed: "CONFIRMED",
    Repaid: "REPAID",
    Defaulted: "DEFAULTED",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase tracking-wider ${statusStyles[status]}`}
    >
      {label[status]}
    </span>
  );
}

export function InvoiceCompareModal({
  invoices,
  onClose,
}: InvoiceCompareModalProps) {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose, {
    inertBackground: true,
  });
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const maxScroll = Math.max(0, invoices.length - 4);

  const visibleInvoices = invoices.slice(scrollOffset, scrollOffset + 4);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-[#080c10] border border-border rounded-xl w-full max-w-6xl max-h-[85vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <h2
            id="compare-modal-title"
            className="text-lg font-bold font-mono tracking-wider uppercase text-white"
          >
            Invoice Comparison
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            aria-label="Close comparison"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comparison Table */}
        <div className="p-6 overflow-auto max-h-[calc(85vh-120px)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]" role="table">
              <thead>
                <tr className="border-b border-border/40 text-left">
                  <th
                    className="p-3 font-bold font-mono text-[10px] uppercase tracking-wider text-slate-500 w-40"
                    scope="col"
                  >
                    Attribute
                  </th>
                  {visibleInvoices.map((invoice, index) => (
                    <th
                      key={invoice.id}
                      scope="col"
                      className="p-3 font-bold font-mono text-[10px] uppercase tracking-wider text-white min-w-[180px] relative"
                    >
                      <div className="flex items-center justify-between">
                        <span>Invoice {scrollOffset + index + 1}</span>
                        {invoices.length > 4 && (
                          <span className="text-[9px] text-slate-500">
                            #{scrollOffset + index + 1} of {invoices.length}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FIELDS.map((field) => (
                  <tr
                    key={field.key}
                    className="border-b border-border/20 hover:bg-slate-900/30 transition-colors"
                  >
                    <th
                      scope="row"
                      className="p-3 font-bold font-mono text-[10px] uppercase tracking-wider text-slate-500 w-40"
                    >
                      {field.label}
                    </th>
                    {visibleInvoices.map((invoice) => (
                      <td key={invoice.id} className="p-3">
                        {field.render(invoice)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Horizontal scroll indicator for >4 invoices */}
          {invoices.length > 4 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setScrollOffset((prev) => Math.max(0, prev - 1))}
                disabled={scrollOffset === 0}
                className="p-2 bg-[#0d131a] border border-border rounded hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Show previous invoice"
              >
                <ChevronLeft className="w-4 h-4 text-white" />
              </button>
              <span className="text-slate-500 text-[10px] font-mono">
                Showing {scrollOffset + 1}–
                {Math.min(scrollOffset + 4, invoices.length)} of{" "}
                {invoices.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setScrollOffset((prev) => Math.min(maxScroll, prev + 1))
                }
                disabled={scrollOffset >= maxScroll}
                className="p-2 bg-[#0d131a] border border-border rounded hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Show next invoice"
              >
                <ChevronRight className="w-4 h-4 text-white" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/40 px-6 py-4 bg-[#0d131a]/50">
          <p className="text-slate-500 text-[10px] font-mono text-center">
            Compare up to 4 invoices side by side. Use arrow buttons to scroll
            through more selections.
          </p>
        </div>
      </div>
    </div>
  );
}
