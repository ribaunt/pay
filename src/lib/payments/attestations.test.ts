const { describe, expect, it } = await import("@/testkit");
const { createAttestation, verifyAttestation } = await import("./attestations");

const input = {
  from: new Date("2026-11-01T00:00:00.000Z"),
  to: new Date("2026-12-01T00:00:00.000Z"),
  totalAtomic: 150000000000n,
  fiatTotal: "25.00",
  fiatCurrency: "USD",
  confirmedCount: 3,
  network: "stagenet",
};

describe("revenue attestations", () => {
  it("contains only aggregate data", () => {
    const attestation = createAttestation(input, "secret", new Date("2026-12-01T00:00:00.000Z"));
    const serialized = JSON.stringify(attestation);

    expect(attestation.totalXmr).toBe("0.15");
    expect(attestation.confirmedCount).toBe(3);
    expect(serialized).not.toContain("txHash");
    expect(serialized).not.toContain("address");
    expect(serialized).not.toContain("id");
  });

  it("verifies with the correct secret", () => {
    const attestation = createAttestation(input, "secret");
    expect(verifyAttestation(attestation, "secret")).toBe(true);
    expect(verifyAttestation(attestation, "wrong")).toBe(false);
  });

  it("rejects tampering", () => {
    const attestation = createAttestation(input, "secret");
    const tampered = { ...attestation, totalXmr: "99" };
    expect(verifyAttestation(tampered, "secret")).toBe(false);
  });
});

export {};
