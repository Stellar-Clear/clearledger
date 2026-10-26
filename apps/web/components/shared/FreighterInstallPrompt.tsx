"use client";

import React from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

interface FreighterInstallPromptProps {
  /** Re-run extension detection. */
  onRetry: () => void;
  /** True once automatic polling gave up: suggest a page refresh. */
  exhausted: boolean;
}

export const FREIGHTER_URL = "https://www.freighter.app/";

/**
 * Shown in place of "Connect Wallet" when the Freighter extension is not
 * detected. Explains what is missing, links to the official Freighter page
 * and lets the user re-check after installing.
 */
export function FreighterInstallPrompt({
  onRetry,
  exhausted,
}: FreighterInstallPromptProps) {
  return (
    <div
      role="region"
      aria-label="Freighter wallet required"
      className="flex flex-col gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 font-mono"
    >
      <p id="freighter-missing-desc">
        Freighter wallet not detected. Install the Freighter browser extension
        to connect a Stellar Testnet account.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={FREIGHTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby="freighter-missing-desc"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold border border-amber-500/30 rounded-md hover:bg-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 transition-all"
        >
          <span>Install Freighter</span>
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-amber-500/30 rounded-md hover:bg-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>I installed it, retry</span>
        </button>
      </div>
      <p role="status" aria-live="polite">
        {exhausted
          ? "Still not detected. If you just installed Freighter, refresh this page so the extension can load."
          : "Checking for Freighter automatically…"}
      </p>
    </div>
  );
}
