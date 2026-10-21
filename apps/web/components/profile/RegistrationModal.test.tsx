import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RegistrationModal } from "./RegistrationModal";

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: vi.fn(() => ({ current: null })),
}));

describe("RegistrationModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <RegistrationModal
        isOpen={false}
        onClose={vi.fn()}
        register={vi.fn()}
        isRegistering={false}
        registerError={null}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders the registration dialog when open", () => {
    render(
      <RegistrationModal
        isOpen={true}
        onClose={vi.fn()}
        register={vi.fn()}
        isRegistering={false}
        registerError={null}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/register business metadata/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /register profile/i }),
    ).toBeInTheDocument();
  });

  it("closes when the close button, cancel button, or backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <RegistrationModal
        isOpen={true}
        onClose={onClose}
        register={vi.fn()}
        isRegistering={false}
        registerError={null}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close registration dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("blocks submission on the always-failing company name check (no input renders for it)", async () => {
    // The form has no Company Name field, so `companyName` is permanently
    // an empty string and this check can never pass — pre-existing
    // behavior being preserved as-is by this extraction, not endorsed.
    // Tax ID and Country are filled in so the browser's native `required`
    // validation on those two fields doesn't block the submit first.
    const register = vi.fn();
    render(
      <RegistrationModal
        isOpen={true}
        onClose={vi.fn()}
        register={register}
        isRegistering={false}
        registerError={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/eu123456789/i), {
      target: { value: "TAX-123" },
    });
    fireEvent.change(screen.getByPlaceholderText(/germany/i), {
      target: { value: "Germany" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register profile/i }));

    expect(
      await screen.findByText(/company name is required/i),
    ).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it("announces the registerError message through an alert when the mutation fails", () => {
    render(
      <RegistrationModal
        isOpen={true}
        onClose={vi.fn()}
        register={vi.fn()}
        isRegistering={false}
        registerError={new Error("Registry contract rejected the tx")}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent(/registry contract rejected the tx/i);
  });

  it("disables the submit and cancel buttons while isRegistering is true", () => {
    render(
      <RegistrationModal
        isOpen={true}
        onClose={vi.fn()}
        register={vi.fn()}
        isRegistering={true}
        registerError={null}
      />,
    );

    expect(screen.getByRole("button", { name: /signing/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
  });

  it("switching the role toggle updates the selected button's styling", () => {
    render(
      <RegistrationModal
        isOpen={true}
        onClose={vi.fn()}
        register={vi.fn()}
        isRegistering={false}
        registerError={null}
      />,
    );

    const buyerButton = screen.getByRole("button", {
      name: /obligor \/ buyer/i,
    });
    const issuerButton = screen.getByRole("button", { name: /sme \/ issuer/i });

    expect(issuerButton.className).toContain("border-primary");
    fireEvent.click(buyerButton);
    expect(buyerButton.className).toContain("border-primary");
  });
});
