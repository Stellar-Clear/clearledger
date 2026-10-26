import { afterEach, describe, expect, it, vi } from "vitest";
import {
  freighterNetworkName,
  getConfiguredStellarNetwork,
  normalizeStellarNetwork,
  stellarNetworkLabel,
} from "./stellarNetwork";

afterEach(() => vi.unstubAllEnvs());

describe("Stellar network names", () => {
  it.each([
    ["TESTNET", "testnet"],
    [" public ", "mainnet"],
    ["MAINNET", "mainnet"],
    ["FUTURENET", "futurenet"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeStellarNetwork(input)).toBe(expected);
  });

  it("uses and labels the configured app network", () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "mainnet");
    expect(getConfiguredStellarNetwork()).toBe("mainnet");
    expect(stellarNetworkLabel(getConfiguredStellarNetwork())).toBe("Mainnet");
    expect(freighterNetworkName(getConfiguredStellarNetwork())).toBe("PUBLIC");
  });

  it("falls back to Testnet for an unset or unsupported app configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "unsupported");
    expect(getConfiguredStellarNetwork()).toBe("testnet");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "");
    expect(getConfiguredStellarNetwork()).toBe("testnet");
  });
});
