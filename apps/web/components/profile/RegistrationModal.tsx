"use client";

import React, { useEffect, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import {
  TransactionPending,
  type TransactionPendingState,
} from "@/components/shared/TransactionPending";
import { ShieldAlert, Building2, Globe, FileText, Lock } from "lucide-react";
import type { useProfile } from "@/hooks/useProfile";

interface RegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  register: ReturnType<typeof useProfile>["register"];
  isRegistering: boolean;
  registerError: ReturnType<typeof useProfile>["registerError"];
}

export function RegistrationModal({
  isOpen,
  onClose,
  register,
  isRegistering,
  registerError,
}: RegistrationModalProps) {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, onClose, {
    inertBackground: true,
  });

  const [regRole, setRegRole] = useState<"issuer" | "buyer">("issuer");
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [country, setCountry] = useState("");
  const [website, setWebsite] = useState("");
  const [email] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const [showPending, setShowPending] = useState(false);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("Waiting for confirmation...");
  const [transactionState, setTransactionState] =
    useState<TransactionPendingState>("pending");

  // Clear any stale error from a previous attempt each time the dialog opens.
  useEffect(() => {
    if (isOpen) setLocalError(null);
  }, [isOpen]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!companyName.trim()) {
      setLocalError("Company name is required");
      return;
    }
    if (!taxId.trim()) {
      setLocalError("Test business reference is required");
      return;
    }
    if (!country.trim()) {
      setLocalError("Country of incorporation is required");
      return;
    }

    setPendingText(
      `Registering ${regRole === "issuer" ? "SME / issuer" : "buyer"} profile...`,
    );
    setPendingHash(null);
    setTransactionState("pending");
    setShowPending(true);

    try {
      const metadata: Record<string, string> = {
        companyName: companyName.trim(),
        taxId: taxId.trim(),
        country: country.trim(),
        website: website.trim(),
        email: email.trim(),
      };

      const txHash = await register({
        role: regRole,
        metadata,
      });

      setTransactionState("confirmed");
      if (typeof txHash === "string") {
        setPendingHash(txHash);
      }
      onClose();
    } catch (err: any) {
      setTransactionState("failed");
      setLocalError(err.message || "Registration transaction failed");
      setShowPending(false);
    }
  };

  return (
    <>
      {isOpen && (
        <ErrorBoundary context="RegistrationModal">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="registration-dialog-title"
            tabIndex={-1}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#080c10]/95 backdrop-blur-sm p-0 md:p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onClose();
              }
            }}
          >
            <div
              className="w-full max-w-lg max-h-[92vh] md:max-h-[85vh] overflow-y-auto overscroll-contain bg-card border md:border-border rounded-t-2xl md:rounded-lg p-6 relative shadow-[0_0_50px_rgba(0,212,170,0.05)]"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                onClick={onClose}
                aria-label="Close registration dialog"
                className="absolute top-3 right-3 min-h-[44px] px-2 text-slate-500 hover:text-white font-bold font-mono text-xs uppercase"
              >
                [Close]
              </button>

              <div className="mb-6 border-b border-border/40 pb-3">
                <h2
                  id="registration-dialog-title"
                  className="text-sm font-bold font-mono tracking-wider uppercase text-white flex items-center gap-1.5 pr-16"
                >
                  <Building2 className="w-4 h-4 text-primary" />
                  Register Business Profile
                </h2>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                  Profile metadata is permanently public on Stellar. Use test data only; do not enter real tax identifiers, personal contact details or confidential business information.
                </p>
              </div>

              <form
                onSubmit={handleRegisterSubmit}
                className="space-y-4 font-mono text-xs"
              >
                {/* Role Toggle Selector */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Select On-Chain Business Role
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRegRole("issuer")}
                      className={`py-2 px-3 border rounded text-center transition-all ${
                        regRole === "issuer"
                          ? "border-primary bg-primary/5 text-primary font-bold"
                          : "border-border bg-transparent text-slate-400 hover:text-white hover:bg-slate-900/40"
                      }`}
                    >
                      SME / Issuer
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegRole("buyer")}
                      className={`py-2 px-3 border rounded text-center transition-all ${
                        regRole === "buyer"
                          ? "border-primary bg-primary/5 text-primary font-bold"
                          : "border-border bg-transparent text-slate-400 hover:text-white hover:bg-slate-900/40"
                      }`}
                    >
                      Obligor / Buyer
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Public business name (test data)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Demo Trading Co."
                    className="w-full bg-[#080c10] border border-border rounded px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                  />
                </div>

                {/* Public test reference and country */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Test Business Reference
                    </label>
                    <div className="relative">
                      <FileText className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. TEST-12345"
                        className="w-full bg-[#080c10] border border-border rounded pl-10 pr-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        value={taxId}
                        onChange={(e) => setTaxId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Country of Incorporation
                    </label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Germany"
                        className="w-full bg-[#080c10] border border-border rounded pl-10 pr-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Website URL */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Public Business Website (Optional)
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="url"
                      placeholder="e.g. https://acme.corp"
                      className="w-full bg-[#080c10] border border-border rounded pl-10 pr-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </div>
                </div>

                {/* Warnings and errors */}
                {(localError || registerError) && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[11px] flex items-start gap-2"
                  >
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {localError ||
                        (registerError as any)?.message ||
                        "Failed to submit registration"}
                    </span>
                  </div>
                )}

                <div className="bg-[#080c10] border border-amber-500/20 p-3 rounded text-[10px] text-amber-500 leading-normal flex items-start gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Freighter will show the transaction for your approval. The
                    profile starts unverified; the protocol administrator must
                    verify it before gated actions are available.
                  </span>
                </div>

                {/* Buttons */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 border border-border bg-transparent hover:bg-slate-900 text-slate-400 font-bold uppercase py-2.5 rounded"
                    disabled={isRegistering}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-primary hover:bg-primary-hover text-black font-bold uppercase py-2.5 rounded shadow-[0_0_15px_rgba(0,212,170,0.15)] flex items-center justify-center gap-1.5"
                    disabled={isRegistering}
                  >
                    {isRegistering ? "Signing..." : "Register Profile"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ErrorBoundary>
      )}

      {/* Transaction Pending Dialog Modal */}
      <TransactionPending
        isOpen={showPending}
        txHash={pendingHash}
        statusText={pendingText}
        state={transactionState}
        errorText={
          localError ||
          (registerError as Error | null | undefined)?.message ||
          undefined
        }
        onClose={
          pendingHash
            ? () => {
                setShowPending(false);
                onClose();
              }
            : undefined
        }
      />
    </>
  );
}
