/**
 * Maps a failed wallet or transaction attempt to one of four UI messages, so
 * users can tell a cancellation from a wallet problem, a network problem, or a
 * contract rejection.
 *
 * Order matters: a cancellation wins over everything, then contract errors
 * (which also mention "simulation" or "RPC" in some messages), then network
 * errors, then wallet errors.
 */

export type WalletFailureKind = "cancelled" | "wallet" | "rpc" | "contract" | "unknown";

export interface WalletFailure {
  kind: WalletFailureKind;
  message: string;
}

const CANCELLED = /user (declined|rejected|cancell?ed)|request (was )?(declined|rejected|cancell?ed)|user denied/i;
const CONTRACT = /hosterror|error\(contract|contract error|simulation (failed|error)|transaction failed|tx_failed/i;
const RPC = /rpc|network|timeout|timed out|failed to fetch|could not reach/i;
const WALLET = /freighter|wallet (not|is not) (installed|connected|available)|no wallet|extension/i;

const MESSAGES: Record<WalletFailureKind, string> = {
  cancelled: "You cancelled the request in your wallet. Nothing was submitted.",
  wallet: "Your wallet is not available or not connected. Check the wallet extension and try again.",
  rpc: "Stellar RPC could not be reached or timed out. Check your connection and try again.",
  contract: "The contract rejected this transaction. Review the inputs and try again.",
  unknown: "Something went wrong. Try again.",
};

/**
 * @example
 * ```ts
 * describeWalletFailure(new Error("User declined the request")).kind; // "cancelled"
 * describeWalletFailure("Stellar RPC timed out").kind;                // "rpc"
 * ```
 */
export function describeWalletFailure(error: unknown): WalletFailure {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  let kind: WalletFailureKind = "unknown";
  if (CANCELLED.test(text)) kind = "cancelled";
  else if (CONTRACT.test(text)) kind = "contract";
  else if (RPC.test(text)) kind = "rpc";
  else if (WALLET.test(text)) kind = "wallet";

  return { kind, message: MESSAGES[kind] };
}
