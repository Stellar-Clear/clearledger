/**
 * Local, expiring storage for the non-sensitive fields of an invoice draft.
 *
 * Only the whitelisted fields in {@link InvoiceDraft} are read or written.
 * Signed envelopes, secret keys, and uploaded documents are never stored here.
 * Drafts are keyed by wallet address, so one account never sees another's
 * draft, and they expire after {@link DRAFT_TTL_MS}.
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface InvoiceDraft {
  buyer: string;
  faceValue: string;
  asset: string;
  dueDate: string;
  discountBps: number;
  listAtCreation: boolean;
}

interface StoredDraft {
  savedAt: number;
  draft: InvoiceDraft;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function keyFor(address: string): string {
  return `clearledger_invoice_draft_${address}`;
}

function isEmpty(draft: InvoiceDraft): boolean {
  return draft.buyer === "" && draft.faceValue === "" && draft.dueDate === "";
}

/** Keep only known fields with the expected types. Anything else is dropped. */
function sanitize(value: unknown): InvoiceDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const bps = raw.discountBps;
  return {
    buyer: typeof raw.buyer === "string" ? raw.buyer.slice(0, 100) : "",
    faceValue: typeof raw.faceValue === "string" ? raw.faceValue.slice(0, 40) : "",
    asset: typeof raw.asset === "string" ? raw.asset.slice(0, 10) : "USDC",
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate.slice(0, 20) : "",
    discountBps: typeof bps === "number" && Number.isFinite(bps) ? Math.min(10_000, Math.max(0, bps)) : 200,
    listAtCreation: typeof raw.listAtCreation === "boolean" ? raw.listAtCreation : true,
  };
}

/**
 * Save the draft for `address`. An empty draft removes the stored one.
 * Storage failures (private mode, quota) are ignored, so the form still works.
 */
export function saveInvoiceDraft(
  address: string,
  draft: InvoiceDraft,
  storage: DraftStorage | undefined = typeof window !== "undefined" ? window.localStorage : undefined,
  now: number = Date.now(),
): void {
  if (!storage) return;
  try {
    if (isEmpty(draft)) {
      storage.removeItem(keyFor(address));
      return;
    }
    const stored: StoredDraft = { savedAt: now, draft: sanitize(draft) as InvoiceDraft };
    storage.setItem(keyFor(address), JSON.stringify(stored));
  } catch {
    // Storage is unavailable; the form keeps working without a draft.
  }
}

/** Load the unexpired draft for `address`, or null. Expired or malformed entries are removed. */
export function loadInvoiceDraft(
  address: string,
  storage: DraftStorage | undefined = typeof window !== "undefined" ? window.localStorage : undefined,
  now: number = Date.now(),
): InvoiceDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    const draft = sanitize(parsed.draft);
    if (!draft || typeof parsed.savedAt !== "number" || now - parsed.savedAt > DRAFT_TTL_MS) {
      storage.removeItem(keyFor(address));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/** Remove the draft for `address`, for example after the invoice is created. */
export function clearInvoiceDraft(
  address: string,
  storage: DraftStorage | undefined = typeof window !== "undefined" ? window.localStorage : undefined,
): void {
  try {
    storage?.removeItem(keyFor(address));
  } catch {
    // Ignored, as in saveInvoiceDraft.
  }
}
