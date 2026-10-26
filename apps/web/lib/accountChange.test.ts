import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { QueryClient } from "@tanstack/react-query";
import {
  clearAccountScopedQueries,
  isScopedToAddress,
  isValidAccountAddress,
} from "./accountChange";

const A = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const B = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();

describe("isValidAccountAddress", () => {
  it("accepts a G... account key", () => {
    expect(isValidAccountAddress(A)).toBe(true);
  });
  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 5],
    ["garbage", "GCHANGED"],
    ["a secret seed", Keypair.random().secret()],
    ["a bad checksum", A.slice(0, -1) + (A.endsWith("A") ? "B" : "A")],
    ["a contract id", "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ"],
    ["whitespace padded", ` ${A} `],
  ])("rejects %s", (_n, v) => {
    expect(isValidAccountAddress(v)).toBe(false);
  });
});

describe("isScopedToAddress", () => {
  it("matches address at any position, including nested filters", () => {
    expect(isScopedToAddress(["balances", A, true], A)).toBe(true);
    expect(isScopedToAddress(["invoices", { owner: A }], A)).toBe(true);
    expect(isScopedToAddress(["poolStats"], A)).toBe(false);
    expect(isScopedToAddress(["balances", B], A)).toBe(false);
  });
});

describe("clearAccountScopedQueries", () => {
  it("removes only the previous account's queries", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["balances", A, true], { xlm: "1" });
    qc.setQueryData(["lpPosition", A], 1);
    qc.setQueryData(["balances", B, true], { xlm: "2" });
    qc.setQueryData(["poolStats"], 3);

    await clearAccountScopedQueries(qc, A);

    expect(qc.getQueryData(["balances", A, true])).toBeUndefined();
    expect(qc.getQueryData(["lpPosition", A])).toBeUndefined();
    expect(qc.getQueryData(["balances", B, true])).toEqual({ xlm: "2" });
    expect(qc.getQueryData(["poolStats"])).toBe(3);
  });

  it("a late response from the old account cannot repopulate the cache", async () => {
    const qc = new QueryClient();
    let resolve!: (v: string) => void;
    const pending = qc.fetchQuery({
      queryKey: ["balances", A, true],
      queryFn: () => new Promise<string>((r) => (resolve = r)),
    });
    pending.catch(() => {});
    await Promise.resolve();

    await clearAccountScopedQueries(qc, A);
    resolve("stale");
    await pending.catch(() => {});

    expect(qc.getQueryData(["balances", A, true])).toBeUndefined();
    expect(qc.getQueryCache().findAll()).toHaveLength(0);
  });
});
