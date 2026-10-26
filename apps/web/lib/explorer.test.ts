import { describe, expect, it } from "vitest";
import { stellarExpertTxUrl } from "./explorer";

const HASH = "a".repeat(64);

describe("stellarExpertTxUrl", () => {
  it("links testnet transactions to the testnet explorer", () => {
    expect(stellarExpertTxUrl(HASH, "testnet")).toBe(`https://stellar.expert/explorer/testnet/tx/${HASH}`);
  });

  it("links mainnet transactions to the public explorer path", () => {
    expect(stellarExpertTxUrl(HASH, "mainnet")).toBe(`https://stellar.expert/explorer/public/tx/${HASH}`);
  });

  it("returns null for a hash that is not 64 hex characters", () => {
    expect(stellarExpertTxUrl("abc", "testnet")).toBeNull();
    expect(stellarExpertTxUrl("g".repeat(64), "testnet")).toBeNull();
  });

  it("returns null for an unrecognised network rather than guessing one", () => {
    expect(stellarExpertTxUrl(HASH, "futurenet")).toBeNull();
  });

  it("normalises hash case", () => {
    expect(stellarExpertTxUrl("A".repeat(64), "testnet")).toBe(
      `https://stellar.expert/explorer/testnet/tx/${"a".repeat(64)}`,
    );
  });
});
