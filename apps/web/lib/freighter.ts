import {
  isConnected,
  requestAccess,
  getPublicKey,
  getNetworkDetails,
} from "@stellar/freighter-api";

/**
 * Machine-readable failure codes for Freighter interactions:
 * - `"user_rejected"` — the user denied the access request.
 * - `"not_installed"` — the Freighter extension is unavailable.
 * - `"unknown"` — any other unexpected failure.
 */
export type FreighterErrorCode = "user_rejected" | "not_installed" | "unknown";

interface FreighterConnectedResponse {
  isConnected?: boolean;
}

interface FreighterAccessResponse {
  address?: string;
  error?: string;
}

/**
 * Error thrown by the Freighter helpers, carrying a machine-readable
 * `code` in addition to the standard error `message`.
 */
export class FreighterError extends Error {
  readonly code: FreighterErrorCode;
  constructor(code: FreighterErrorCode, message: string) {
    super(message);
    this.name = "FreighterError";
    this.code = code;
  }
}

function classifyFreighterError(err: unknown): FreighterErrorCode {
  if (err instanceof FreighterError) return err.code;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("user rejected") ||
      msg.includes("user rejected this request")
    ) {
      return "user_rejected";
    }
    if (msg.includes("not installed") || msg.includes("internal error")) {
      return "not_installed";
    }
  }
  return "unknown";
}

function mapFreighterError(err: unknown): FreighterError {
  if (err instanceof FreighterError) return err;
  const code = classifyFreighterError(err);
  const message = err instanceof Error ? err.message : String(err);
  return new FreighterError(code, message);
}

/**
 * Checks whether the Freighter wallet extension is installed and
 * connected in the browser.
 *
 * Handles both the legacy boolean response and the newer
 * `{ isConnected }` response shape. Never throws — failures are logged
 * and reported as `false`.
 *
 * @returns `true` when Freighter reports a connection, `false` otherwise
 *   (including when the extension is absent or the check itself fails).
 *
 * @example
 * ```ts
 * const installed = await isFreighterInstalled();
 * if (!installed) {
 *   // Prompt the user to install Freighter.
 * }
 * ```
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const res = await isConnected();
    if (typeof res === "boolean") {
      return res;
    }
    if (res && typeof res === "object" && "isConnected" in res) {
      return !!(res as FreighterConnectedResponse).isConnected;
    }
    return false;
  } catch (err) {
    console.error("Failed to check if Freighter is installed:", err);
    return false;
  }
}

/**
 * Connects to the Freighter wallet and requests account access from the
 * user, showing the Freighter approval popup.
 *
 * @returns The connected Stellar public key (address) as a string.
 *
 * @throws `FreighterError` with code `"not_installed"` when Freighter is
 *   missing, `"user_rejected"` when the user denies the request, or
 *   `"unknown"` for any other failure.
 *
 * @example
 * ```ts
 * try {
 *   const address = await connectFreighter();
 *   useWalletStore.getState().connect(address, "testnet");
 * } catch (err) {
 *   if (err instanceof FreighterError && err.code === "user_rejected") {
 *     // The user cancelled the connection request.
 *   }
 * }
 * ```
 */
export async function connectFreighter(): Promise<string> {
  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new FreighterError(
      "not_installed",
      "Freighter wallet is not installed",
    );
  }

  try {
    const res = await requestAccess();
    if (typeof res === "string") {
      return res;
    }
    if (res && typeof res === "object") {
      const accessRes = res as FreighterAccessResponse;
      if (accessRes.address) {
        return accessRes.address;
      }
      if (accessRes.error) {
        throw mapFreighterError(new Error(accessRes.error));
      }
    }
    throw new FreighterError("unknown", "No address returned from Freighter");
  } catch (err) {
    console.error("Failed to connect to Freighter:", err);
    throw mapFreighterError(err);
  }
}

/**
 * A snapshot of what Freighter currently reports for the connected session.
 * `address` is the selected account, `network` the lower-cased network name
 * (e.g. `'testnet'`, `'public'`), or `null` when unreadable.
 */
export interface FreighterSnapshot {
  address: string | null;
  network: string | null;
}

/**
 * A difference reported by {@link watchFreighterChanges}. Only the fields that
 * actually changed are populated; `previous` is the snapshot the watcher
 * started from (i.e. the state the app believed until this change).
 */
export interface FreighterWalletChange {
  address?: string;
  network?: string;
  previous: FreighterSnapshot;
}

/** Options accepted by {@link watchFreighterChanges}. */
export interface WatchFreighterOptions {
  /** Poll interval in milliseconds. Defaults to `3000`. */
  intervalMs?: number;
  /** Receives failures from a poll. Polling keeps running after an error. */
  onError?: (error: unknown) => void;
}

