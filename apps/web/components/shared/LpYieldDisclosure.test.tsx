import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LpYieldDisclosure } from "./LpYieldDisclosure";

describe("LpYieldDisclosure", () => {
  it("identifies yield as historical accounting and explains liquidity risk", () => {
    render(<LpYieldDisclosure />);

    expect(screen.getByText(/historical protocol accounting/i)).toBeInTheDocument();
    expect(screen.getByText(/not a forecast or promised return/i)).toBeInTheDocument();
    expect(screen.getByText(/liquidity may be unavailable/i)).toBeInTheDocument();
  });
});
