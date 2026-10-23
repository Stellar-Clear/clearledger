import type { Invoice } from "@/types";

/**
 * Explains dual-party delivery confirmation: which party has confirmed, and
 * what must happen before repayment can proceed. Pure, so the state logic can
 * be tested without rendering.
 */

export type DeliveryInput = Pick<Invoice, "status" | "issuerConfirmed" | "buyerConfirmed">;

export interface DeliveryConfirmationStatus {
  issuerConfirmed: boolean;
  buyerConfirmed: boolean;
  nextAction: string;
}

/**
 * @example
 * ```ts
 * describeDeliveryConfirmation({ status: "Active", issuerConfirmed: true, buyerConfirmed: false });
 * // { issuerConfirmed: true, buyerConfirmed: false, nextAction: "Waiting for the buyer ..." }
 * ```
 */
export function describeDeliveryConfirmation(invoice: DeliveryInput): DeliveryConfirmationStatus {
  const { status, issuerConfirmed, buyerConfirmed } = invoice;
  const base = { issuerConfirmed, buyerConfirmed };

  if (status === "Repaid") return { ...base, nextAction: "The invoice is repaid. No delivery action is needed." };
  if (status === "Defaulted") return { ...base, nextAction: "The invoice defaulted. Delivery confirmation no longer applies." };
  if (status === "Funded") return { ...base, nextAction: "The issuer must mark the invoice as shipped before delivery can be confirmed." };

  if (issuerConfirmed && buyerConfirmed) {
    return { ...base, nextAction: "Both parties confirmed delivery. The buyer can now repay the invoice." };
  }
  if (issuerConfirmed) {
    return { ...base, nextAction: "Waiting for the buyer to confirm receipt. Repayment unlocks after buyer confirmation." };
  }
  if (buyerConfirmed) {
    return { ...base, nextAction: "Waiting for the issuer to confirm delivery before repayment can proceed." };
  }
  return {
    ...base,
    nextAction: "Waiting for the issuer to confirm delivery, then for the buyer to confirm receipt.",
  };
}
