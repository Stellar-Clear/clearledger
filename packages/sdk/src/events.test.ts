import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { decodeSorobanEvent } from "./events.js";

const fixtures = {
  registry: { topics: ["AAAAAwAAACo="], data: "AAAAAwAAAGQ=" },
  invoice: { topics: ["AAAAAwAAAGMA"], data: "AAAAAwAAAMg=" },
  pool: { topics: ["AAAAAwAAASw="], data: "AAAAAwAAAZA=" },
  escrow: { topics: ["AAAAAwAAAZ4="], data: "AAAAAwAAAdI=" },
} as const;

describe("decodeSorobanEvent", () => {
  it.each(Object.entries(fixtures))("decodes the %s fixture", (_name, fixture) => {
    const decoded = decodeSorobanEvent(fixture);
    expect(decoded.topics[0].u32()).toBeGreaterThan(0);
    expect(decoded.data.u32()).toBeGreaterThan(0);
  });

  it("rejects malformed event data", () => {
    expect(() => decodeSorobanEvent({ topics: [], data: "not-xdr" })).toThrow(
      "Invalid Soroban event XDR",
    );
  });

  it("rejects more topics than Soroban permits", () => {
    const topic = xdr.ScVal.scvU32(1).toXDR("base64");
    expect(() =>
      decodeSorobanEvent({ topics: [topic, topic, topic, topic, topic], data: topic }),
    ).toThrow("between 0 and 4 topics");
  });
});
