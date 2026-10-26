import { describe, expect, it } from "vitest";
import type { Invoice } from "@/types";
import {
  DEFAULT_MARKETPLACE_FILTERS,
  filterInvoicesByDueDateAndAsset,
  parseMarketplaceUrl,
} from "./marketplaceFilters";

const invoices = [
  { asset: "USDC", dueDate: 1_800_000_000 },
  { asset: "XLM", dueDate: 1_900_000_000 },
  { asset: "USDC", dueDate: 2_000_000_000 },
] as Invoice[];

describe("marketplace URL filters", () => {
  it("reads supported filters from query parameters", () => {
    expect(
      parseMarketplaceUrl(
        "?status=Funded&asset=XLM&dueFrom=2027-01-01&dueTo=2027-12-31",
      ),
    ).toMatchObject({
      statusFilter: "Funded",
      asset: "XLM",
      dueFrom: "2027-01-01",
      dueTo: "2027-12-31",
    });
  });

  it("ignores invalid values and keeps safe defaults", () => {
    expect(
      parseMarketplaceUrl(
        "?status=made-up&asset=USD&dueFrom=2027-02-30&minAmount=1e9&maxDiscount=99999",
      ),
    ).toEqual(DEFAULT_MARKETPLACE_FILTERS);
  });

  it("filters by inclusive due-date range and funding asset", () => {
    expect(
      filterInvoicesByDueDateAndAsset(invoices, {
        dueFrom: "2028-01-01",
        dueTo: "2035-01-01",
        asset: "USDC",
      }),
    ).toEqual([invoices[2]]);
  });
});
