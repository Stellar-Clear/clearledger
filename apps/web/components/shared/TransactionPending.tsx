"use client";

import React, { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, ExternalLink, ShieldCheck } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export type TransactionPendingState = "pending" | "confirmed" | "failed";

interface TransactionPendingProps {
  isOpen: boolean;
  txHash: string | null;
  statusText?: string;
  /**
   * Explicit lifecycle state for the announcement. When omitted, the state is
   * inferred from the dialog props: a timeout is "failed", a transaction hash
   * is "confirmed", and everything else is "pending".
   */
  state?: TransactionPendingState;
  /** Optional failure detail announced assertively when the state is failed. */
  errorText?: string;
  onClose?: () => void;
}

function resolveLifecycleState(
  state: TransactionPendingState | undefined,
  timedOut: boolean,
  txHash: string | null,
): TransactionPendingState {
  // Terminal states supplied by the caller are authoritative. A timeout only
  // applies while the transaction is still pending.
  if (state === "confirmed" || state === "failed") return state;
  if (timedOut) return "failed";
  return txHash ? "confirmed" : "pending";
}

function getAnnouncement(
  state: TransactionPendingState,
  statusText: string,
  errorText: string | undefined,
  timedOut: boolean,
) {
  if (state === "failed") {
    const reason =
      errorText ||
      (timedOut
        ? "Confirmation timed out. You can close and check status manually."
        : statusText);
    return `Transaction failed. ${reason}`;
  }

  if (state === "confirmed") {
    return "Transaction confirmed.";
  }

  return `Transaction pending. ${statusText}`;
}

export function TransactionPending({
  isOpen,
  txHash,
  statusText = "Waiting for confirmation...",
  state,
  errorText,
  onClose,
}: TransactionPendingProps) {
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // Respect the OS-level reduced-motion preference: the orbiting marker is
  // rendered statically instead of looping indefinitely.
  const shouldReduceMotion = useReducedMotion();

  // Only allow dismissal (Escape / backdrop click) after the transaction has
  // completed, i.e. when a hash or terminal state is available.
  const canDismiss = Boolean(onClose)
    ? timedOut || state === "confirmed" || state === "failed" || Boolean(txHash)
    : false;

  const overlayRef = useFocusTrap<HTMLDivElement>(
    isOpen,
    canDismiss ? onClose : undefined,
  );

  // Register a global Escape-key listener that dismisses the dialog only
  // after the transaction has completed or timed out.
  React.useEffect(() => {
    if (!canDismiss) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose!();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [canDismiss, onClose]);

  // Timeout logic: if modal stays open for 60s without a tx hash, mark as timed out.
  React.useEffect(() => {
    if (!isOpen || txHash || state === "confirmed" || state === "failed") {
      setTimedOut(false);
      return;
    }
    setTimedOut(false);
    setLocalStatus("Waiting for confirmation...");
    const timer = setTimeout(() => {
      setTimedOut(true);
      setLocalStatus(
        "Confirmation timed out. You can close and check status manually.",
      );
    }, 60_000);
    return () => clearTimeout(timer);
  }, [isOpen, txHash, state]);

  if (!isOpen) return null;

  const lifecycleState = resolveLifecycleState(state, timedOut, txHash);
  const announcement = getAnnouncement(
    lifecycleState,
    statusText,
    errorText,
    timedOut,
  );

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Transaction Pending"
      tabIndex={-1}
      // Backdrop click dismisses the dialog only after the transaction
      // completes. Clicks that bubble up from children are ignored.
      onClick={(e) => {
        if (canDismiss && e.target === e.currentTarget) onClose!();
      }}
      // Keyboard handler satisfies jsx-a11y/click-events-have-key-events.
      onKeyDown={(e) => {
        if (e.key === "Escape" && canDismiss) onClose!();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#080c10]/95 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-card border border-border rounded-lg p-6 flex flex-col items-center justify-center text-center shadow-[0_0_50px_rgba(0,212,170,0.05)]">
        {/*
          Lifecycle announcements live in visually hidden, pre-existing regions
          so state changes are announced without moving focus. Only one region
          carries text for a given state, which prevents duplicate speech.
        */}
        <div className="sr-only">
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-relevant="text"
            data-testid="transaction-status-polite"
            data-state={lifecycleState}
          >
            {lifecycleState === "failed" ? "" : announcement}
          </p>
          <p
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            aria-relevant="text"
            data-testid="transaction-status-assertive"
            data-state={lifecycleState}
          >
            {lifecycleState === "failed" ? announcement : ""}
          </p>
        </div>

        {/* Animated Stellar Orbit Logo */}
        <div className="relative w-28 h-28 flex items-center justify-center mb-6">
          {/* Central Core */}
          <div className="w-12 h-12 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>

          {/* Orbital path */}
          <div className="absolute w-24 h-24 rounded-full border border-border/30 border-dashed" />

          {/* Orbiting Moon */}
          <motion.div
            data-testid="transaction-pending-orbit"
            className="absolute w-3 h-3 rounded-full bg-primary"
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    rotate: 360,
                  }
            }
            transition={{
              repeat: shouldReduceMotion ? 0 : Infinity,
              duration: 4,
              ease: "linear",
            }}
            style={{
              originX: "50%",
              originY: "50%",
              width: "96px", // spans outer bounds
              height: "12px",
            }}
          />
        </div>

        <h3 className="text-md font-bold font-mono tracking-wider text-white uppercase mb-2">
          TRANSACTION SIGNED
        </h3>
        <p className="text-slate-400 text-xs font-mono mb-6 flex items-center gap-1.5 justify-center">
          <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none text-primary" />
          {timedOut ? localStatus || statusText : statusText}
        </p>

        {txHash && (
          <div className="w-full bg-[#080c10] border border-border/40 rounded p-3 text-left font-mono text-[10px] space-y-2 mb-6">
            <div className="flex justify-between text-slate-500 font-bold uppercase tracking-wider">
              <span>TX HASH</span>
              <span className="text-primary">TESTNET</span>
            </div>
            <div className="text-slate-300 break-all bg-slate-950/50 p-2 border border-border/20 rounded select-all">
              {txHash}
            </div>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline hover:text-primary-hover font-bold"
            >
              <span>VIEW ON STELLAR EXPERT</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {onClose && (
          <Button
            className="w-full bg-slate-900 border border-border text-slate-300 font-bold text-xs uppercase py-2 hover:bg-slate-800"
            onClick={onClose}
          >
            Close Dialog
          </Button>
        )}
      </div>
    </div>
  );
}

// Simple button helper to bypass standard UI import issues
function Button({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className: string;
  onClick?: () => void;
}) {
  return (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
}
