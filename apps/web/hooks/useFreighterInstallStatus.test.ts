import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useFreighterInstallStatus,
  INSTALL_POLL_INTERVAL_MS,
  INSTALL_POLL_MAX_ATTEMPTS,
} from "./useFreighterInstallStatus";
import { checkFreighterAvailability } from "@/lib/freighter";

vi.mock("@/lib/freighter", () => ({
  checkFreighterAvailability: vi.fn(),
}));

const check = vi.mocked(checkFreighterAvailability);

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useFreighterInstallStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    check.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports installed and does not poll", async () => {
    check.mockResolvedValue("installed");
    const { result } = renderHook(() => useFreighterInstallStatus());
    await tick();
    expect(result.current.status).toBe("installed");
    await tick(INSTALL_POLL_INTERVAL_MS * 5);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("starts in checking state", () => {
    check.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useFreighterInstallStatus());
    expect(result.current.status).toBe("checking");
  });

  it("reports not-installed when the extension is absent", async () => {
    check.mockResolvedValue("not-installed");
    const { result } = renderHook(() => useFreighterInstallStatus());
    await tick();
    expect(result.current.status).toBe("not-installed");
    expect(result.current.exhausted).toBe(false);
  });

  it("recovers when the extension injects late (polling)", async () => {
    check
      .mockResolvedValueOnce("not-installed")
      .mockResolvedValueOnce("not-installed")
      .mockResolvedValue("installed");
    const { result } = renderHook(() => useFreighterInstallStatus());
    await tick();
    expect(result.current.status).toBe("not-installed");
    await tick(INSTALL_POLL_INTERVAL_MS * 2);
    expect(result.current.status).toBe("installed");
    const calls = check.mock.calls.length;
    await tick(INSTALL_POLL_INTERVAL_MS * 5);
    expect(check).toHaveBeenCalledTimes(calls);
  });

  it("bounds automatic retries and then flags exhausted", async () => {
    check.mockResolvedValue("not-installed");
    const { result } = renderHook(() => useFreighterInstallStatus());
    await tick(INSTALL_POLL_INTERVAL_MS * (INSTALL_POLL_MAX_ATTEMPTS + 10));
    expect(check).toHaveBeenCalledTimes(1 + INSTALL_POLL_MAX_ATTEMPTS);
    expect(result.current.exhausted).toBe(true);
    expect(result.current.status).toBe("not-installed");
  });

  it("manual retry restarts bounded polling and can recover", async () => {
    check.mockResolvedValue("not-installed");
    const { result } = renderHook(() => useFreighterInstallStatus());
    await tick(INSTALL_POLL_INTERVAL_MS * (INSTALL_POLL_MAX_ATTEMPTS + 1));
    expect(result.current.exhausted).toBe(true);

    check.mockResolvedValue("installed");
    act(() => result.current.retry());
    await tick();
    expect(result.current.status).toBe("installed");
    expect(result.current.exhausted).toBe(false);
  });

  it("re-checks on window focus and visibility change while missing", async () => {
    check.mockResolvedValue("not-installed");
    renderHook(() => useFreighterInstallStatus());
    await tick();
    check.mockClear();
    check.mockResolvedValue("installed");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("re-checks on visibilitychange when the tab is visible", async () => {
    check.mockResolvedValue("not-installed");
    renderHook(() => useFreighterInstallStatus());
    await tick();
    check.mockClear();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not treat a detection error as not-installed or poll", async () => {
    check.mockResolvedValue("error");
    const { result } = renderHook(() => useFreighterInstallStatus());
    await tick(INSTALL_POLL_INTERVAL_MS * 3);
    expect(result.current.status).toBe("error");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not run overlapping checks", async () => {
    let resolve!: (v: "not-installed") => void;
    check.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useFreighterInstallStatus());
    act(() => result.current.retry());
    act(() => result.current.retry());
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => resolve("not-installed"));
  });

  it("cleans up timers and listeners on unmount", async () => {
    check.mockResolvedValue("not-installed");
    const { unmount } = renderHook(() => useFreighterInstallStatus());
    await tick();
    const calls = check.mock.calls.length;
    unmount();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await tick(INSTALL_POLL_INTERVAL_MS * 5);
    expect(check).toHaveBeenCalledTimes(calls);
  });

  it("ignores a result that resolves after unmount", async () => {
    let resolve!: (v: "installed") => void;
    check.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderHook(() => useFreighterInstallStatus());
    unmount();
    await act(async () => resolve("installed"));
    await tick(INSTALL_POLL_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
