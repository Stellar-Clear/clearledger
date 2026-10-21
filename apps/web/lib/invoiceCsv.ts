import type { Invoice } from "@/types";

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Download the invoice records currently visible after marketplace filters. */
export function downloadInvoicesCSV(invoices: Invoice[]): void {
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
  const exportedAt = new Date().toISOString();
  const rows = [
    [
      "id",
      "issuer",
      "buyer",
      "face_value_stroops",
      "asset",
      "discount_bps",
      "status",
      "due_date",
      "network",
      "exported_at",
    ],
    ...invoices.map((invoice) => [
      invoice.id,
      invoice.issuer,
      invoice.buyer,
      invoice.faceValue.toString(),
      invoice.asset,
      invoice.discountBps,
      invoice.status,
      new Date(invoice.dueDate * 1000).toISOString(),
      network,
      exportedAt,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `clearledger-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
