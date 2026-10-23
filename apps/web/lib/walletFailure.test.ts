import { describe, expect, it } from "vitest";
import { describeWalletFailure } from "./walletFailure";

describe("describeWalletFailure", () => {
  it("reports a user cancellation", () => {
    expect(describeWalletFailure(new Error("User declined the request")).kind).toBe("cancelled");
    expect(describeWalletFailure("request was rejected").kind).toBe("cancelled");
  });

  it("reports a contract rejection even when the text mentions RPC", () => {
    expect(describeWalletFailure("RPC simulation failed: HostError: Error(Contract, #44)").kind).toBe("contract");
  });

  it("reports an RPC timeout or network failure", () => {
    expect(describeWalletFailure(new Error("Stellar RPC timed out")).kind).toBe("rpc");
    expect(describeWalletFailure(new TypeError("Failed to fetch")).kind).toBe("rpc");
  });

  it("reports a missing or disconnected wallet", () => {
    expect(describeWalletFailure(new Error("Freighter is not installed")).kind).toBe("wallet");
  });

  it("falls back to unknown for an unrecognised error", () => {
    expect(describeWalletFailure(new Error("something odd")).kind).toBe("unknown");
    expect(describeWalletFailure(undefined).kind).toBe("unknown");
  });

  it("gives each kind a different message", () => {
    const messages = new Set(
      [
        "User declined",
        "HostError: Error(Contract, #1)",
        "RPC timed out",
        "Freighter is not installed",
        "odd",
      ].map((text) => describeWalletFailure(text).message),
    );
    expect(messages.size).toBe(5);
  });
});
