const { describe, expect, it } = await import("@/testkit");
const { atomicToRpcNumber, atomicToXmr, xmrToAtomic } = await import("./money");

describe("xmrToAtomic", () => {
  it("converts whole XMR", () => {
    expect(xmrToAtomic("1")).toBe(1_000_000_000_000n);
    expect(xmrToAtomic("12")).toBe(12_000_000_000_000n);
    expect(xmrToAtomic("0")).toBe(0n);
  });

  it("converts fractional XMR using 12 decimals", () => {
    expect(xmrToAtomic("0.1")).toBe(100_000_000_000n);
    expect(xmrToAtomic("1.234567890123")).toBe(1_234_567_890_123n);
    expect(xmrToAtomic("0.000000000001")).toBe(1n);
    expect(xmrToAtomic("12.5")).toBe(12_500_000_000_000n);
  });

  it("handles numbers without floating point drift", () => {
    expect(xmrToAtomic(0.1)).toBe(100_000_000_000n);
  });

  it("rejects malformed amounts", () => {
    expect(() => xmrToAtomic("abc")).toThrow("Invalid XMR amount");
    expect(() => xmrToAtomic("-1")).toThrow("Invalid XMR amount");
    expect(() => xmrToAtomic("1.2.3")).toThrow("Invalid XMR amount");
  });

  it("rejects more than 12 decimal places", () => {
    expect(() => xmrToAtomic("0.0000000000001")).toThrow("at most 12 decimal places");
  });
});

describe("atomicToXmr", () => {
  it("converts atomic units back to XMR strings", () => {
    expect(atomicToXmr(1_000_000_000_000n)).toBe("1");
    expect(atomicToXmr(100_000_000_000n)).toBe("0.1");
    expect(atomicToXmr(1n)).toBe("0.000000000001");
    expect(atomicToXmr(0n)).toBe("0");
  });

  it("accepts strings and numbers", () => {
    expect(atomicToXmr("1234567890123")).toBe("1.234567890123");
    expect(atomicToXmr(1_000_000_000_000)).toBe("1");
  });

  it("round-trips without precision loss", () => {
    const amounts = ["0", "1", "0.1", "0.000000000001", "1234.567891234567", "999999.999999999999"];
    for (const amount of amounts) {
      expect(atomicToXmr(xmrToAtomic(amount))).toBe(amount);
    }
  });
});

describe("atomicToRpcNumber", () => {
  it("passes through safe integers", () => {
    expect(atomicToRpcNumber(0n)).toBe(0);
    expect(atomicToRpcNumber(1_000_000_000_000n)).toBe(1_000_000_000_000);
  });

  it("rejects values beyond the JSON safe-integer range", () => {
    expect(() => atomicToRpcNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      "safely representable"
    );
    expect(() => atomicToRpcNumber(-1n)).toThrow("safely representable");
  });
});

export {};
