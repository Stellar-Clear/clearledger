"use client";

import React from "react";
import { ASSET_INFO } from "@/lib/assets";

/** Explains the configured Testnet USDC asset and the wallet setup it needs. */
export function UsdcTrustlineGuide() {
  const issuer = ASSET_INFO.USDC.issuer;
  return (
    <aside className="border-b border-sky-500/20 bg-sky-500/5 px-4 py-3 text-xs font-mono text-sky-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-1">
        <strong className="uppercase tracking-wider text-sky-300">Testnet USDC setup</strong>
        <span>
          This app uses <b>{ASSET_INFO.USDC.code}</b> (7 decimals) issued by{' '}
          <code className="break-all text-sky-200">{issuer}</code>.
        </span>
        <span className="text-sky-200/70">
          Add a trustline in Freighter before depositing or paying. On Testnet,
          use the Stellar Laboratory or CLI change-trust flow for this issuer;
          fund the wallet with Friendbot first if it has no XLM reserve.
        </span>
      </div>
    </aside>
  );
}
