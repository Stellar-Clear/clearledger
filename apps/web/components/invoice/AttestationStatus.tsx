"use client";

import React from "react";
import { describeAttestation, type AttestationState } from "@/lib/attestation";
import type { Invoice } from "@/types";

const toneByState: Record<AttestationState, string> = {
  "missing-config": "text-amber-300",
  pending: "text-slate-300",
  valid: "text-emerald-400",
  rejected: "text-rose-400",
};

export function AttestationStatus({ invoice }: { invoice: Invoice }) {
  const status = describeAttestation({
    registryConfigured: Boolean(process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID),
    attestationAgentId: invoice.attestationAgentId,
    attestedAt: invoice.attestedAt,
    riskScoreBps: invoice.riskScoreBps,
  });

  return (
    <section aria-labelledby="attestation-status-title" className="space-y-2 text-xs font-mono">
      <h4 id="attestation-status-title" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Underwriting attestation
      </h4>
      <p role="status" className={`font-bold ${toneByState[status.state]}`}>
        {status.title}
      </p>
      <p className="text-slate-400">{status.nextStep}</p>
    </section>
  );
}
