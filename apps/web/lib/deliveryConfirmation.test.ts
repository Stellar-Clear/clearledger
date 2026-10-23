import { describe, expect, it } from "vitest";
import { describeDeliveryConfirmation } from "./deliveryConfirmation";

const base = { issuerConfirmed: false, buyerConfirmed: false };

describe("describeDeliveryConfirmation", () => {
  it("asks the issuer to ship while the invoice is only funded", () => {
    expect(describeDeliveryConfirmation({ status: "Funded", ...base }).nextAction).toContain("must mark the invoice as shipped");
  });

  it("waits for both parties when neither has confirmed", () => {
    const status = describeDeliveryConfirmation({ status: "Active", ...base });
    expect(status.nextAction).toContain("issuer to confirm delivery, then");
    expect(status.issuerConfirmed).toBe(false);
    expect(status.buyerConfirmed).toBe(false);
  });

  it("waits for the buyer when only the issuer has confirmed", () => {
    const status = describeDeliveryConfirmation({ status: "Active", issuerConfirmed: true, buyerConfirmed: false });
    expect(status.nextAction).toContain("buyer to confirm receipt");
  });

  it("waits for the issuer when only the buyer has confirmed", () => {
    const status = describeDeliveryConfirmation({ status: "Confirmed", issuerConfirmed: false, buyerConfirmed: true });
    expect(status.nextAction).toContain("issuer to confirm delivery");
  });

  it("says repayment can proceed once both parties have confirmed", () => {
    const status = describeDeliveryConfirmation({ status: "Confirmed", issuerConfirmed: true, buyerConfirmed: true });
    expect(status.nextAction).toContain("can now repay");
  });

  it("reports no delivery action after repayment or default", () => {
    expect(describeDeliveryConfirmation({ status: "Repaid", ...base }).nextAction).toContain("No delivery action");
    expect(describeDeliveryConfirmation({ status: "Defaulted", ...base }).nextAction).toContain("defaulted");
  });
});
