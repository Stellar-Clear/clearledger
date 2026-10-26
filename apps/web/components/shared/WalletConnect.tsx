"use client";

import React, { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { Button } from "@/components/ui/button";
import { useFreighterInstallStatus } from "@/hooks/useFreighterInstallStatus";
import { FreighterInstallPrompt } from "./FreighterInstallPrompt";
import { useWalletStore } from "@/store/wallet";
import {
  Wallet,
  LogOut,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { truncateAddress } from "@/lib/format";
import { getErrorMessage } from "@/lib/errors";

interface FreighterNetworkApi {
  setNetwork?: (network: string) => Promise<unknown>;
}

export function WalletConnect() {
  const {
    address,
    connected,
    connectWallet,
    disconnectWallet,
    loading,
    error: walletError,
    errorCode,
  } = useWallet();

  const network = useWalletStore((s) => s.network);
  const install = useFreighterInstallStatus();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [networkSwitchError, setNetworkSwitchError] = useState<string | null>(
    null,
  );

  const handleCopy = async () => {
    if (!address) return;

    try {
      setCopyError(null);
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError("Couldn't copy wallet address. Please try again.");
    }
  };

  const handleSwitchToTestnet = async () => {
    setSwitchingNetwork(true);
    setNetworkSwitchError(null);

    try {
      const freighter =
        (await import("@stellar/freighter-api")) as unknown as FreighterNetworkApi;

      if (typeof freighter.setNetwork !== "function") {
        throw new Error(
          "Your Freighter version does not support network switching from this app.",
        );
      }

      const response = await freighter.setNetwork("TESTNET");
      if (
        response &&
        typeof response === "object" &&
        "error" in response &&
        response.error
      ) {
        throw new Error(String(response.error));
      }

      await connectWallet();
    } catch (error) {
      setNetworkSwitchError(getErrorMessage(error));
    } finally {
      setSwitchingNetwork(false);
    }
  };

  // Not installed: explain, link to Freighter and recover once it appears.
  // (A connected session is never replaced by this state.)
  if (install.status === "not-installed" && !connected) {
    return (
      <FreighterInstallPrompt
        onRetry={install.retry}
        exhausted={install.exhausted}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      {/* Network Badge */}
      {connected && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {network === "testnet" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Testnet
              </span>
            ) : network === "mainnet" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Mainnet
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-amber-500/30 text-amber-500 hover:bg-amber-500/10 rounded-md font-mono"
                onClick={handleSwitchToTestnet}
                disabled={switchingNetwork}
              >
                {switchingNetwork && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {switchingNetwork ? "SWITCHING..." : "Switch to Testnet"}
              </Button>
            )}
          </div>

          {networkSwitchError && (
            <div className="flex flex-col gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2">
              <span className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Open Freighter, switch its network to Testnet, then reconnect
                  your wallet.
                </span>
              </span>
              {networkSwitchError && <span>{networkSwitchError}</span>}
              <a
                href="https://www.freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold hover:underline"
              >
                <span>Open Freighter</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {connected && address ? (
          <div className="flex items-center gap-2 bg-neutral-900 border border-border rounded-lg pl-3 pr-1 py-1 transition-all duration-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold font-mono text-slate-300">
              {truncateAddress(address)}
            </span>

            <button
              onClick={handleCopy}
              className="p-1.5 text-slate-500 hover:text-teal-400 transition-colors"
              title="Copy Address"
              aria-label="Copy wallet address"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>

            <div className="w-px h-4 bg-border mx-1" />

            <button
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              onClick={disconnectWallet}
              title="Disconnect Wallet"
              aria-label="Disconnect wallet"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Button
            onClick={connectWallet}
            disabled={loading}
            className="bg-primary hover:bg-primary-hover text-black font-bold transition-all duration-200 flex items-center gap-2 rounded-lg px-4 py-2 shadow-[0_0_15px_rgba(0,212,170,0.15)]"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wallet className="h-4 w-4" />
            )}
            <span>{loading ? "CONNECTING..." : "CONNECT WALLET"}</span>
          </Button>
        )}
      </div>

      {walletError && errorCode === "user_rejected" && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-xs">
            You cancelled the connection request
          </span>
        </div>
      )}

      {copyError && (
        <div
          role="alert"
          className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-2.5 py-1"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{copyError}</span>
        </div>
      )}

      {walletError && errorCode === "not_installed" && (
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1 hover:bg-amber-500/20 transition-all"
        >
          <span>Install Freighter</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {walletError &&
        errorCode !== "user_rejected" &&
        errorCode !== "not_installed" && (
          <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-2.5 py-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-xs">{walletError}</span>
          </div>
        )}
    </div>
  );
}
