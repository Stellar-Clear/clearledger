"use client";

import React from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

export type VerificationState = "unverified" | "verified" | "failed";

interface VerificationBadgeProps {
  /** The attestation verification state for this invoice. */
  state: VerificationState;
  /** Risk score in basis points (0-10000). Only used when state is "verified". */
  riskScoreBps?: number | null;
}

const stateConfig: Record<
  VerificationState,
  { bg: string; border: string; text: string; label: string }
> = {
  unverified: {
    bg: "bg-slate-500/5",
    border: "border-slate-500/20",
    text: "text-slate-100",
    label: "Unverified",
  },
  verified: {
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/25",
    text: "text-emerald-100",
    label: "Verified",
  },
  failed: {
    bg: "bg-rose-500/5",
    border: "border-rose-500/25",
    text: "text-rose-100",
    label: "Verification failed",
  },
};

export function VerificationBadge({
  state,
  riskScoreBps,
}: VerificationBadgeProps) {
  const config = stateConfig[state];

  const displayText =
    state === "verified" && riskScoreBps != null
      ? `Verified · risk score ${(riskScoreBps / 100).toFixed(1)}%`
      : config.label;

  const ariaLabel =
    state === "verified" && riskScoreBps != null
      ? `Verification: verified, risk score ${(riskScoreBps / 100).toFixed(1)} percent`
      : `Verification: ${config.label}`;

  const Icon =
    state === "verified"
      ? ShieldCheck
      : state === "failed"
        ? ShieldAlert
        : ShieldQuestion;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold font-mono tracking-wider uppercase border ${config.bg} ${config.border} ${config.text}`}
      role="status"
      aria-label={ariaLabel}
      title={displayText}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{displayText}</span>
    </span>
  );
}
