import { useEffect, useRef, useState } from "react";
import { getNetworkDetails } from "@stellar/freighter-api";
import { useWalletStore } from "@/store/wallet";
import {
  connectFreighter,
  watchFreighterChanges,
  FreighterError,
} from "@/lib/freighter";
import { useBalances } from "./useBalances";
import { createErrorHandler } from "@/lib/errors";
import { isValidAccountAddress } from "@/lib/accountChange";
import {
  getConfiguredStellarNetwork,
  normalizeStellarNetwork,
  stellarNetworkLabel,
} from "@/lib/stellarNetwork";

const { captureError } = createErrorHandler("useWallet");
const WRONG_NETWORK_ERROR_CODE = "wrong_network";
const WRONG_NETWORK_ERROR_PREFIX = "Freighter network mismatch:";

function wrongNetworkErrorMessage(actual: string | null, expected: string) {
  return `${WRONG_NETWORK_ERROR_PREFIX} wallet is on ${stellarNetworkLabel(actual)}, but this app is configured for ${stellarNetworkLabel(expected)}. This is the wrong network for this app; switch Freighter to ${stellarNetworkLabel(expected)} and reconnect.`;
}

interface FreighterNetworkDetails {
  network?: string;
}

async function validateFreighterNetwork(
  expectedNetwork: string,
): Promise<void> {
  const details = (await getNetworkDetails()) as FreighterNetworkDetails;
  const network = normalizeStellarNetwork(details.network);

  if (network !== expectedNetwork) {
    const error = new Error(
      wrongNetworkErrorMessage(network, expectedNetwork),
    ) as Error & {
      code: string;
    };
    error.code = WRONG_NETWORK_ERROR_CODE;
    throw error;
  }
}

/**
 * Custom hook for managing Stellar wallet connection via Freighter.
 *
 * Provides wallet state and actions to connect or disconnect a Freighter wallet.
 * Connection follows `NEXT_PUBLIC_STELLAR_NETWORK` and verifies that Freighter
 * uses that same network before the wallet is stored as connected.
 * While connected, the hook also watches Freighter for account/network changes
 * (issue #873): the store is updated when the selected account changes, and a
 * wrong-network error is surfaced when Freighter leaves testnet.
 *
 * @returns An object containing:
 *   - `address` — The connected wallet's public key, or `null` if not connected.
 *   - `connected` — Whether a wallet is currently connected.
 *   - `network` — The active network identifier (e.g. `'testnet'`).
 *   - `connectWallet` — Async function that opens Freighter and connects the wallet.
 *   - `disconnectWallet` — Function that disconnects the current wallet.
 *   - `loading` — `true` while a connection attempt is in progress.
 *   - `error` — Error message string if the last connection attempt failed, otherwise `null`.
 *
 * @throws Will catch errors from Freighter and surface them via the `error` return value
 *   rather than throwing to the caller.
 *
 * @example
 * const { address, connected, connectWallet, disconnectWallet, loading, error } = useWallet();
 */
export function useWallet() {
  const address = useWalletStore((s) => s.address);
  const connected = useWalletStore((s) => s.connected);
  const network = useWalletStore((s) => s.network);
  const connect = useWalletStore((s) => s.connect);
  const disconnect = useWalletStore((s) => s.disconnect);
  const setAddress = useWalletStore((s) => s.setAddress);
  const setNetwork = useWalletStore((s) => s.setNetwork);
  const setToken = useWalletStore((s) => s.setToken);
  const appNetwork = getConfiguredStellarNetwork();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const {
    balances,
    loading: balancesLoading,
    error: balancesError,
    refetch: refetchBalances,
  } = useBalances();

  /**
   * Initiates a Freighter wallet connection.
   *
   * Sets `loading` to `true` during the attempt. On success, stores the wallet
   * address and defaults the network to `'testnet'`. The connection is rejected
   * if Freighter reports a different active network.
   */
  const connectingRef = useRef(false);

  const connectWallet = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const addr = await connectFreighter();
      await validateFreighterNetwork(appNetwork);
      connect(addr, appNetwork);
    } catch (err: unknown) {
      const appError = captureError(err);
      setError(appError.message);
      if (err instanceof FreighterError) {
        setErrorCode(err.code);
      } else if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        typeof err.code === "string"
      ) {
        setErrorCode(err.code);
      }
      disconnect();
    } finally {
      setLoading(false);
      connectingRef.current = false;
    }
  };

  // Freighter exposes no change subscription in the pinned API version, so a
  // connected session would otherwise keep showing (and signing with) the
  // account and network captured at connect time. Poll for diffs while
  // connected and reconcile the store with what the extension reports.
  useEffect(() => {
    if (!connected || !address) return;

    return watchFreighterChanges(
      { address, network },
      (change) => {
        const state = useWalletStore.getState();
        if (!state.connected) return;

        if (
          isValidAccountAddress(change.address) &&
          change.address !== state.address
        ) {
          // A different account is now selected in Freighter: adopt it so the
          // app never reads balances for — or signs as — a stale address, and
          // drop the previous account's SEP-10 token.
          setAddress(change.address);
          setToken(null);
          // lib/api caches that token for the API client, but importing it
          // statically would pull the SDK into this hook's graph (see #995),
          // which is only warranted on this rare account-switch path.
          void import("@/lib/api")
            .then(({ initApiClientWithToken }) => initApiClientWithToken())
            .catch((err) => captureError(err));
        }

        const activeNetwork = normalizeStellarNetwork(change.network);
        if (activeNetwork && activeNetwork !== state.network) {
          setNetwork(activeNetwork);

          if (activeNetwork !== appNetwork) {
            setError(wrongNetworkErrorMessage(activeNetwork, appNetwork));
            setErrorCode(WRONG_NETWORK_ERROR_CODE);
          } else {
            // Freighter is back on the app network: clear the banner only
            // if it is the one this watcher raised.
            setError((current) =>
              current?.startsWith(WRONG_NETWORK_ERROR_PREFIX) ? null : current,
            );
            setErrorCode((current) =>
              current === WRONG_NETWORK_ERROR_CODE ? null : current,
            );
          }
        }
      },
      { onError: captureError },
    );
  }, [
    connected,
    address,
    network,
    appNetwork,
    setAddress,
    setNetwork,
    setToken,
    captureError,
  ]);

  /**
   * Disconnects the currently connected wallet by clearing wallet state from the store.
   */
  const disconnectWallet = () => {
    disconnect();
  };

  return {
    address,
    connected,
    network,
    connectWallet,
    disconnectWallet,
    loading,
    error,
    errorCode,
    balances,
    balancesLoading,
    balancesError,
    refetchBalances,
  };
}
