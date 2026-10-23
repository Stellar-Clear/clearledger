import type { Invoice } from "@/types";

export type InvoiceSortKey = "faceValue" | "dueDate" | "discountBps";
export type SortDirection = "asc" | "desc";

type SortableInvoice = Pick<Invoice, "id" | "faceValue" | "dueDate" | "discountBps">;

function compareValues(a: SortableInvoice, b: SortableInvoice, key: InvoiceSortKey): number {
  if (key === "faceValue") return a.faceValue === b.faceValue ? 0 : a.faceValue < b.faceValue ? -1 : 1;
  return a[key] - b[key];
}

/**
 * Sort invoices by one key, deterministically. Invoices with equal values are
 * ordered by `id`, so the same input always produces the same order, and the
 * input array is not mutated.
 *
 * `discountBps` is basis points (100 bps = 1%); it is compared as stored.
 */
export function sortInvoicesDeterministically<T extends SortableInvoice>(
  invoices: readonly T[],
  key: InvoiceSortKey,
  direction: SortDirection,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...invoices].sort((a, b) => {
    const byKey = compareValues(a, b, key) * sign;
    if (byKey !== 0) return byKey;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
