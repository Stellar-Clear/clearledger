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
