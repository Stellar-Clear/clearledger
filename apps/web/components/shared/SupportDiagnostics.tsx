"use client";

import { useState } from "react";

interface SupportDiagnosticsProps {
  error: string;
  contractId: string;
}

function getSafeErrorCode(error: string): string {
  if (/timeout|timed out/i.test(error)) return "TRANSACTION_TIMEOUT";
  if (/simulation failed/i.test(error)) return "SIMULATION_FAILED";
  if (/submission.*unknown|check transaction history/i.test(error)) {
    return "SUBMISSION_STATUS_UNKNOWN";
  }
  if (/network|fetch|rate limit|rpc/i.test(error)) return "RPC_UNAVAILABLE";
  if (/transaction failed|failed on-chain/i.test(error)) {
    return "TRANSACTION_FAILED";
  }
  return "UNKNOWN";
}

/** Copies only public environment identifiers and a normalized error code. */
export function SupportDiagnostics({
  error,
  contractId,
}: SupportDiagnosticsProps) {
  const [copied, setCopied] = useState(false);
  const diagnostics = JSON.stringify(
    {
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
      contractId: contractId || "not-configured",
      errorCode: getSafeErrorCode(error),
    },
    null,
    2,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="mt-2 text-[10px] font-mono text-slate-400 underline hover:text-white"
      aria-label="Copy safe support diagnostics"
    >
      {copied ? "Diagnostics copied" : "Copy safe support diagnostics"}
    </button>
  );
}
