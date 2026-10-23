import { describe, expect, it } from "vitest";
import { describeAttestation } from "./attestation";

const attested = { attestationAgentId: "agent-1", attestedAt: 1_700_000_000, riskScoreBps: 250 };

describe("describeAttestation", () => {
  it("reports a missing registry before anything else", () => {
    expect(describeAttestation({ registryConfigured: false, ...attested }).state).toBe("missing-config");
  });

  it("reports pending when no attestation is recorded", () => {
    expect(describeAttestation({ registryConfigured: true, attestedAt: null, attestationAgentId: null }).state).toBe(
      "pending",
    );
  });

  it("treats an empty agent id as not attested", () => {
    expect(describeAttestation({ registryConfigured: true, attestedAt: 1, attestationAgentId: "" }).state).toBe(
      "pending",
    );
  });

  it("reports valid with the risk score in the next step", () => {
    const status = describeAttestation({ registryConfigured: true, ...attested });
    expect(status.state).toBe("valid");
    expect(status.nextStep).toContain("Risk score 2.50%");
  });

  it("reports rejected, and rejection takes precedence over a valid attestation", () => {
    expect(describeAttestation({ registryConfigured: true, rejected: true, ...attested }).state).toBe("rejected");
  });

  it("omits the risk score when none is recorded", () => {
    const status = describeAttestation({ registryConfigured: true, attestedAt: 1, attestationAgentId: "agent-1" });
    expect(status.state).toBe("valid");
    expect(status.nextStep).not.toContain("Risk score");
  });
});
