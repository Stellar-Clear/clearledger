/**
 * Underwriting attestation status for an invoice, with the next step for the
 * user. Pure, so the copy and the state logic can be tested without rendering.
 *
 * `rejected` is accepted so the status is ready for a rejection signal from
 * the indexer. The indexer does not expose one yet, so callers do not pass it
 * and no invoice is shown as rejected today.
 */

export type AttestationState = "missing-config" | "pending" | "valid" | "rejected";

export interface AttestationInput {
  /** True when `NEXT_PUBLIC_REGISTRY_CONTRACT_ID` is set for this deployment. */
  registryConfigured: boolean;
  attestationAgentId?: string | null;
  attestedAt?: number | null;
  riskScoreBps?: number | null;
  rejected?: boolean;
}

export interface AttestationStatus {
  state: AttestationState;
  title: string;
  nextStep: string;
}

/**
 * Derive the attestation state. Precedence: a rejection wins over a valid
 * attestation, and a missing registry blocks everything, because no attestation
 * can be checked without it.
 *
 * @example
 * ```ts
 * describeAttestation({ registryConfigured: true, attestedAt: null });
 * // { state: "pending", title: "Awaiting underwriter attestation", ... }
 * ```
 */
export function describeAttestation(input: AttestationInput): AttestationStatus {
  if (!input.registryConfigured) {
    return {
      state: "missing-config",
      title: "Attestation cannot be checked",
      nextStep: "This deployment has no agent registry configured. Ask the operator to set NEXT_PUBLIC_REGISTRY_CONTRACT_ID.",
    };
  }

  if (input.rejected) {
    return {
      state: "rejected",
      title: "Attestation rejected",
      nextStep: "The underwriter rejected this invoice, so it cannot be listed for financing. Review the invoice details with the underwriter.",
    };
  }

  const attested = input.attestedAt != null && input.attestationAgentId != null && input.attestationAgentId !== "";
  if (attested) {
    const risk = input.riskScoreBps != null ? ` Risk score ${(input.riskScoreBps / 100).toFixed(2)}%.` : "";
    return {
      state: "valid",
      title: "Attested by a registered underwriter",
      nextStep: `The invoice can be listed for financing.${risk}`,
    };
  }

  return {
    state: "pending",
    title: "Awaiting underwriter attestation",
    nextStep: "A registered underwriter must attest this invoice before it can be listed for financing.",
  };
}
