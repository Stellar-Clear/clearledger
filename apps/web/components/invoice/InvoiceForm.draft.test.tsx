import React, { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvoiceForm } from "./InvoiceForm";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { useWalletStore } from "@/store/wallet";

// The draft must be cleared once the invoice exists, even when onSuccess
// unmounts the form in the same render (as the dashboard's create modal does).

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const BUYER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const DRAFT_KEY = `clearledger_invoice_draft_${ADDRESS}`;

const createInvoice = vi.fn();

vi.mock("@/hooks/useInvoices", () => ({
  useInvoiceActions: () => ({
    createInvoice,
    isCreating: false,
    listInvoice: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({
    profile: { role: "issuer" },
    isProfileLoading: false,
    isVerified: true,
  }),
}));

vi.mock("@clearledger/sdk", () => ({
  InvoiceClient: vi.fn(),
  PoolClient: vi.fn(function () {}),
  fromUsdc: (value: bigint) => Number(value) / 10_000_000,
  toUsdc: (value: number) => BigInt(Math.round(value * 10_000_000)),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: vi.fn(
      (value: string) => typeof value === "string" && value.startsWith("G"),
    ),
  },
  xdr: { ScVal: { scvBytes: vi.fn() } },
  nativeToScVal: vi.fn(),
}));

vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (value: string) => void;
  }) => (
    <input
      type="date"
      data-testid="date-picker"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

/** Mirrors the dashboard: a successful create closes the modal. */
function CreateModal() {
  const [open, setOpen] = useState(true);
  return open ? <InvoiceForm onSuccess={() => setOpen(false)} /> : <p>closed</p>;
}

function fillAndReview() {
  fireEvent.change(screen.getByPlaceholderText(/stellar public key/i), {
    target: { value: BUYER },
  });
  fireEvent.change(screen.getByPlaceholderText(/50,000\.00/i), {
    target: { value: "1500" },
  });
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  fireEvent.change(screen.getByTestId("date-picker"), {
    target: { value: dueDate.toISOString().split("T")[0] },
  });
  fireEvent.click(screen.getByLabelText(/list this invoice for financing/i));
  fireEvent.click(
    screen.getByRole("button", { name: /review financing terms/i }),
  );
}

describe("InvoiceForm draft lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createInvoice.mockReset();
    useWalletStore.setState({ address: ADDRESS });
  });

  it("clears the saved draft when a create succeeds and the form unmounts", async () => {
    createInvoice.mockResolvedValue({
      invoice_id: "ab".repeat(32),
      transaction_hash: "cd".repeat(32),
    });
    renderWithProviders(<CreateModal />);

    fillAndReview();
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY)).toContain(BUYER),
    );

    fireEvent.click(await screen.findByRole("button", { name: /create invoice/i }));

    await screen.findByText("closed");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("keeps the draft when the create fails, so the user can retry", async () => {
    createInvoice.mockRejectedValue(new Error("Indexer unavailable"));
    renderWithProviders(<CreateModal />);

    fillAndReview();
    fireEvent.click(await screen.findByRole("button", { name: /create invoice/i }));

    await screen.findByText(/indexer unavailable/i);
    expect(window.localStorage.getItem(DRAFT_KEY)).toContain(BUYER);
  });
});
