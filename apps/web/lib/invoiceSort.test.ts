import { describe, expect, it } from "vitest";
import { sortInvoicesDeterministically } from "./invoiceSort";

const invoices = [
  { id: "b", faceValue: 500n, dueDate: 300, discountBps: 200 },
  { id: "a", faceValue: 100n, dueDate: 100, discountBps: 50 },
  { id: "c", faceValue: 500n, dueDate: 200, discountBps: 200 },
];

const ids = (list: { id: string }[]) => list.map((invoice) => invoice.id);

describe("sortInvoicesDeterministically", () => {
  it("sorts by due date ascending and descending", () => {
    expect(ids(sortInvoicesDeterministically(invoices, "dueDate", "asc"))).toEqual(["a", "c", "b"]);
    expect(ids(sortInvoicesDeterministically(invoices, "dueDate", "desc"))).toEqual(["b", "c", "a"]);
  });

  it("sorts by discount in basis points", () => {
    expect(ids(sortInvoicesDeterministically(invoices, "discountBps", "asc"))).toEqual(["a", "b", "c"]);
  });

  it("sorts face value with bigint precision", () => {
    expect(ids(sortInvoicesDeterministically(invoices, "faceValue", "desc"))).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by id, so repeated sorts agree", () => {
    expect(ids(sortInvoicesDeterministically(invoices, "discountBps", "desc"))).toEqual(["b", "c", "a"]);
    expect(ids(sortInvoicesDeterministically(invoices, "faceValue", "desc"))).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...invoices];
    sortInvoicesDeterministically(invoices, "dueDate", "asc");
    expect(invoices).toEqual(copy);
  });

  it("returns an empty array for no invoices", () => {
    expect(sortInvoicesDeterministically([], "dueDate", "asc")).toEqual([]);
  });
});
