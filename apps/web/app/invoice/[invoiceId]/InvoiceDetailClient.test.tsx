import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InvoiceDetailClient from "./InvoiceDetailClient";
import { useInvoice, useInvoiceActions } from "@/hooks/useInvoices";
import { useWalletStore } from "@/store/wallet";
import { useRouter } from "next/navigation";
import type { Invoice } from "@/types";
import { generateInvoicePdf } from "@/lib/invoicePdf";

// next/navigation's useRouter throws outside of an App Router provider.
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(() => "/invoice/abc"),
}));

// Keep the page-level shell out of these tests so they exercise
// InvoiceDetailClient's own rendering and interactions in isolation.
vi.mock("@/components/shared/PageLayout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/useInvoices", () => ({
  useInvoice: vi.fn(),
  useInvoiceActions: vi.fn(),
}));

vi.mock("@/store/wallet", () => ({
  useWalletStore: vi.fn(),
}));

// The confirmation dialog is rendered by the app shell, which is not present
// in these isolated component tests. Mock the confirm store so that requesting
// an action immediately invokes it (the same behavior as clicking CONFIRM).
vi.mock("@/store/confirmDialog", () => ({
  useConfirmDialogStore: vi.fn(() => ({
    request: vi.fn((action: { fn: () => void }) => action.fn()),
    cancel: vi.fn(),
    pendingAction: null,
  })),
}));

// The PDF export is exercised in lib/invoicePdf.test.ts; here it is only
// asserted that the button wiring calls it.
vi.mock("@/lib/invoicePdf", () => ({
  generateInvoicePdf: vi.fn(),
}));

const ISSUER = "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB";
const BUYER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const INVOICE_ID =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

const nowSecs = Math.floor(Date.now() / 1000);

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: INVOICE_ID,
  status: "Funded",
  issuer: ISSUER,
  buyer: BUYER,
  faceValue: 1_000_000_000n, // 100.00 USDC
  asset: "USDC",
  discountBps: 500,
  fundedAmount: 0n,
  dueDate: nowSecs + 30 * 24 * 3600,
  createdAt: nowSecs - 10 * 24 * 3600,
  fundedAt: nowSecs - 5 * 24 * 3600,
  shippedAt: null,
  issuerConfirmed: false,
  buyerConfirmed: false,
  repaidAt: null,
  ...overrides,
});

