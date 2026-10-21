"use client";

import React, { useState } from "react";
import { PageLayout } from "@/components/shared/PageLayout";
import { useWalletStore } from "@/store/wallet";
import { useProfile } from "@/hooks/useProfile";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { WalletConnect } from "@/components/shared/WalletConnect";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import {
  TransactionPending,
  type TransactionPendingState,
} from "@/components/shared/TransactionPending";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  ShieldAlert,
  Building2,
  Globe,
  FileText,
  Calendar,
  Lock,
  UserCheck,
  FileBadge2,
  Building,
  Mail,
  Fingerprint,
  BellRing,
} from "lucide-react";

function NotificationPreferences({ address }: { address: string }) {
  const categories = [
    "Invoice Created",
    "Invoice Listed",
    "Invoice Funded",
    "Invoice Shipped",
    "Delivery Confirmed",
    "Invoice Repaid",
    "Invoice Defaulted",
  ];

  const storageKey = `clearledger_prefs_${address}`;
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    // Default to true for all
    const initial: Record<string, boolean> = {};
    categories.forEach((c) => (initial[c] = true));
    return initial;
  });

  const toggleCategory = (category: string) => {
    const nextPrefs = { ...prefs, [category]: !prefs[category] };
    setPrefs(nextPrefs);
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextPrefs));
    } catch {}
  };

  return (
    <div className="mt-8 space-y-4">
      <div className="border-b border-border/40 pb-2">
        <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white flex items-center gap-2">
          <BellRing className="w-4 h-4 text-primary" />
          Notification Preferences
        </h2>
        <p className="text-slate-500 text-[10px] font-mono mt-1">
          Choose which on-chain events trigger in-app notifications.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
        {categories.map((category) => (
          <div
            key={category}
            className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
          >
            <span className="text-slate-300 font-bold">{category}</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                aria-label={`${category} notifications`}
                checked={prefs[category] !== false}
                onChange={() => toggleCategory(category)}
              />
              <div className="w-9 h-5 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

const registryContractID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID || "";

export default function ProfilePage() {
  const { connected, address } = useWalletStore();
  const {
    profile,
    isProfileLoading,
    isVerified,
    isVerifiedLoading,
    register,
    isRegistering,
    registerError,
  } = useProfile();

  // Registration Form States
  const [showRegModal, setShowRegModal] = useState(false);

  // Modal Refs
  const modalRef = useFocusTrap<HTMLDivElement>(showRegModal, () =>
    setShowRegModal(false),
  );

  const [regRole, setRegRole] = useState<"issuer" | "buyer">("issuer");
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [country, setCountry] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Transaction Modal State
  const [showPending, setShowPending] = useState(false);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("Waiting for confirmation...");
  const [transactionState, setTransactionState] =
    useState<TransactionPendingState>("pending");

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
      setShowRegModal(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTransactionState("failed");
      setLocalError(message || "Registration transaction failed");
      setShowPending(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 10)}...${addr.slice(-10)}`;
  };

  if (!connected) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center text-center py-20 max-w-md mx-auto min-h-[70vh]">
          <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg mb-6 shadow-[0_0_20px_rgba(0,212,170,0.15)]">
            <Building2 className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-2xl font-bold font-mono tracking-wider text-white uppercase mb-2">
            Connect Your Wallet
          </h1>
          <p className="text-slate-400 text-xs font-mono mb-8 leading-relaxed">
            Connect your Freighter wallet to check your on-chain verification
            credentials, register a new business profile, or update your
            metadata.
          </p>
          <WalletConnect />
        </div>
      </PageLayout>
    );
  }

  const isLoading = isProfileLoading || isVerifiedLoading;

  return (
    <PageLayout>
      <div className="space-y-8 py-4 max-w-4xl mx-auto">
        {/* Header */}
        <div className="border-b border-border/40 pb-5">
          <h1 className="text-xl font-bold font-mono tracking-wider uppercase text-white">
            Business profile & Verification
          </h1>
          <p className="text-slate-500 text-xs font-mono mt-1">
            Manage your on-chain corporate credentials and verification states
            on the ClearLedger Registry contract.
          </p>
        </div>

        <ErrorBoundary context="ProfileContent">
          {isLoading ? (
            <div className="bg-[#0d131a] border border-border rounded-lg p-12 flex flex-col items-center justify-center space-y-4 font-mono text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
              <span className="text-slate-400 uppercase tracking-widest animate-pulse">
                Loading profile credentials...
              </span>
            </div>
          ) : profile ? (
            <div className="space-y-6">
              {/* Status Banner */}
              <div className="bg-[#0d131a] border border-border rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div
                    className={`p-3 rounded-lg border ${
                      isVerified
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    }`}
                  >
                    {isVerified ? (
                      <ShieldCheck className="w-6 h-6" />
                    ) : (
                      <ShieldAlert className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-500 uppercase">
                        Status:
                      </span>
                      <span
                        className={`text-xs font-mono font-bold uppercase ${
                          isVerified ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {isVerified ? "Verified Corporate" : "Pending Review"}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold font-mono text-white mt-0.5">
                      {profile.role === "issuer" ? "SME / Issuer" : "Buyer"}{" "}
                      Profile
                    </h2>
                    <p className="text-xs font-mono text-slate-400 mt-1">
                      Registered on Registry Contract • Address:{" "}
                      {address ? formatAddress(address) : "Address unavailable"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs border-border hover:bg-slate-900"
                    onClick={() => setShowRegModal(true)}
                  >
                    Update Metadata
                  </Button>
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#0d131a] border border-border rounded-lg p-6 space-y-4">
                  <h3 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider flex items-center gap-2">
                    <Building className="w-4 h-4 text-primary" />
                    Corporate Information
                  </h3>
                  <div className="space-y-3 text-xs font-mono">
                    <div className="flex justify-between py-2 border-b border-border/40">
                      <span className="text-slate-500">Role</span>
                      <span className="text-white uppercase font-bold">
                        {profile.role}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-border/40">
                      <span className="text-slate-500">Wallet Address</span>
                      <span className="text-slate-300">
                        {formatAddress(profile.address)}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-border/40">
                      <span className="text-slate-500">Registered At</span>
                      <span className="text-slate-300">
                        {new Date(
                          profile.registeredAt * 1000,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-[#0d131a] border border-border rounded-lg p-6 space-y-4">
                  <h3 className="text-xs font-bold font-mono uppercase text-slate-400 tracking-wider flex items-center gap-2">
                    <FileBadge2 className="w-4 h-4 text-primary" />
                    Verification Credentials
                  </h3>
                  <div className="space-y-3 text-xs font-mono">
                    <div className="flex justify-between py-2 border-b border-border/40">
                      <span className="text-slate-500">On-Chain Status</span>
                      <span
                        className={
                          isVerified
                            ? "text-emerald-400 font-bold"
                            : "text-amber-400 font-bold"
                        }
                      >
                        {isVerified ? "Verified" : "Unverified"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-border/40">
                      <span className="text-slate-500">Registry Contract</span>
                      <span
                        className="text-slate-300 truncate max-w-[180px]"
                        title={registryContractID}
                      >
                        {registryContractID
                          ? formatAddress(registryContractID)
                          : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-border/40">
                      <span className="text-slate-500">Network</span>
                      <span className="text-slate-300 uppercase">
                        Stellar Testnet
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Registration Prompt */
            <div className="bg-[#0d131a] border border-border rounded-lg p-8 md:p-12 text-center max-w-2xl mx-auto space-y-6">
              <div className="w-14 h-14 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center mx-auto text-primary">
                <Fingerprint className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold font-mono text-white">
                  No Business Profile Found
                </h2>
                <p className="text-xs font-mono text-slate-400 leading-relaxed">
                  Your connected wallet is not yet registered on the ClearLedger
                  Registry contract. Register as an SME Issuer to tokenize
                  invoices or as a Buyer to verify and settle them.
                </p>
              </div>
              <Button
                className="font-mono text-xs font-bold"
                onClick={() => setShowRegModal(true)}
              >
                Register Business Profile
              </Button>
            </div>
          )}
        </ErrorBoundary>

        {address && <NotificationPreferences address={address} />}

        {/* Registration / Update Modal */}
        {showRegModal && (
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="registration-dialog-title"
            tabIndex={-1}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <div className="bg-[#0d131a] border border-border rounded-lg p-6 md:p-8 max-w-lg w-full space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-border/40 pb-4">
                <h2
                  id="registration-dialog-title"
                  className="text-base font-bold font-mono text-white uppercase tracking-wider"
                >
                  {profile
                    ? "Update Public Profile Metadata"
                    : "Register Business Profile"}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowRegModal(false)}
                  aria-label="Close registration dialog"
                  className="text-slate-400 hover:text-white font-mono text-sm"
                >
                  ✕
                </button>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
                Profile metadata is public on Stellar. Use test data only; do not enter real tax identifiers, personal contact details or confidential business information. Newly registered profiles start unverified and require administrator approval.
              </div>

              {localError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono p-3 rounded-lg flex items-start gap-2"
                >
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{localError}</span>
                </div>
              )}

              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                {!profile && (
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-slate-400 uppercase">
                      Role
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRegRole("issuer")}
                        className={`py-2.5 px-4 rounded-lg font-mono text-xs font-bold border transition-all ${
                          regRole === "issuer"
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-slate-900 border-border text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        SME / Issuer
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegRole("buyer")}
                        className={`py-2.5 px-4 rounded-lg font-mono text-xs font-bold border transition-all ${
                          regRole === "buyer"
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-slate-900 border-border text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        Buyer
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-mono text-slate-400 uppercase">
                    Public Business Name (Test Data) *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Demo Trading Co."
                    className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono text-slate-400 uppercase">
                    Test Business Reference *
                  </label>
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    placeholder="e.g. TEST-12345"
                    className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono text-slate-400 uppercase">
                    Country (Test Data) *
                  </label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g. United States"
                    className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-slate-400 uppercase">
                      Public Business Website (Optional)
                    </label>
                    <input
                      type="text"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://acme.com"
                      className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono text-slate-400 uppercase">
                      Public Business Email (Optional)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="contact@acme.com"
                      className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
                  <Button
                    type="button"
                    variant="outline"
                    className="font-mono text-xs"
                    onClick={() => setShowRegModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="font-mono text-xs font-bold">
                    {profile ? "Save Changes" : "Submit Registration"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Transaction Pending Modal */}
        <TransactionPending
          isOpen={showPending}
          onClose={() => setShowPending(false)}
          statusText={pendingText}
          txHash={pendingHash}
          state={transactionState}
          errorText={localError ?? undefined}
        />
      </div>
    </PageLayout>
  );
}
