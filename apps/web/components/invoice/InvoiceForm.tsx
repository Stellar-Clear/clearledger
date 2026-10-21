"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useInvoiceActions } from "@/hooks/useInvoices";
import { Button } from "@/components/ui/button";
import { ShieldAlert, PlusCircle } from "lucide-react";
import type { AssetType } from "@/types";
import { ASSET_OPTIONS } from "@/lib/assets";
import { AmountInput } from "@/components/shared/AmountInput";
import { useWalletStore } from "@/store/wallet";
import { useProfile } from "@/hooks/useProfile";
import { DatePicker } from "@/components/ui/date-picker";
import { getErrorMessage } from "@/lib/errors";
import { SupportDiagnostics } from "@/components/shared/SupportDiagnostics";

const invoiceContractID = process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID || "";

const getStellarSdk = () => import("@stellar/stellar-sdk");
const getClearLedgerSdk = () => import("@clearledger/sdk");

interface InvoiceFormProps {
  onSuccess?: () => void;
}

/**
 * Mark an invoice as cancelled after its off-chain creation succeeds but its
 * immediate on-chain listing cannot be completed. This keeps the API state
 * from presenting the invoice as waiting for a listing transaction forever.
 */
async function cancelCreatedInvoice(invoiceId: string) {
  const response = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Cancelled" }),
    },
  );

  if (!response.ok) {
    throw new Error(`Invoice cleanup failed (${response.status})`);
  }
}

