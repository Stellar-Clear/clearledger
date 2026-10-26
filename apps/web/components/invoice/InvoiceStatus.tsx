"use client";

import React from "react";
import { InvoiceStatus as StatusType } from "@/types";
import {
  FilePlus,
  Tag,
  Banknote,
  Clock,
  CheckCircle2,
  CheckCheck,
  Flame,
  LucideIcon,
} from "lucide-react";

interface InvoiceStatusProps {
  status: StatusType;
}

const statusColors: Record<
  StatusType,
  { bg: string; border: string; text: string; icon: LucideIcon }
> = {
  Created: {
    bg: "bg-slate-500/5",
    border: "border-slate-500/20",
    text: "text-slate-100",
    icon: FilePlus,
  },
  Listed: {
    bg: "bg-teal-500/5",
    border: "border-teal-500/25",
    text: "text-teal-100",
    icon: Tag,
  },
  Funded: {
    bg: "bg-blue-500/5",
    border: "border-blue-500/25",
    text: "text-blue-100",
    icon: Banknote,
  },
  Active: {
    bg: "bg-indigo-500/5",
    border: "border-indigo-500/25",
    text: "text-indigo-100",
    icon: Clock,
  },
  Confirmed: {
    bg: "bg-sky-500/5",
    border: "border-sky-500/25",
    text: "text-sky-100",
    icon: CheckCircle2,
  },
  Repaid: {
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/25",
    text: "text-emerald-100",
    icon: CheckCheck,
  },
  Defaulted: {
    bg: "bg-amber-500/5",
    border: "border-amber-500/25",
    text: "text-amber-100",
    icon: Flame,
  },
};

export function InvoiceStatus({ status }: InvoiceStatusProps) {
  const config = statusColors[status] || statusColors.Created;

  const isPulsing =
    status === "Active" || status === "Funded" || status === "Listed";
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold font-mono tracking-wider uppercase border ${config.bg} ${config.border} ${config.text}`}
      role="status"
      aria-label={`Invoice status: ${status}`}
      title={status}
    >
      <Icon
        className={`w-3.5 h-3.5 ${isPulsing ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      <span>{status}</span>
    </span>
  );
}
