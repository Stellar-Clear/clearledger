import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: successMock,
    error: errorMock,
  },
}));

describe("toast accessibility", () => {
  beforeEach(() => {
    successMock.mockClear();
    errorMock.mockClear();
  });

  it("announces success through a polite live region", () => {
    showSuccessToast("Deposit Complete", "abc123");

    expect(successMock).toHaveBeenCalledTimes(1);

    const [content, options] = successMock.mock.calls[0];
    const { container } = render(<>{content}</>);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Transaction confirmed",
    );
    expect(
      screen.getByRole("link", { name: /view on stellar expert/i }),
    ).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
    expect(options).toMatchObject({ duration: 5000 });
  });

  it("announces failures through an assertive live region", () => {
    showErrorToast("Withdrawal Failed", new Error("Insufficient balance"));

    expect(errorMock).toHaveBeenCalledTimes(1);

    const [content, options] = errorMock.mock.calls[0];
    const { container } = render(<>{content}</>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Transaction failed",
    );
    expect(screen.getByText("Insufficient balance")).toBeInTheDocument();
    expect(options).toMatchObject({ duration: 6000 });
  });
});