describe("InvoiceDetailClient", () => {
  let mockRefetch: ReturnType<typeof vi.fn>;
  let mockShipInvoice: ReturnType<typeof vi.fn>;
  let mockConfirmDelivery: ReturnType<typeof vi.fn>;
  let mockRepayInvoice: ReturnType<typeof vi.fn>;
  let mockDefaultInvoice: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // jsdom has no IntersectionObserver; next/link relies on it.
    class IntersectionObserverMock {
      readonly root: Element | null = null;
      readonly rootMargin = "";
      readonly thresholds: ReadonlyArray<number> = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
    }
    (globalThis as any).IntersectionObserver = IntersectionObserverMock;

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    mockRefetch = vi.fn().mockResolvedValue(undefined);
    mockShipInvoice = vi.fn().mockResolvedValue("ship-tx-hash");
    mockConfirmDelivery = vi.fn().mockResolvedValue("confirm-tx-hash");
    mockRepayInvoice = vi.fn().mockResolvedValue("repay-tx-hash");
    mockDefaultInvoice = vi.fn().mockResolvedValue("default-tx-hash");

    vi.mocked(useInvoice).mockReturnValue({
      invoice: makeInvoice(),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any);

    vi.mocked(useInvoiceActions).mockReturnValue({
      shipInvoice: mockShipInvoice,
      confirmDelivery: mockConfirmDelivery,
      repayInvoice: mockRepayInvoice,
      defaultInvoice: mockDefaultInvoice,
    } as any);

    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: null,
        connected: false,
        network: null,
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);
  });

  it("renders the loading state while the invoice is being fetched", () => {
    vi.mocked(useInvoice).mockReturnValue({
      invoice: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(
      screen.getByText(/Fetching invoice state from ledger\.\.\./i),
    ).toBeInTheDocument();
  });

  it("renders the not-found state and returns to the dashboard", () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as any);
    vi.mocked(useInvoice).mockReturnValue({
      invoice: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(screen.getByText(/Ledger entry not found/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(INVOICE_ID))).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Return to Dashboard/i }),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the full invoice detail view for a funded invoice", () => {
    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(screen.getByText(/INVOICE AUDIT LEDGER/i)).toBeInTheDocument();
    expect(screen.getByText(INVOICE_ID)).toBeInTheDocument();
    expect(screen.getByText(ISSUER)).toBeInTheDocument();
    expect(screen.getByText(BUYER)).toBeInTheDocument();
    // Face value obligations + net discount fee both show the amount.
    expect(screen.getAllByText("100.00 USDC").length).toBeGreaterThan(0);
    expect(screen.getByText(/Obligation Parties/i)).toBeInTheDocument();
    expect(screen.getByText(/Escrow Security Vault/i)).toBeInTheDocument();
    expect(screen.getByText(/Maturity Parameters/i)).toBeInTheDocument();
    expect(screen.getByText(/Share Invoice/i)).toBeInTheDocument();

    const whatsapp = screen.getByText("WhatsApp").closest("a");
    expect(whatsapp).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/wa\.me\//),
    );
    const telegram = screen.getByText("Telegram").closest("a");
    expect(telegram).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/t\.me\/share\/url/),
    );
  });

  it("hides action buttons when the wallet is not connected", () => {
    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(screen.queryByText(/Available Action/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /MARK GOODS SHIPPED/i }),
    ).not.toBeInTheDocument();
  });

  it("shows MARK GOODS SHIPPED for a connected issuer on a funded invoice", () => {
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: ISSUER,
        connected: true,
        network: "testnet",
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(
      screen.getByRole("button", { name: /MARK GOODS SHIPPED/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /CONFIRM DELIVERY/i }),
    ).not.toBeInTheDocument();
  });

  it("shows CONFIRM DELIVERY for a connected buyer on an active invoice", () => {
    vi.mocked(useInvoice).mockReturnValue({
      invoice: makeInvoice({ status: "Active" }),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any);
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: BUYER,
        connected: true,
        network: "testnet",
        token: null,
        role: "buyer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(
      screen.getByRole("button", { name: /CONFIRM DELIVERY/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /MARK GOODS SHIPPED/i }),
    ).not.toBeInTheDocument();
  });

  it("shows REPAY INVOICE for a connected buyer on a confirmed invoice", () => {
    vi.mocked(useInvoice).mockReturnValue({
      invoice: makeInvoice({ status: "Confirmed" }),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any);
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: BUYER,
        connected: true,
        network: "testnet",
        token: null,
        role: "buyer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(
      screen.getByRole("button", { name: /REPAY INVOICE/i }),
    ).toBeInTheDocument();
  });

  it("shows DEFAULT INVOICE for a connected user on an overdue confirmed invoice", () => {
    vi.mocked(useInvoice).mockReturnValue({
      invoice: makeInvoice({
        status: "Confirmed",
        dueDate: nowSecs - 24 * 3600,
      }),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any);
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: ISSUER,
        connected: true,
        network: "testnet",
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(screen.getByText("OVERDUE")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /DEFAULT INVOICE/i }),
    ).toBeInTheDocument();
  });

  it("does not show role-gated buttons for the wrong role", () => {
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: BUYER,
        connected: true,
        network: "testnet",
        token: null,
        role: "buyer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    // Funded invoice + buyer role: only the issuer may mark goods shipped.
    expect(
      screen.queryByRole("button", { name: /MARK GOODS SHIPPED/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Available Action/i)).not.toBeInTheDocument();
  });

  it("copies the invoice ID to the clipboard", async () => {
    const writeText = vi
      .mocked(navigator.clipboard.writeText)
      .mockResolvedValue(undefined);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    fireEvent.click(screen.getByLabelText("Copy invoice ID"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVOICE_ID));
  });

  it("copies issuer and buyer addresses to the clipboard", async () => {
    const writeText = vi
      .mocked(navigator.clipboard.writeText)
      .mockResolvedValue(undefined);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    const copyButtons = screen.getAllByRole("button", { name: /^COPY$/ });
    expect(copyButtons).toHaveLength(2);

    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ISSUER));

    fireEvent.click(screen.getByRole("button", { name: /^COPY$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(BUYER));

    // Wait for React to commit both "copied" state updates: waitFor above
    // can observe the clipboard write before the second button re-renders,
    // so asserting immediately races the concurrent scheduler.
    await waitFor(() => expect(screen.getAllByText("COPIED")).toHaveLength(2));
  });

  it("copies the invoice link to the clipboard once the URL is available", async () => {
    const writeText = vi
      .mocked(navigator.clipboard.writeText)
      .mockResolvedValue(undefined);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    const copyLinkButton = await screen.findByRole("button", {
      name: /Copy Invoice Link/i,
    });
    expect(copyLinkButton).toBeEnabled();

    fireEvent.click(copyLinkButton);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(window.location.href),
    );
    expect(await screen.findByText("LINK COPIED")).toBeInTheDocument();
  });

  it("calls shipInvoice and shows the pending modal with the returned tx hash", async () => {
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: ISSUER,
        connected: true,
        network: "testnet",
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    fireEvent.click(
      screen.getByRole("button", { name: /MARK GOODS SHIPPED/i }),
    );

    expect(
      screen.getByText(/Marking goods as shipped\.\.\./i),
    ).toBeInTheDocument();

    const pendingStatus = screen.getByTestId("transaction-status-polite");
    expect(pendingStatus).toHaveAttribute("aria-live", "polite");
    expect(pendingStatus).toHaveTextContent(
      "Transaction pending. Marking goods as shipped...",
    );
    expect(pendingStatus.contains(document.activeElement)).toBe(false);

    await waitFor(() =>
      expect(mockShipInvoice).toHaveBeenCalledWith({ invoiceId: INVOICE_ID }),
    );
    await waitFor(() =>
      expect(screen.getByText("ship-tx-hash")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("transaction-status-polite")).toHaveTextContent(
        "Transaction confirmed.",
      ),
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("restores focus to the action trigger after closing the transaction dialog", async () => {
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: ISSUER,
        connected: true,
        network: "testnet",
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    const trigger = screen.getByRole("button", {
      name: /MARK GOODS SHIPPED/i,
    });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByText("ship-tx-hash")).toBeInTheDocument(),
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: /close dialog/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("announces a failed transaction assertively and allows a retry", async () => {
    mockShipInvoice.mockRejectedValueOnce(new Error("Ship failed"));
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: ISSUER,
        connected: true,
        network: "testnet",
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    const shipButton = screen.getByRole("button", {
      name: /MARK GOODS SHIPPED/i,
    });
    fireEvent.click(shipButton);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Ship failed"),
    );
    expect(
      screen.queryByTestId("transaction-status-assertive"),
    ).not.toBeInTheDocument();

    fireEvent.click(shipButton);
    expect(screen.getByTestId("transaction-status-polite")).toHaveTextContent(
      /Transaction pending/i,
    );
    await waitFor(() =>
      expect(screen.getByTestId("transaction-status-polite")).toHaveTextContent(
        "Transaction confirmed.",
      ),
    );
  });

  it("shows the error message and closes the pending modal when an action fails", async () => {
    mockShipInvoice.mockRejectedValue(new Error("Ship failed"));
    vi.mocked(useWalletStore).mockImplementation(((selector: any) => {
      const state = {
        address: ISSUER,
        connected: true,
        network: "testnet",
        token: null,
        role: "issuer",
      };
      return selector ? selector(state) : state;
    }) as any);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    fireEvent.click(
      screen.getByRole("button", { name: /MARK GOODS SHIPPED/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Ship failed"),
    );
    expect(
      screen.queryByText(/Marking goods as shipped\.\.\./i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a Download PDF button without a connected wallet", () => {
    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    expect(screen.getByRole("button", { name: /Download PDF/i })).toBeEnabled();
  });

  it("exports the loaded invoice as a PDF", async () => {
    vi.mocked(generateInvoicePdf).mockResolvedValue(undefined);

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    await waitFor(() =>
      expect(generateInvoicePdf).toHaveBeenCalledWith(
        expect.objectContaining({ id: INVOICE_ID, status: "Funded" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Download PDF/i }),
      ).toBeEnabled(),
    );
  });

  it("shows a loading state while the PDF is being generated", async () => {
    let releasePdf: (() => void) | undefined;
    vi.mocked(generateInvoicePdf).mockReturnValue(
      new Promise<void>((resolve) => {
        releasePdf = () => resolve();
      }),
    );

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    const exportingButton = await screen.findByRole("button", {
      name: /Generating PDF/i,
    });
    expect(exportingButton).toBeDisabled();
    expect(exportingButton).toHaveAttribute("aria-busy", "true");

    releasePdf?.();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Download PDF/i }),
      ).toBeEnabled(),
    );
  });

  it("surfaces PDF generation failures", async () => {
    vi.mocked(generateInvoicePdf).mockRejectedValue(new Error("PDF failed"));

    render(<InvoiceDetailClient invoiceId={INVOICE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("PDF failed"),
    );
    expect(screen.getByRole("button", { name: /Download PDF/i })).toBeEnabled();
  });
});
