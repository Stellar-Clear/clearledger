"use client";

import React from "react";
import { X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useConfirmDialogStore } from "@/store/confirmDialog";
import { truncateAddress } from "@/lib/format";

export function ConfirmationDialog() {
  const { pendingAction, cancel } = useConfirmDialogStore();
  const overlayRef = useFocusTrap<HTMLDivElement>(!!pendingAction, cancel);

  if (!pendingAction) return null;

  const handleConfirm = () => {
    const action = pendingAction;
    cancel();
    action.fn();
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={cancel}
    >
      <div
        className="w-full max-w-sm bg-[#0d131a] border border-border rounded-lg p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <h4
            id="confirmation-dialog-title"
            className="text-sm font-bold font-mono text-white uppercase tracking-wider"
          >
            Confirm {pendingAction.label}
          </h4>
          <button
            onClick={cancel}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Close confirmation dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2 mb-5 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-500">Action:</span>
            <span className="text-slate-200">{pendingAction.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice ID:</span>
            <span className="text-slate-200" title={pendingAction.invoiceId}>
              {truncateAddress(pendingAction.invoiceId)}
            </span>
          </div>
          {pendingAction.contractId && (
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-slate-500">Contract:</span>
              <span className="truncate text-right text-slate-200" title={pendingAction.contractId}>
                {truncateAddress(pendingAction.contractId)}
              </span>
            </div>
          )}
          {pendingAction.asset && (
            <div className="flex justify-between">
              <span className="text-slate-500">Asset:</span>
              <span className="text-slate-200">{pendingAction.asset}</span>
            </div>
          )}
          {pendingAction.amount && (
            <div className="flex justify-between">
              <span className="text-slate-500">Amount:</span>
              <span className="text-slate-200">{pendingAction.amount}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Estimated Fee:</span>
            <span className="text-slate-200">Network fee applies</span>
          </div>
        </div>

        <p className="text-[10px] text-amber-500/90 font-mono mb-4 leading-normal">
          This action is irreversible once submitted on-chain. Review carefully
          before confirming.
        </p>

        <div className="flex gap-2">
          <Button
            className="flex-1 border border-border bg-transparent hover:bg-slate-900 text-slate-300 text-[10px] font-bold uppercase py-2"
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold uppercase py-2"
            onClick={handleConfirm}
          >
            CONFIRM
          </Button>
        </div>
      </div>
    </div>
  );
}
