import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkFreighterAvailability } from "./freighter";
import { isConnected, getPublicKey } from "@stellar/freighter-api";

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getPublicKey: vi.fn(),
  getNetworkDetails: vi.fn(),
}));

const mockIsConnected = vi.mocked(isConnected) as unknown as ReturnType<
  typeof vi.fn
>;

describe("checkFreighterAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is installed when the extension answers true", async () => {
    mockIsConnected.mockResolvedValue(true);
    expect(await checkFreighterAvailability()).toBe("installed");
  });

  it("is installed for the { isConnected: true } shape, without prompting or reading accounts (locked wallet is not missing)", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    expect(await checkFreighterAvailability()).toBe("installed");
    expect(getPublicKey).not.toHaveBeenCalled();
  });

  it("is not-installed when the extension answers false", async () => {
    mockIsConnected.mockResolvedValue(false);
    expect(await checkFreighterAvailability()).toBe("not-installed");
    mockIsConnected.mockResolvedValue({ isConnected: false });
    expect(await checkFreighterAvailability()).toBe("not-installed");
  });

  it("is not-installed for an unrecognised response", async () => {
    mockIsConnected.mockResolvedValue(undefined);
    expect(await checkFreighterAvailability()).toBe("not-installed");
  });

  it("is not-installed when nothing answers before the timeout", async () => {
    mockIsConnected.mockReturnValue(new Promise(() => {}));
    const p = checkFreighterAvailability(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe("not-installed");
  });

  it("returns error (not not-installed) when the check throws", async () => {
    mockIsConnected.mockRejectedValue(new Error("boom"));
    expect(await checkFreighterAvailability()).toBe("error");
  });

  it("clears its timeout once the extension answers", async () => {
    mockIsConnected.mockResolvedValue(true);
    await checkFreighterAvailability();
    expect(vi.getTimerCount()).toBe(0);
  });
});
