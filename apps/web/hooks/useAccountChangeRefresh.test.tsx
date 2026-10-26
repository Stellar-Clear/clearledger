import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccountChangeRefresh } from "./useAccountChangeRefresh";
import { useWalletStore } from "@/store/wallet";
import { getFreighterPublicKey } from "@/lib/freighter";

vi.mock("@/lib/freighter", () => ({ getFreighterPublicKey: vi.fn() }));
vi.mock("@/lib/api", () => ({ initApiClientWithToken: vi.fn() }));

const A = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const B = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const C = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

async function focus() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

describe("useAccountChangeRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient();
    act(() => {
      useWalletStore.getState().disconnect();
      useWalletStore.getState().connect(A, "testnet");
    });
    qc.setQueryData(["balances", A, true], { xlm: "1" });
    qc.setQueryData(["poolStats"], 1);
  });
  afterEach(() => vi.restoreAllMocks());

  it("clears the old account's cache when the address changes A -> B", async () => {
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await act(async () => {
      useWalletStore.getState().setAddress(B);
    });
    expect(qc.getQueryData(["balances", A, true])).toBeUndefined();
    expect(qc.getQueryData(["poolStats"])).toBe(1);
  });

  it("clears on disconnect / lock", async () => {
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await act(async () => {
      useWalletStore.getState().disconnect();
    });
    expect(qc.getQueryData(["balances", A, true])).toBeUndefined();
  });

  it("does not clear when the same address is set again", async () => {
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await act(async () => {
      useWalletStore.getState().setAddress(A);
    });
    expect(qc.getQueryData(["balances", A, true])).toEqual({ xlm: "1" });
  });

  it("adopts a new valid address on window focus", async () => {
    vi.mocked(getFreighterPublicKey).mockResolvedValue(B);
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    expect(useWalletStore.getState().address).toBe(B);
    expect(qc.getQueryData(["balances", A, true])).toBeUndefined();
  });

  it("adopts a new address when the tab becomes visible", async () => {
    vi.mocked(getFreighterPublicKey).mockResolvedValue(B);
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(useWalletStore.getState().address).toBe(B);
  });

  it("does nothing when the address is unchanged on focus", async () => {
    vi.mocked(getFreighterPublicKey).mockResolvedValue(A);
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    expect(useWalletStore.getState().address).toBe(A);
    expect(qc.getQueryData(["balances", A, true])).toEqual({ xlm: "1" });
  });

  it("ignores an invalid address on focus", async () => {
    vi.mocked(getFreighterPublicKey).mockResolvedValue("garbage");
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    expect(useWalletStore.getState().address).toBe(A);
  });

  it("disconnects when Freighter reports an empty address (locked)", async () => {
    vi.mocked(getFreighterPublicKey).mockResolvedValue("");
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    expect(useWalletStore.getState().connected).toBe(false);
    expect(useWalletStore.getState().address).toBeNull();
    expect(qc.getQueryData(["balances", A, true])).toBeUndefined();
  });

  it("keeps state when the Freighter check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getFreighterPublicKey).mockRejectedValue(new Error("boom"));
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    expect(useWalletStore.getState().address).toBe(A);
    expect(useWalletStore.getState().connected).toBe(true);
  });

  it("does not check Freighter while disconnected", async () => {
    act(() => useWalletStore.getState().disconnect());
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    expect(getFreighterPublicKey).not.toHaveBeenCalled();
  });

  it("rapid changes: only the latest check result wins", async () => {
    const resolvers: Array<(v: string) => void> = [];
    vi.mocked(getFreighterPublicKey).mockImplementation(
      () => new Promise<string>((r) => resolvers.push(r)),
    );
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    await focus();
    await act(async () => {
      resolvers[1](C);
      resolvers[0](B); // stale, resolves after the newer check
    });
    expect(useWalletStore.getState().address).toBe(C);
  });

  it("discards a check result if the store changed account meanwhile", async () => {
    let resolve!: (v: string) => void;
    vi.mocked(getFreighterPublicKey).mockImplementation(
      () => new Promise<string>((r) => (resolve = r)),
    );
    renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    act(() => useWalletStore.getState().setAddress(C));
    await act(async () => resolve(B));
    expect(useWalletStore.getState().address).toBe(C);
  });

  it("removes listeners and ignores in-flight results after unmount", async () => {
    let resolve!: (v: string) => void;
    vi.mocked(getFreighterPublicKey).mockImplementation(
      () => new Promise<string>((r) => (resolve = r)),
    );
    const { unmount } = renderHook(() => useAccountChangeRefresh(), { wrapper });
    await focus();
    unmount();
    await act(async () => resolve(B));
    expect(useWalletStore.getState().address).toBe(A);

    vi.mocked(getFreighterPublicKey).mockClear();
    await focus();
    expect(getFreighterPublicKey).not.toHaveBeenCalled();
    act(() => useWalletStore.getState().setAddress(B));
    expect(qc.getQueryData(["balances", A, true])).toEqual({ xlm: "1" });
  });
});
