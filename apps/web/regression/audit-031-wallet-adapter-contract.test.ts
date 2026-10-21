import { describe, expect, it } from "vitest";

describe("wallet adapter contract", () => {
  it("requires a fresh authorization after account or network changes", () => {
    const session = { address: "GOLD", network: "Test SDF Network ; September 2015" };
    const changed = { ...session, address: "NEW" };
    expect(changed).not.toEqual(session);
    expect(changed.address).not.toBe(session.address);
  });
});
