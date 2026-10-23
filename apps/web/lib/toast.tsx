import type { ReactNode } from "react";
import { toast } from "sonner";
import { stellarExpertTxUrl } from "@/lib/explorer";

function ToastAnnouncement({
  variant,
  action,
  children,
}: {
  variant: "success" | "error";
  action: string;
  children?: ReactNode;
}) {
  const isError = variant === "error";
  const prefix = isError
    ? "Transaction failed. Error: "
    : "Transaction confirmed. Success: ";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      aria-relevant="text"
      className="flex flex-col gap-1"
    >
      <span className="font-medium text-sm">
        <span className="sr-only">{prefix}</span>
        {action}
      </span>
      {children}
    </div>
  );
}

export function showSuccessToast(action: string, txHash?: string) {
  toast.success(
    <ToastAnnouncement variant="success" action={action}>
      {txHash ? (
        <span className="flex flex-col gap-1">
          <code className="select-all break-all text-[10px] font-mono text-slate-400" aria-label="Transaction hash">
            {txHash}
          </code>
          {stellarExpertTxUrl(txHash) ? (
            <a
              href={stellarExpertTxUrl(txHash) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80 text-xs font-mono"
            >
              View on Stellar Expert →
            </a>
          ) : null}
        </span>
      ) : null}
    </ToastAnnouncement>,
    {
      duration: 5000,
    },
  );
}

export function showErrorToast(action: string, error?: Error) {
  toast.error(
    <ToastAnnouncement variant="error" action={action}>
      {error?.message ? (
        <span className="text-xs font-mono text-red-400/80">
          {error.message}
        </span>
      ) : null}
    </ToastAnnouncement>,
    {
      duration: 6000,
    },
  );
}