const DEFAULT_WATCH_INTERVAL_MS = 3000;

/** Normalizes a Freighter network name to a trimmed, lower-cased string. */
function normalizeNetwork(network?: string): string | null {
  const normalized = network?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Polls Freighter for account/network changes and reports diffs — the
 * equivalent of the `WatchWalletChanges` helper (not exported by the pinned
 * `@stellar/freighter-api` v2 API), which issue #873 requires so the app never
 * keeps a stale address or a stale "Testnet" badge after the user switches
 * accounts or networks inside the extension.
 *
 * The first poll runs immediately, comparing against `baseline`; afterwards it
 * runs every `intervalMs`. Overlapping polls are skipped, poll failures are
 * routed to `onError` without stopping the watcher, and a stopped watcher
 * never fires `onChange` again.
 *
 * @param baseline — Snapshot captured at connect time (usually the store's
 *   current `address`/`network`).
 * @param onChange — Called once per detected difference.
 * @param options — See {@link WatchFreighterOptions}.
 * @returns A stop function that clears the timer and silences in-flight polls.
 *
 * @example
 * ```ts
 * const stop = watchFreighterChanges({ address, network }, (change) => {
 *   if (change.address) useWalletStore.getState().setAddress(change.address);
 * });
 * // later
 * stop();
 * ```
 */
export function watchFreighterChanges(
  baseline: FreighterSnapshot,
  onChange: (change: FreighterWalletChange) => void,
  options: WatchFreighterOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  let previous: FreighterSnapshot = {
    address: baseline.address,
    network: baseline.network,
  };
  let stopped = false;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const [address, details] = await Promise.all([
        getPublicKey(),
        getNetworkDetails(),
      ]);
      if (stopped) return;

      const next: FreighterSnapshot = {
        address: address || null,
        network: normalizeNetwork(details?.network),
      };
      const change: FreighterWalletChange = { previous };
      let changed = false;

      if (next.address && next.address !== previous.address) {
        change.address = next.address;
        changed = true;
      }
      if (next.network && next.network !== previous.network) {
        change.network = next.network;
        changed = true;
      }

      if (changed) {
        previous = next;
        onChange(change);
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      polling = false;
    }
  };

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Retrieves the public key of the account currently selected in Freighter
 * without prompting for a new access approval.
 *
 * @returns The Stellar public key of the selected Freighter account.
 *
 * @throws `FreighterError` with code `"not_installed"` when Freighter is
 *   missing, or `"unknown"` when no public key can be returned.
 */
export async function getFreighterPublicKey(): Promise<string> {
  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new FreighterError(
      "not_installed",
      "Freighter wallet is not installed",
    );
  }

  try {
    const res = await getPublicKey();
    if (typeof res === "string") {
      return res;
    }
    if (res && typeof res === "object" && "address" in res) {
      return (res as { address: string }).address;
    }
    throw new FreighterError(
      "unknown",
      "No public key returned from Freighter",
    );
  } catch (err) {
    console.error("Failed to get public key from Freighter:", err);
    throw mapFreighterError(err);
  }
}

/**
 * Result of {@link checkFreighterAvailability}:
 * - `"installed"` — the extension responded (it may still be locked or
 *   disconnected; that is handled later by the connect flow).
 * - `"not-installed"` — the extension reported itself absent, or never
 *   answered within the timeout (nothing is injected to answer the request).
 * - `"error"` — the check itself threw. This is deliberately NOT treated as
 *   "not installed" so a transient failure never tells an installed user to
 *   install the extension.
 */
export type FreighterAvailability = "installed" | "not-installed" | "error";

/** Default time to wait for the extension to answer a presence check. */
export const FREIGHTER_DETECT_TIMEOUT_MS = 3000;

/**
 * Detects whether the Freighter extension is present, distinguishing
 * "absent" from "check failed". Never throws and never hangs: the
 * `@stellar/freighter-api` presence check relies on an injected content
 * script, so it is raced against a timeout.
 *
 * @param timeoutMs — How long to wait before concluding nothing answered.
 */
export async function checkFreighterAvailability(
  timeoutMs: number = FREIGHTER_DETECT_TIMEOUT_MS,
): Promise<FreighterAvailability> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const res = await Promise.race([isConnected(), timeout]);
    if (res === "timeout") return "not-installed";
    if (typeof res === "boolean") return res ? "installed" : "not-installed";
    if (res && typeof res === "object" && "isConnected" in res) {
      return (res as FreighterConnectedResponse).isConnected
        ? "installed"
        : "not-installed";
    }
    return "not-installed";
  } catch (err) {
    console.error("Failed to detect Freighter:", err);
    return "error";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
