import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInvoiceDetailActions } from "./useInvoiceDetailActions";
import { useInvoiceActions } from "@/hooks/useInvoices";
import { useConfirmDialogStore } from "@/store/confirmDialog";

vi.mock("@/hooks/useInvoices", () => ({
  useInvoiceActions: vi.fn(),
}));

vi.mock("@/store/confirmDialog", () => ({
  useConfirmDialogStore: vi.fn(),
}));

describe("useInvoiceDetailActions", () => {
  const invoiceId = "invoice_123";
  let requestConfirmation: ReturnType<typeof vi.fn>;
  let shipInvoice: ReturnType<typeof vi.fn>;
  let confirmDelivery: ReturnType<typeof vi.fn>;
  let repayInvoice: ReturnType<typeof vi.fn>;
  let defaultInvoice: ReturnType<typeof vi.fn>;
  let refetch: () => Promise<unknown>;

  beforeEach(() => {
    requestConfirmation = vi.fn();
    shipInvoice = vi.fn().mockResolvedValue("tx_hash_abc");
    confirmDelivery = vi.fn().mockResolvedValue("tx_hash_def");
    repayInvoice = vi.fn().mockResolvedValue("tx_hash_ghi");
    defaultInvoice = vi.fn().mockResolvedValue("tx_hash_jkl");
    refetch = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useInvoiceActions).mockReturnValue({
      shipInvoice,
      confirmDelivery,
      repayInvoice,
      defaultInvoice,
    } as any);

    vi.mocked(useConfirmDialogStore).mockReturnValue({
      pendingAction: null,
      request: requestConfirmation,
      cancel: vi.fn(),
    });
  });

  it("requests confirmation with the right label for each action", () => {
    const { result } = renderHook(() =>
      useInvoiceDetailActions(invoiceId, refetch),
    );

    act(() => result.current.ship());
    expect(requestConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Mark Goods Shipped", invoiceId }),
    );

    act(() => result.current.confirm());
    expect(requestConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Confirm Delivery", invoiceId }),
    );

    act(() => result.current.repay());
    expect(requestConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Repay Invoice", invoiceId }),
    );

    act(() => result.current.markDefault());
    expect(requestConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Default Invoice", invoiceId }),
    );
  });

  it("on confirmed ship: calls shipInvoice, sets pending hash, and refetches", async () => {
    const { result } = renderHook(() =>
      useInvoiceDetailActions(invoiceId, refetch),
    );

    act(() => result.current.ship());
    const { fn } = requestConfirmation.mock.calls[0][0];

    await act(async () => {
      await fn();
    });

    expect(shipInvoice).toHaveBeenCalledWith({ invoiceId });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.pendingHash).toBe("tx_hash_abc");
    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("on a rejected action: sets error, hides the pending dialog, and does not refetch", async () => {
    shipInvoice.mockRejectedValueOnce(new Error("Soroban RPC timeout"));

    const { result } = renderHook(() =>
      useInvoiceDetailActions(invoiceId, refetch),
    );

    act(() => result.current.ship());
    const { fn } = requestConfirmation.mock.calls[0][0];

    await act(async () => {
      await fn();
    });

    expect(result.current.error).toBe(
      "Stellar RPC could not be reached or timed out. Check your connection and try again.",
    );
    expect(result.current.showPending).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("tells the user a wallet cancellation submitted nothing", async () => {
    shipInvoice.mockRejectedValueOnce(new Error("User declined access"));

    const { result } = renderHook(() =>
      useInvoiceDetailActions(invoiceId, refetch),
    );

    act(() => result.current.ship());
    const { fn } = requestConfirmation.mock.calls[0][0];

    await act(async () => {
      await fn();
    });

    expect(result.current.error).toBe(
      "You cancelled the request in your wallet. Nothing was submitted.",
    );
  });

  it("keeps the action's fallback for an error without a message", async () => {
    shipInvoice.mockRejectedValueOnce({});

    const { result } = renderHook(() =>
      useInvoiceDetailActions(invoiceId, refetch),
    );

    act(() => result.current.ship());
    const { fn } = requestConfirmation.mock.calls[0][0];

    await act(async () => {
      await fn();
    });

    expect(result.current.error).toBe("Unable to mark goods as shipped.");
  });

  it("setShowPending lets a caller dismiss the transaction-pending dialog", () => {
    const { result } = renderHook(() =>
      useInvoiceDetailActions(invoiceId, refetch),
    );

    act(() => result.current.setShowPending(true));
    expect(result.current.showPending).toBe(true);

    act(() => result.current.setShowPending(false));
    expect(result.current.showPending).toBe(false);
  });
});
