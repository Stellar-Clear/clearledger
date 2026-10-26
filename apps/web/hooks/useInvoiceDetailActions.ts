import { useState } from "react";
import { useInvoiceActions } from "@/hooks/useInvoices";
import { useConfirmDialogStore } from "@/store/confirmDialog";
import { getTransactionFailureMessage } from "@/lib/walletFailure";

/**
 * Owns the ship/confirm/repay/default invoice-status-transition actions for
 * the invoice detail page: the confirmation-dialog wiring, the shared
 * submitting/error/transaction-pending state, and the mutation calls
 * themselves.
 *
 * @param invoiceId - The invoice these actions apply to.
 * @param refetch - Called after a successful action to refresh invoice data
 *   (typically `useInvoice(invoiceId).refetch`).
 */
export function useInvoiceDetailActions(
  invoiceId: string,
  refetch: () => Promise<unknown>,
) {
  const { shipInvoice, confirmDelivery, repayInvoice, defaultInvoice } =
    useInvoiceActions();
  const { request: requestConfirmation } = useConfirmDialogStore();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPending, setShowPending] = useState(false);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("Waiting for confirmation...");

  const handleAction = async (
    actionFn: () => Promise<unknown>,
    text: string,
    errorMsg: string,
  ) => {
    setSubmitting(true);
    setError(null);
    setPendingText(text);
    setPendingHash(null);
    setShowPending(true);

    try {
      const res = await actionFn();
      if (typeof res === "string") {
        setPendingHash(res);
      }
      await refetch();
    } catch (err: unknown) {
      setError(getTransactionFailureMessage(err, errorMsg));
      setShowPending(false);
    } finally {
      setSubmitting(false);
    }
  };

  const ship = () =>
    requestConfirmation({
      label: "Mark Goods Shipped",
      invoiceId,
      fn: () =>
        handleAction(
          () => shipInvoice({ invoiceId }),
          "Marking goods as shipped...",
          "Unable to mark goods as shipped.",
        ),
    });

  const confirm = () =>
    requestConfirmation({
      label: "Confirm Delivery",
      invoiceId,
      fn: () =>
        handleAction(
          () => confirmDelivery({ invoiceId }),
          "Confirming delivery...",
          "Unable to confirm delivery.",
        ),
    });

  const repay = () =>
    requestConfirmation({
      label: "Repay Invoice",
      invoiceId,
      fn: () =>
        handleAction(
          () => repayInvoice({ invoiceId }),
          "Repaying invoice...",
          "Unable to repay invoice.",
        ),
    });

  const markDefault = () =>
    requestConfirmation({
      label: "Default Invoice",
      invoiceId,
      fn: () =>
        handleAction(
          () => defaultInvoice({ invoiceId }),
          "Defaulting invoice...",
          "Unable to default invoice.",
        ),
    });

  return {
    submitting,
    error,
    showPending,
    pendingHash,
    pendingText,
    setShowPending,
    ship,
    confirm,
    repay,
    markDefault,
  };
}
