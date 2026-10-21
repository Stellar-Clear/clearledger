"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Banknote,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FilePlus2,
  PackageCheck,
  ReceiptText,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Invoice } from "@/types";
import {
  buildInvoiceTimeline,
  getCurrentTimelineIndex,
  truncateTxHash,
  type TimelineStepKey,
} from "@/lib/invoiceTimeline";

interface InvoiceStatusTimelineProps {
  invoice: Invoice;
}

const STEP_ICONS: Record<
  TimelineStepKey,
  React.ComponentType<{ className?: string }>
> = {
  created: FilePlus2,
  listed: ReceiptText,
  funded: Banknote,
  shipped: Send,
  issuerConfirmed: PackageCheck,
  buyerConfirmed: ShieldCheck,
  settled: CheckCircle2,
};

export function InvoiceStatusTimeline({ invoice }: InvoiceStatusTimelineProps) {
  const entries = buildInvoiceTimeline(invoice);
  const currentIndex = getCurrentTimelineIndex(invoice);
  // Respect the OS-level reduced-motion preference: the current-step halo is
  // rendered statically instead of pulsing indefinitely.
  const shouldReduceMotion = useReducedMotion();

  return (
    <section aria-label="Invoice activity summary">
      <div className="mb-3 flex justify-end print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded border border-slate-600 px-3 py-1 text-[10px] font-semibold uppercase text-slate-300 hover:border-teal-400 hover:text-teal-300">
          Print activity summary
        </button>
      </div>
      <ol className="relative space-y-0">
      {entries.map((entry, index) => {
        const { isComplete, isCurrent, label, timestampLabel, txHash } = entry;
        const isFuture = !isComplete;
        const Icon = STEP_ICONS[entry.key];

        return (
          <li
            key={entry.key}
            className={`relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0 ${isFuture ? "opacity-40" : "opacity-100"}`}
          >
            {index < entries.length - 1 && (
              <span
                className={`absolute left-4 top-8 h-[calc(100%-2rem)] border-l ${
                  index < currentIndex
                    ? "border-teal-400"
                    : "border-dashed border-slate-600"
                }`}
                aria-hidden="true"
              />
            )}

            <div className="relative z-10 flex h-8 w-8 items-center justify-center">
              {isCurrent && (
                <motion.span
                  data-testid="timeline-current-pulse"
                  className="absolute h-8 w-8 rounded-full bg-teal-400/25"
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : { opacity: [0.25, 0.8, 0.25], scale: [1, 1.35, 1] }
                  }
                  transition={{
                    duration: 1.8,
                    repeat: shouldReduceMotion ? 0 : Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
              <span
                className={`relative flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                  isComplete
                    ? "border-teal-400 bg-teal-400 text-slate-950 shadow-[0_0_18px_rgba(45,212,191,0.25)]"
                    : "border-slate-600 bg-card text-slate-500"
                }`}
              >
                {isFuture ? (
                  <span className="h-2.5 w-2.5 rounded-full border border-slate-500" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </span>
            </div>

            <div className="min-w-0 pt-0.5">
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    className={`${isComplete ? "text-teal-300" : "text-slate-500"} h-3.5 w-3.5 shrink-0`}
                  />
                  <span
                    className={`truncate font-mono text-xs font-bold uppercase ${isComplete ? "text-white" : "text-slate-400"}`}
                  >
                    {label}
                  </span>
                </div>
                <span className="font-mono text-[10px] uppercase text-slate-500 sm:text-right">
                  {timestampLabel}
                </span>
              </div>

              <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase text-slate-500">
                <Clock3 className="h-3 w-3 shrink-0" />
                {txHash ? (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-teal-300 transition-colors hover:text-teal-200"
                  >
                    <span className="truncate">{truncateTxHash(txHash)}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="truncate">No tx hash recorded</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
      </ol>
    </section>
  );
}
