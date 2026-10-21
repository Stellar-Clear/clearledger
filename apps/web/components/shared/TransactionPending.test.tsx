import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TransactionPending } from "./TransactionPending";

describe("TransactionPending", () => {
  it("renders loading state correctly", () => {
    render(
      <TransactionPending
        isOpen={true}
        txHash="0x123"
        statusText="Processing... Please wait"
      />,
    );
    expect(screen.getByText(/Processing... Please wait/i)).toBeInTheDocument();
    expect(screen.getByText(/TRANSACTION SIGNED/i)).toBeInTheDocument();
    expect(screen.getByText(/0x123/i)).toBeInTheDocument();
  });

  it("renders empty state correctly (not pending)", () => {
    const { container } = render(
      <TransactionPending isOpen={false} txHash={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the pending state politely without taking focus", () => {
    render(
      <TransactionPending
        isOpen={true}
        txHash={null}
        statusText="Marking goods as shipped..."
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent(
      "Transaction pending. Marking goods as shipped...",
    );
    expect(status).not.toHaveAttribute("tabindex");
    expect(status.contains(document.activeElement)).toBe(false);

    // The assertive region exists so failures can be announced later, but it
    // must stay empty while the transaction is pending.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("announces confirmation politely when the transaction hash arrives", () => {
    const { rerender } = render(
      <TransactionPending isOpen={true} txHash={null} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /Transaction pending/i,
    );

    rerender(<TransactionPending isOpen={true} txHash="0x123" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Transaction confirmed.");
    expect(screen.queryAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("announces failures assertively with a clear reason", () => {
    render(
      <TransactionPending
        isOpen={true}
        txHash={null}
        state="failed"
        errorText="User rejected the signature request."
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent(
      "Transaction failed. User rejected the signature request.",
    );
    expect(alert).not.toHaveAttribute("tabindex");

    // Clearing the polite region prevents the same failure from being spoken
    // twice (once politely and once assertively).
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("announces a confirmation timeout as a failure", () => {
    render(
      <TransactionPending
        isOpen={true}
        txHash={null}
        state="failed"
        errorText="Confirmation timed out. You can close and check status manually."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Confirmation timed out/i,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("TransactionPending accessibility", () => {
  it("traps Tab focus and restores it to the trigger after close", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.textContent = "Open transaction";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <TransactionPending isOpen={true} txHash="0xtx" onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(trigger).toHaveAttribute("inert");

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThanOrEqual(2);

    focusable[focusable.length - 1].focus();
    await user.tab();
    expect(focusable[0]).toHaveFocus();

    focusable[0].focus();
    await user.tab({ shift: true });
    expect(focusable[focusable.length - 1]).toHaveFocus();

    rerender(
      <TransactionPending isOpen={false} txHash="0xtx" onClose={vi.fn()} />,
    );

    expect(trigger).not.toHaveAttribute("inert");
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("keeps focus trapped while authorization guidance is pending and ignores Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <TransactionPending isOpen={true} txHash={null} onClose={onClose} />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByText(/waiting for confirmation/i)).toBeInTheDocument();

    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
