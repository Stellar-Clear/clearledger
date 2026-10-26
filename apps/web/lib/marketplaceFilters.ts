import type { Invoice, InvoiceStatus } from "@/types";

export interface MarketplaceFilters {
  statusFilter: string;
  minAmount: string;
  maxAmount: string;
  maxDiscount: string;
  dueFrom: string;
  dueTo: string;
  asset: "ALL" | "USDC" | "XLM";
}

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilters = {
  statusFilter: "Listed",
  minAmount: "",
  maxAmount: "",
  maxDiscount: "500",
  dueFrom: "",
  dueTo: "",
  asset: "ALL",
};

const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "Created",
  "Listed",
  "Funded",
  "Active",
  "Confirmed",
  "Repaid",
  "Defaulted",
];

function validDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

function validAmount(value: string | null): string | null {
  if (value === null) return null;
  if (value === "") return "";
  return /^\d{1,18}(?:\.\d{1,7})?$/.test(value) ? value : null;
}

function validDiscount(value: string | null): string | null {
  if (value === null) return null;
  if (value === "") return "";
  if (!/^\d{1,5}$/.test(value) || Number(value) > 10_000) return null;
  return value;
}

export function parseMarketplaceUrl(
  search: string,
  fallback: MarketplaceFilters = DEFAULT_MARKETPLACE_FILTERS,
): MarketplaceFilters {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  const asset = params.get("asset");
  const statusFilter =
    status &&
    (status === "ALL" || INVOICE_STATUSES.includes(status as InvoiceStatus))
      ? status
      : fallback.statusFilter;
  const dueFrom = validDate(params.get("dueFrom")) || fallback.dueFrom;
  const candidateDueTo = validDate(params.get("dueTo")) || fallback.dueTo;
  const dueTo =
    dueFrom && candidateDueTo && candidateDueTo < dueFrom ? "" : candidateDueTo;
  return {
    ...fallback,
    statusFilter,
    dueFrom,
    dueTo,
    asset:
      asset === "USDC" || asset === "XLM" || asset === "ALL"
        ? asset
        : fallback.asset,
    minAmount: validAmount(params.get("minAmount")) ?? fallback.minAmount,
    maxAmount: validAmount(params.get("maxAmount")) ?? fallback.maxAmount,
    maxDiscount:
      validDiscount(params.get("maxDiscount")) ?? fallback.maxDiscount,
  };
}

export function filterInvoicesByDueDateAndAsset(
  invoices: Invoice[],
  filters: Pick<MarketplaceFilters, "dueFrom" | "dueTo" | "asset">,
): Invoice[] {
  const from = filters.dueFrom
    ? Date.parse(`${filters.dueFrom}T00:00:00.000Z`) / 1000
    : null;
  const to = filters.dueTo
    ? Date.parse(`${filters.dueTo}T23:59:59.999Z`) / 1000
    : null;
  return invoices.filter((invoice) => {
    if (filters.asset !== "ALL" && invoice.asset !== filters.asset)
      return false;
    if (from !== null && invoice.dueDate < from) return false;
    if (to !== null && invoice.dueDate > to) return false;
    return true;
  });
}
