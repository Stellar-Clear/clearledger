import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
