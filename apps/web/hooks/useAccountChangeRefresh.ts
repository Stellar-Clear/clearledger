import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletStore } from "@/store/wallet";
import { getFreighterPublicKey } from "@/lib/freighter";
import {
  clearAccountScopedQueries,
  isValidAccountAddress,
} from "@/lib/accountChange";
import { createErrorHandler } from "@/lib/errors";

const { captureError } = createErrorHandler("useAccountChangeRefresh");

/**
 * Keeps account-dependent state in sync with the account selected in Freighter.
 * Mount once inside the QueryClientProvider.
 *
 * - Whenever the store's active address changes (from the Freighter watcher in
 *   `useWallet`, a reconnect, or a disconnect/lock), everything cached for the
 *   previous address is cancelled and removed. Queries are keyed by address,
 *   so balances and contract reads for the new address load fresh.
 * - On window focus / tab visibility it re-checks Freighter directly, as a
 *   fallback for when the polling watcher was throttled in a background tab.
 *   A different valid `G...` address is adopted; an empty answer (wallet
 *   locked) disconnects; invalid values and errors are ignored.
 */
export function useAccountChangeRefresh(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return useWalletStore.subscribe((state, prev) => {
      const previous = prev.address;
      if (previous && previous !== state.address) {
        void clearAccountScopedQueries(queryClient, previous).catch(
          captureError,
        );
      }
    });
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    let checkId = 0;

    const check = async () => {
      const startAddress = useWalletStore.getState().address;
      if (!useWalletStore.getState().connected || !startAddress) return;
      const id = ++checkId;

      let reported: string;
      try {
        reported = await getFreighterPublicKey();
      } catch (err) {
        captureError(err);
        return;
      }

      // Drop results from superseded checks, after unmount, or when the store
      // moved on (e.g. the watcher already switched accounts) while waiting.
      if (!active || id !== checkId) return;
      const state = useWalletStore.getState();
      if (!state.connected || state.address !== startAddress) return;

      if (typeof reported === "string" && reported.trim() === "") {
        state.disconnect();
        return;
      }
      if (!isValidAccountAddress(reported) || reported === state.address) return;

      state.setAddress(reported);
      state.setToken(null);
      void import("@/lib/api")
        .then(({ initApiClientWithToken }) => initApiClientWithToken())
        .catch(captureError);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onFocus = () => void check();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
