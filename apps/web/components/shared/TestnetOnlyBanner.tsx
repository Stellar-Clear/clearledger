import React from "react";
import { AlertTriangle } from "lucide-react";

export function TestnetOnlyBanner() {
  return (
    <div
      role="status"
      aria-label="Testnet only"
      className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-amber-300"
    >
      <p className="mx-auto flex max-w-7xl items-start gap-2 text-xs leading-5 sm:items-center">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
        <span>
          Testnet only — transactions use Stellar Testnet. Do not use real funds.
        </span>
      </p>
    </div>
  );
}
