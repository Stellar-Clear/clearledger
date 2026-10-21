/** Abort a wallet preparation request when the connection changes. */
export function abortPendingTransaction(controller: AbortController | null): void {
  if (controller && !controller.signal.aborted) controller.abort("wallet disconnected");
}
