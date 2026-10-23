import { describe, expect, it, beforeEach } from "vitest";
import {
  DRAFT_TTL_MS,
  clearInvoiceDraft,
  loadInvoiceDraft,
  saveInvoiceDraft,
  type InvoiceDraft,
} from "./invoiceDraft";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const DRAFT: InvoiceDraft = {
  buyer: "GBUYER",
  faceValue: "1000",
  asset: "USDC",
  dueDate: "2026-12-01",
  discountBps: 250,
  listAtCreation: false,
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: data,
  };
}

describe("invoiceDraft", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("round-trips a saved draft for the same address", () => {
    saveInvoiceDraft(ADDRESS, DRAFT, storage, 1_000);
    expect(loadInvoiceDraft(ADDRESS, storage, 2_000)).toEqual(DRAFT);
  });

  it("keys drafts by address so accounts do not share them", () => {
    saveInvoiceDraft(ADDRESS, DRAFT, storage, 1_000);
    expect(loadInvoiceDraft("GOTHER", storage, 2_000)).toBeNull();
  });

  it("expires a draft after the TTL and removes it", () => {
    saveInvoiceDraft(ADDRESS, DRAFT, storage, 1_000);
    expect(loadInvoiceDraft(ADDRESS, storage, 1_000 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.raw.size).toBe(0);
  });

  it("stores only whitelisted fields, so extra keys are never persisted", () => {
    const withSecrets = { ...DRAFT, secretKey: "SSECRET", signedEnvelope: "AAAA", document: "data:..." };
    saveInvoiceDraft(ADDRESS, withSecrets as InvoiceDraft, storage, 1_000);
    const stored = storage.raw.get(`clearledger_invoice_draft_${ADDRESS}`) ?? "";
    expect(stored).not.toContain("SSECRET");
    expect(stored).not.toContain("signedEnvelope");
    expect(stored).not.toContain("document");
  });

  it("removes the stored draft when every field is empty", () => {
    saveInvoiceDraft(ADDRESS, DRAFT, storage, 1_000);
    saveInvoiceDraft(ADDRESS, { ...DRAFT, buyer: "", faceValue: "", dueDate: "" }, storage, 2_000);
    expect(storage.raw.size).toBe(0);
  });

  it("ignores malformed stored data", () => {
    storage.setItem(`clearledger_invoice_draft_${ADDRESS}`, "{not json");
    expect(loadInvoiceDraft(ADDRESS, storage, 1_000)).toBeNull();
  });

  it("clears the draft on request", () => {
    saveInvoiceDraft(ADDRESS, DRAFT, storage, 1_000);
    clearInvoiceDraft(ADDRESS, storage);
    expect(loadInvoiceDraft(ADDRESS, storage, 1_000)).toBeNull();
  });

  it("does not throw when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveInvoiceDraft(ADDRESS, DRAFT, broken, 1)).not.toThrow();
    expect(loadInvoiceDraft(ADDRESS, broken, 1)).toBeNull();
    expect(() => clearInvoiceDraft(ADDRESS, broken)).not.toThrow();
  });
});
