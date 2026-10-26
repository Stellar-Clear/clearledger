import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNetworkDetails } from "@stellar/freighter-api";
import { useWallet } from "./useWallet";
import { useWalletStore } from "@/store/wallet";
import {
  connectFreighter,
  watchFreighterChanges,
  FreighterError,
} from "@/lib/freighter";
import { initApiClientWithToken } from "@/lib/api";
import { useBalances } from "./useBalances";
import { Keypair } from "@stellar/stellar-sdk";

vi.mock("@/lib/freighter", () => ({
  connectFreighter: vi.fn(),
  watchFreighterChanges: vi.fn(),
  FreighterError: class FreighterError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "FreighterError";
      this.code = code;
    }
  },
}));

vi.mock("@/lib/api", () => ({
  initApiClientWithToken: vi.fn(),
}));

vi.mock("@stellar/freighter-api", () => ({
  getNetworkDetails: vi.fn().mockResolvedValue({ network: "testnet" }),
}));

vi.mock("./useBalances", () => ({
  useBalances: vi.fn(),
}));

vi.mock("@stellar/freighter-api", () => ({
  getNetworkDetails: vi.fn().mockResolvedValue({ network: "testnet" }),
}));

const CHANGED_ADDRESS = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 7),
).publicKey();

describe("useWallet", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    useWalletStore.getState().disconnect();
    // Default watcher wiring: capture the change callback so tests can drive
    // it, and hand back a stop spy for cleanup assertions.
    vi.mocked(watchFreighterChanges).mockImplementation(() => () => {});
    vi.mocked(useBalances).mockReturnValue({
      balances: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    } as any);
  });

  it("initial state", () => {
    const { result } = renderHook(() => useWallet());
    expect(result.current.connected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("connectWallet succeeds", async () => {
    vi.mocked(connectFreighter).mockResolvedValue("G12345");

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(connectFreighter).toHaveBeenCalled();
    expect(result.current.connected).toBe(true);
    expect(result.current.address).toBe("G12345");
    expect(result.current.network).toBe("testnet");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("connects when Freighter PUBLIC matches the app Mainnet configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "mainnet");
    vi.mocked(connectFreighter).mockResolvedValue("G12345");
    vi.mocked(getNetworkDetails).mockResolvedValue({
      network: "PUBLIC",
    } as any);

    const { result } = renderHook(() => useWallet());
    await act(async () => result.current.connectWallet());

    expect(result.current.connected).toBe(true);
    expect(result.current.network).toBe("mainnet");
    expect(useWalletStore.getState().network).toBe("mainnet");
  });

  it("explains the actual wallet and app networks on a mismatch", async () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "mainnet");
    vi.mocked(connectFreighter).mockResolvedValue("G12345");
    vi.mocked(getNetworkDetails).mockResolvedValue({
      network: "TESTNET",
    } as any);

    const { result } = renderHook(() => useWallet());
    await act(async () => result.current.connectWallet());

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toMatch(
      /wallet is on Testnet, but this app is configured for Mainnet/i,
    );
    expect(result.current.errorCode).toBe("wrong_network");
  });

  it("connectWallet shows loading during connection", async () => {
    let resolveConnect: (v: string) => void;
    vi.mocked(connectFreighter).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveConnect = resolve;
        }),
    );

    const { result } = renderHook(() => useWallet());

    let promise: Promise<void>;
    act(() => {
      promise = result.current.connectWallet();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveConnect!("G12345");
      await promise!;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.connected).toBe(true);
  });

  it("connectWallet fails with Error", async () => {
    vi.mocked(connectFreighter).mockRejectedValue(
      new Error("Freighter wallet is not installed"),
    );

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.error).toBe("Freighter wallet is not installed");
    expect(result.current.connected).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it("connectWallet fails with non-Error rejection", async () => {
    vi.mocked(connectFreighter).mockRejectedValue("User rejected request");

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.error).toBe("User rejected request");
    expect(result.current.connected).toBe(false);
  });

  it("clears previous error on retry", async () => {
    vi.mocked(connectFreighter).mockRejectedValueOnce(
      new Error("First failure"),
    );

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });
    expect(result.current.error).toBe("First failure");

    vi.mocked(connectFreighter).mockResolvedValueOnce("G12345");

    await act(async () => {
      await result.current.connectWallet();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.connected).toBe(true);
  });

  it("handles Freighter unavailable", async () => {
    vi.mocked(connectFreighter).mockRejectedValue(
      new Error("Freighter wallet is not installed"),
    );

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.error).toBe("Freighter wallet is not installed");
    expect(result.current.connected).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it("sets errorCode to user_rejected when user rejects", async () => {
    const mockFreighterError = new FreighterError(
      "user_rejected",
      "The user rejected this request.",
    );
    vi.mocked(connectFreighter).mockRejectedValue(mockFreighterError);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.error).toBe("The user rejected this request.");
    expect(result.current.errorCode).toBe("user_rejected");
    expect(result.current.connected).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it("sets errorCode to not_installed when Freighter is not installed", async () => {
    const mockFreighterError = new FreighterError(
      "not_installed",
      "Freighter wallet is not installed",
    );
    vi.mocked(connectFreighter).mockRejectedValue(mockFreighterError);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.error).toBe("Freighter wallet is not installed");
    expect(result.current.errorCode).toBe("not_installed");
    expect(result.current.connected).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it("sets errorCode to unknown for unmapped Freighter errors", async () => {
    const mockFreighterError = new FreighterError(
      "unknown",
      "Unexpected failure",
    );
    vi.mocked(connectFreighter).mockRejectedValue(mockFreighterError);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.error).toBe("Unexpected failure");
    expect(result.current.errorCode).toBe("unknown");
    expect(result.current.connected).toBe(false);
  });

  it("clears errorCode on successful connection", async () => {
    const mockFreighterError = new FreighterError(
      "user_rejected",
      "The user rejected this request.",
    );
    vi.mocked(connectFreighter)
      .mockRejectedValueOnce(mockFreighterError)
      .mockResolvedValueOnce("G12345");

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connectWallet();
    });
    expect(result.current.errorCode).toBe("user_rejected");

    await act(async () => {
      await result.current.connectWallet();
    });
    expect(result.current.errorCode).toBeNull();
    expect(result.current.connected).toBe(true);
  });

  it("disconnectWallet works", () => {
    act(() => {
      useWalletStore.getState().connect("G123", "testnet");
    });

    const { result } = renderHook(() => useWallet());
    expect(result.current.connected).toBe(true);

    act(() => {
      result.current.disconnectWallet();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("exposes balances from useBalances", () => {
    vi.mocked(useBalances).mockReturnValue({
      balances: { usdc: "100", xlm: "50" },
      loading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    const { result } = renderHook(() => useWallet());
    expect(result.current.balances).toEqual({ usdc: "100", xlm: "50" });
    expect(result.current.balancesLoading).toBe(false);
    expect(result.current.balancesError).toBeNull();
  });
});

interface WalletChange {
  address?: string;
  network?: string;
  previous: { address: string | null; network: string | null };
}

interface WatchCapture {
  stop: ReturnType<typeof vi.fn>;
  change: (change: WalletChange) => void;
}

/**
 * Replaces the default watcher mock with one that captures the change
 * callback (issue #873's "mock the watcher callback") and returns a stop spy.
 */
function captureWatcher(): WatchCapture {
  const stop = vi.fn();
  let captured: ((change: WalletChange) => void) | undefined;
  vi.mocked(watchFreighterChanges).mockImplementation((_base, onChange) => {
    captured = onChange;
    return stop;
  });
  return {
    stop,
    change: (change) => {
      if (!captured) {
        throw new Error("watchFreighterChanges callback was not captured");
      }
      captured(change);
    },
  };
}

describe("useWallet Freighter change watching (#873)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWalletStore.getState().disconnect();
    vi.mocked(watchFreighterChanges).mockImplementation(() => () => {});
    vi.mocked(useBalances).mockReturnValue({
      balances: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    } as any);
  });

  it("does not watch Freighter while disconnected", () => {
    renderHook(() => useWallet());

    expect(watchFreighterChanges).not.toHaveBeenCalled();
  });

  it("starts watching from the store snapshot once connected", () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });

    renderHook(() => useWallet());

    expect(watchFreighterChanges).toHaveBeenCalledTimes(1);
    expect(watchFreighterChanges).toHaveBeenCalledWith(
      { address: "G12345", network: "testnet" },
      expect.any(Function),
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("adopts a changed Freighter address and drops the previous token", async () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
      useWalletStore.getState().setToken("jwt-for-G12345");
    });
    const watcher = captureWatcher();

    renderHook(() => useWallet());

    await act(async () => {
      watcher.change({
        address: CHANGED_ADDRESS,
        previous: { address: "G12345", network: "testnet" },
      });
    });

    const state = useWalletStore.getState();
    expect(state.address).toBe(CHANGED_ADDRESS);
    expect(state.connected).toBe(true);
    expect(state.token).toBeNull();
    // The API client re-sync happens through a lazy import of lib/api.
    await vi.waitFor(() => {
      expect(initApiClientWithToken).toHaveBeenCalled();
    });
  });

  it("ignores a changed address that is not a valid account StrKey", async () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });
    const watcher = captureWatcher();
    renderHook(() => useWallet());

    await act(async () => {
      watcher.change({
        address: "not-a-stellar-address",
        previous: { address: "G12345", network: "testnet" },
      });
    });

    expect(useWalletStore.getState().address).toBe("G12345");
  });

  it("restarts the watcher from the new address after a change", () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });
    const watcher = captureWatcher();

    renderHook(() => useWallet());
    expect(watchFreighterChanges).toHaveBeenCalledTimes(1);

    act(() => {
      watcher.change({
        address: CHANGED_ADDRESS,
        previous: { address: "G12345", network: "testnet" },
      });
    });

    expect(watchFreighterChanges).toHaveBeenCalledTimes(2);
    expect(watchFreighterChanges).toHaveBeenLastCalledWith(
      { address: CHANGED_ADDRESS, network: "testnet" },
      expect.any(Function),
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("surfaces the wrong-network error when Freighter leaves testnet", () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });
    const watcher = captureWatcher();

    const { result } = renderHook(() => useWallet());

    act(() => {
      watcher.change({
        network: "public",
        previous: { address: "G12345", network: "testnet" },
      });
    });

    expect(useWalletStore.getState().network).toBe("mainnet");
    expect(result.current.error).toMatch(/wrong network/i);
    expect(result.current.errorCode).toBe("wrong_network");
  });

  it("clears the watcher's wrong-network error when Freighter returns to testnet", () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });
    const watcher = captureWatcher();

    const { result } = renderHook(() => useWallet());

    act(() => {
      watcher.change({
        network: "public",
        previous: { address: "G12345", network: "testnet" },
      });
    });
    expect(result.current.errorCode).toBe("wrong_network");

    act(() => {
      watcher.change({
        network: "testnet",
        previous: { address: "G12345", network: "public" },
      });
    });

    expect(useWalletStore.getState().network).toBe("testnet");
    expect(result.current.error).toBeNull();
    expect(result.current.errorCode).toBeNull();
  });

  it("stops watching when the hook unmounts", () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });
    const watcher = captureWatcher();

    const { unmount } = renderHook(() => useWallet());
    expect(watcher.stop).not.toHaveBeenCalled();

    unmount();

    expect(watcher.stop).toHaveBeenCalledTimes(1);
  });

  it("stops watching after disconnect", () => {
    act(() => {
      useWalletStore.getState().connect("G12345", "testnet");
    });
    const watcher = captureWatcher();

    const { result } = renderHook(() => useWallet());
    expect(watcher.stop).not.toHaveBeenCalled();

    act(() => {
      result.current.disconnectWallet();
    });

    expect(watcher.stop).toHaveBeenCalledTimes(1);
    expect(watchFreighterChanges).toHaveBeenCalledTimes(1);
  });
});