export function InvoiceForm({ onSuccess }: InvoiceFormProps) {
  const { createInvoice, isCreating, listInvoice } = useInvoiceActions();
  const address = useWalletStore((s) => s.address);
  const { profile, isProfileLoading, isVerified } = useProfile();
  const isIssuerReady = profile?.role === "issuer" && isVerified;

  const [buyer, setBuyer] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [asset, setAsset] = useState<AssetType>("USDC");
  const [dueDate, setDueDate] = useState("");
  const [discountBps, setDiscountBps] = useState(200);
  const [listAtCreation, setListAtCreation] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [isListing, setIsListing] = useState(false);
  const [timeZone, setTimeZone] = useState("your local timezone");

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "local time");
  }, []);

  const parsedValue = useMemo(
    () => parseFloat(faceValue.replace(/,/g, "")) || 0,
    [faceValue],
  );
  const discountPaid = useMemo(
    () => parsedValue * (discountBps / 10000),
    [parsedValue, discountBps],
  );
  const payoutAmount = useMemo(
    () => parsedValue - discountPaid,
    [parsedValue, discountPaid],
  );

  const handleNextStep = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!isIssuerReady) {
      setError("Register and verify this wallet as an issuer before creating an invoice.");
      return;
    }

    const trimmedBuyer = buyer.trim();
    const { StrKey } = await getStellarSdk();
    if (!trimmedBuyer || !StrKey.isValidEd25519PublicKey(trimmedBuyer)) {
      setError(
        "Buyer must be a valid Stellar public key (G... account address)",
      );
      return;
    }
    if (trimmedBuyer !== buyer) setBuyer(trimmedBuyer);

    if (parsedValue <= 0) {
      setError("Face value must be a positive number");
      return;
    }

    if (!dueDate) {
      setError("Please select a due date");
      return;
    }

    // A date-only selection is an invoice calendar date, not a local instant.
    // Keep comparisons and the on-chain timestamp anchored at UTC midnight.
    const selectedDate = new Date(`${dueDate}T00:00:00.000Z`);
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    if (selectedDate.getTime() <= today.getTime()) {
      setError("Due date must be in the future");
      return;
    }

    const minDate = new Date(today);
    minDate.setUTCDate(minDate.getUTCDate() + 7);
    const maxDate = new Date(today);
    maxDate.setUTCDate(maxDate.getUTCDate() + 365);
    if (selectedDate.getTime() < minDate.getTime()) {
      setError("Due date must be at least 7 days from today");
      return;
    }
    if (selectedDate.getTime() > maxDate.getTime()) {
      setError("Due date must be within 365 days from today");
      return;
    }

    setStep(2);
  };

  const handleCreate = async () => {
    setError(null);
    let createdInvoiceId: string | null = null;
    let listingFailed = false;

    try {
      const faceValueStroops = BigInt(
        Math.floor(parsedValue * 10_000_000),
      ).toString();
      const dueDateTimestamp = Math.floor(
        new Date(`${dueDate}T00:00:00.000Z`).getTime() / 1000,
      );

      const response = await createInvoice({
        buyer,
        faceValue: faceValueStroops,
        dueDate: dueDateTimestamp,
        asset,
      });

      createdInvoiceId = response.invoice_id || null;
      if (!createdInvoiceId) {
        throw new Error("Invoice creation did not return a valid invoice ID");
      }
      if (!response.transaction_hash) {
        throw new Error("Invoice creation did not return a transaction hash");
      }

      if (listAtCreation) {
        listingFailed = true;
        setIsListing(true);

        if (!address) {
          throw new Error("Connect your wallet before listing the invoice");
        }

        try {
          const [{ InvoiceClient }, { xdr, nativeToScVal }] = await Promise.all(
            [getClearLedgerSdk(), getStellarSdk()],
          );
          const invoiceClient = new InvoiceClient(invoiceContractID);
          const args = [
            xdr.ScVal.scvBytes(Buffer.from(createdInvoiceId, "hex")),
            nativeToScVal(discountBps, { type: "u32" }),
          ];

          await invoiceClient.simulateTransaction(
            "list_for_financing",
            args,
            address,
          );
        } catch (simulationError: unknown) {
          throw new Error(
            `Simulation failed: ${getErrorMessage(simulationError)}`,
          );
        }

        await listInvoice({
          invoiceId: createdInvoiceId,
          discountBps,
        });
        listingFailed = false;
      }

      setBuyer("");
      setFaceValue("");
      setDueDate("");
      setStep(1);
      onSuccess?.();
    } catch (creationOrListingError: unknown) {
      const originalMessage = getErrorMessage(creationOrListingError);

      if (createdInvoiceId && listingFailed) {
        try {
          await cancelCreatedInvoice(createdInvoiceId);
          setError(
            `${originalMessage}. The created invoice was cancelled and will not remain pending listing.`,
          );
        } catch (cleanupError: unknown) {
          setError(
            `${originalMessage}. We could not automatically cancel the created invoice; please refresh and contact support if it remains visible.`,
          );
          console.error("Failed to cancel invoice after listing failure", {
            invoiceId: createdInvoiceId,
            error: cleanupError,
          });
        }
      } else {
        setError(originalMessage);
      }
    } finally {
      setIsListing(false);
    }
  };

  const isBusy = isCreating || isListing;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-4 border-b border-border/40 pb-3">
        <PlusCircle className="w-4 h-4 text-primary shrink-0" />
        <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-white">
          Create trade Invoice
        </h2>
      </div>

      <div className="flex items-center gap-2 mb-5 px-1">
        <div
          className={`flex items-center gap-1.5 ${step === 1 ? "text-primary" : "text-emerald-400"}`}
        >
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono border ${step === 1 ? "bg-primary/20 border-primary text-primary" : "bg-emerald-400/20 border-emerald-400 text-emerald-400"}`}
          >
            1
          </div>
          <span className="text-[10px] font-bold font-mono uppercase tracking-wider">
            Terms
          </span>
        </div>
        <div
          className={`flex-1 h-px mx-1 ${step === 2 ? "bg-emerald-400/50" : "bg-border"}`}
        />
        <div
          className={`flex items-center gap-1.5 ${step === 2 ? "text-primary" : "text-slate-500"}`}
        >
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono border ${step === 2 ? "bg-primary/20 border-primary text-primary" : "bg-slate-800 border-border text-slate-500"}`}
          >
            2
          </div>
          <span className="text-[10px] font-bold font-mono uppercase tracking-wider">
            Sign
          </span>
        </div>
      </div>

      {step === 1 ? (
        <form onSubmit={handleNextStep} className="space-y-4">
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-border bg-[#080c10] px-3 py-2 text-xs font-mono"
          >
            <span className="text-slate-400">Issuer readiness: </span>
            {isProfileLoading ? (
              <span className="text-slate-300">Checking registry…</span>
            ) : isIssuerReady ? (
              <span className="text-emerald-400">Registered and verified</span>
            ) : (
              <span className="text-amber-400">
                {profile?.role === "issuer"
                  ? "Registered, verification pending"
                  : profile?.role === "buyer"
                    ? "This wallet is registered as a buyer"
                    : "This wallet is not registered as an issuer"}
              </span>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider">
              Buyer Wallet Address
            </label>
            <input
              type="text"
              placeholder="e.g. GBBD47IF6L... (Stellar Public Key)"
              className="w-full bg-[#080c10] border border-border rounded px-3 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all min-h-[44px]"
              value={buyer}
              onChange={(event) => setBuyer(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1">
              <AmountInput
                value={faceValue}
                onChange={setFaceValue}
                asset={asset}
                label="Face Value"
                placeholder="50,000.00"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider">
                Asset
              </label>
              <select
                value={asset}
                onChange={(event) => setAsset(event.target.value as AssetType)}
                className="w-full bg-[#080c10] border border-border rounded px-3 py-2.5 text-white text-xs font-mono min-h-[44px]"
              >
                {ASSET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider">
                Due Date
              </label>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                minDate={new Date()}
              />
              <span className="text-[10px] font-mono text-slate-500 block mt-1">
                Select invoice maturity date
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-border/30">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-slate-500 font-bold uppercase tracking-wider">
                Financing Discount Rate
              </span>
              <span className="text-primary font-bold">
                {(discountBps / 100).toFixed(2)}% ({discountBps} bps)
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="500"
              step="10"
              value={discountBps}
              onChange={(event) =>
                setDiscountBps(parseInt(event.target.value, 10))
              }
              aria-label="Financing Discount Rate"
              className="w-full accent-primary bg-slate-900 h-2 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-600 font-mono">
              <span>0.5% (50 bps)</span>
              <span>5.0% (500 bps)</span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="listAtCreation"
              className="rounded bg-[#080c10] border-border text-primary w-5 h-5"
              checked={listAtCreation}
              onChange={(event) => setListAtCreation(event.target.checked)}
            />
            <label
              htmlFor="listAtCreation"
              className="text-xs font-mono text-slate-400 cursor-pointer select-none py-2"
            >
              List this invoice for financing after creation
            </label>
          </div>
          <p className="pl-8 text-[11px] leading-5 text-slate-500">
            Listing makes the invoice available for review; it does not guarantee funding.
          </p>

          {error && (
            <div className="p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono">{error}</span>
                <SupportDiagnostics error={error} contractId={invoiceContractID} />
              </div>
            </div>
          )}
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary-hover text-black font-bold uppercase tracking-wider text-xs rounded py-2.5 min-h-[44px]"
          >
            REVIEW FINANCING TERMS
          </Button>
        </form>
      ) : (
        <div className="space-y-4 font-mono text-xs">
          <div className="bg-[#080c10] border border-border p-4 rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Invoice Face Value:</span>
              <span className="text-white font-bold">
                {parsedValue.toLocaleString()} {asset}
              </span>
            </div>
            {listAtCreation && (
              <>
                <div className="flex justify-between text-rose-400">
                  <span>Discount ({(discountBps / 100).toFixed(2)}%):</span>
                  <span>
                    -{discountPaid.toLocaleString()} {asset}
                  </span>
                </div>
                <div className="border-t border-border/40 my-2 pt-2 flex justify-between text-emerald-400 font-bold">
                  <span>Indicative proceeds if funded:</span>
                  <span>
                    {payoutAmount.toLocaleString()} {asset}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Buyer:</span>
              <span className="text-white truncate max-w-[220px]">{buyer}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Due Date:</span>
              <span className="text-white">{dueDate}</span>
            </div>
            <p className="text-[10px] leading-4 text-slate-500">
              Stored as {dueDate} 00:00 UTC. Your local timezone is {timeZone}.
            </p>
          </div>
          {error && (
            <div className="p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono">{error}</span>
                <SupportDiagnostics error={error} contractId={invoiceContractID} />
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={isBusy}
              onClick={() => {
                setError(null);
                setStep(1);
              }}
            >
              BACK
            </Button>
            <Button
              type="button"
              className="flex-1 bg-primary hover:bg-primary-hover text-black font-bold"
              disabled={isBusy}
              onClick={handleCreate}
            >
              {isListing
                ? "LISTING..."
                : isCreating
                  ? "CREATING..."
                  : "CREATE INVOICE"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
