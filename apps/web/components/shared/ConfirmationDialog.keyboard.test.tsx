import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { useConfirmDialogStore } from "@/store/confirmDialog";

// These tests use the real focus trap and store (the sibling file mocks both),
// so they exercise keyboard behaviour: focus entry, Escape, Tab cycling, and
// focus restoration.

const pendingAction = {
  label: "Withdraw",
  invoiceId: "invoice_123456789_long_hash",
  fn: vi.fn(),
};

function openDialog() {
  act(() => {
    useConfirmDialogStore.setState({ pendingAction });
  });
  return screen.getByRole("dialog");
}

describe("ConfirmationDialog keyboard behaviour", () => {
  afterEach(() => {
    cleanup();
    act(() => {
      useConfirmDialogStore.setState({ pendingAction: null });
    });
    pendingAction.fn.mockClear();
  });

  it("moves focus into the dialog when it opens", () => {
    render(<ConfirmationDialog />);
    const dialog = openDialog();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape without running the action", () => {
    render(<ConfirmationDialog />);
    const dialog = openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(useConfirmDialogStore.getState().pendingAction).toBeNull();
    expect(pendingAction.fn).not.toHaveBeenCalled();
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<ConfirmationDialog />);
    const dialog = openDialog();
    const confirm = screen.getByRole("button", { name: /^confirm$/i });
    act(() => {
      confirm.focus();
    });
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(confirm);
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    render(<ConfirmationDialog />);
    openDialog();
    const confirm = screen.getByRole("button", { name: /^confirm$/i });
    const close = screen.getByRole("button", { name: /close confirmation dialog/i });
    act(() => {
      close.focus();
    });
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("exposes Confirm and Cancel as native buttons, so Enter and Space activate them", () => {
    render(<ConfirmationDialog />);
    openDialog();
    expect(screen.getByRole("button", { name: /^confirm$/i }).tagName).toBe("BUTTON");
    expect(screen.getByRole("button", { name: /^cancel$/i }).tagName).toBe("BUTTON");
  });

  it("returns focus to the element that opened the dialog", () => {
    render(
      <>
        <button type="button">Open withdraw</button>
        <ConfirmationDialog />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Open withdraw" });
    act(() => {
      opener.focus();
    });
    openDialog();
    act(() => {
      useConfirmDialogStore.getState().cancel();
    });
    expect(document.activeElement).toBe(opener);
  });
});
