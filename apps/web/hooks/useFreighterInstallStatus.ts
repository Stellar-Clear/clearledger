import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkFreighterAvailability,
  type FreighterAvailability,
} from "@/lib/freighter";

/** Delay between automatic re-checks while the extension is missing. */
export const INSTALL_POLL_INTERVAL_MS = 2000;
/** Maximum number of automatic re-checks after the first check (~20s). */
export const INSTALL_POLL_MAX_ATTEMPTS = 10;

export type FreighterInstallState = "checking" | FreighterAvailability;

/**
 * Tracks whether the Freighter extension is installed and recovers when it
 * appears after the page rendered.
 *
 * While the extension is missing it re-checks on a bounded poll
 * ({@link INSTALL_POLL_MAX_ATTEMPTS} attempts), on window focus and when the
 * tab becomes visible, and on demand via `retry`. Once detected (or on
 * unmount) all timers and listeners are removed.
 *
 * @returns
 *   - `status` — `"checking"`, `"installed"`, `"not-installed"` or `"error"`.
 *   - `exhausted` — `true` when automatic polling gave up; the extension may
 *     only inject on page load, so the UI should suggest refreshing.
 *   - `retry` — re-run detection now and restart the bounded polling.
 */
export function useFreighterInstallStatus() {
  const [status, setStatus] = useState<FreighterInstallState>("checking");
  const [exhausted, setExhausted] = useState(false);
  const attemptsRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRef = useRef<(poll: boolean) => Promise<void>>(async () => {});

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const check = useCallback(async (poll: boolean) => {
    if (inFlightRef.current || !mountedRef.current) return;
    inFlightRef.current = true;
    let result: FreighterAvailability;
    try {
      result = await checkFreighterAvailability();
    } finally {
      inFlightRef.current = false;
    }
    if (!mountedRef.current) return;
    setStatus(result);
    clearTimer();
    if (result !== "not-installed") {
      setExhausted(false);
      return;
    }
    if (poll) attemptsRef.current += 1;
    if (attemptsRef.current >= INSTALL_POLL_MAX_ATTEMPTS) {
      setExhausted(true);
      return;
    }
    timerRef.current = setTimeout(
      () => void checkRef.current(true),
      INSTALL_POLL_INTERVAL_MS,
    );
  }, []);
  checkRef.current = check;

  useEffect(() => {
    mountedRef.current = true;
    void check(false);
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [check]);

  const missing = status === "not-installed";
  useEffect(() => {
    if (!missing) return;
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      void checkRef.current(false);
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [missing]);

  const retry = useCallback(() => {
    attemptsRef.current = 0;
    setExhausted(false);
    clearTimer();
    void checkRef.current(false);
  }, []);

  return { status, exhausted, retry };
}
