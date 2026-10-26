import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InvoiceStatus } from "./InvoiceStatus";

describe("InvoiceStatus", () => {
  it("renders correctly for Created status", () => {
    render(<InvoiceStatus status="Created" />);
    expect(screen.getByText(/Created/i)).toBeInTheDocument();
  });

  it("renders correctly for Listed status", () => {
    render(<InvoiceStatus status="Listed" />);
    expect(screen.getByText(/Listed/i)).toBeInTheDocument();
  });

  it("renders correctly for Funded status", () => {
    render(<InvoiceStatus status="Funded" />);
    expect(screen.getByText(/Funded/i)).toBeInTheDocument();
  });

  it("renders correctly for Active status", () => {
    render(<InvoiceStatus status="Active" />);
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
  });

  it("renders correctly for Confirmed status", () => {
    render(<InvoiceStatus status="Confirmed" />);
    expect(screen.getByText(/Confirmed/i)).toBeInTheDocument();
  });

  it("renders correctly for Repaid status", () => {
    render(<InvoiceStatus status="Repaid" />);
    expect(screen.getByText(/Repaid/i)).toBeInTheDocument();
  });

  it("renders correctly for Defaulted status", () => {
    render(<InvoiceStatus status="Defaulted" />);
    expect(screen.getByText(/Defaulted/i)).toBeInTheDocument();
  });

  it("uses high contrast text for every lifecycle state", () => {
    const statuses = [
      ["Created", "text-slate-100"],
      ["Listed", "text-teal-100"],
      ["Funded", "text-blue-100"],
      ["Active", "text-indigo-100"],
      ["Confirmed", "text-sky-100"],
      ["Repaid", "text-emerald-100"],
      ["Defaulted", "text-amber-100"],
    ] as const;

    for (const [status, textClass] of statuses) {
      const { unmount } = render(<InvoiceStatus status={status} />);
      expect(screen.getByRole("status")).toHaveClass(textClass);
      unmount();
    }
  });
});
