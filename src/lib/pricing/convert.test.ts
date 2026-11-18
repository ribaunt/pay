const { describe, expect, it } = await import("@/testkit");
const { fiatToAtomic } = await import("./convert");

describe("fiatToAtomic", () => {
  it("converts USD to atomic XMR", () => {
    expect(fiatToAtomic("10", 200, 1)).toBe(50_000_000_000n);
  });

  it("converts a fiat currency via FX rate", () => {
    // 1 XMR = 200 USD, 1 USD = 40 TRY => 1 XMR = 8000 TRY
    expect(fiatToAtomic("8", 200, 40)).toBe(1_000_000_000n);
  });

  it("rounds up to the nearest atomic unit", () => {
    const result = fiatToAtomic("0.01", 3, 1);
    expect(result).toBe(3_333_333_334n);
  });

  it("rejects malformed fiat amounts", () => {
    expect(() => fiatToAtomic("abc", 200, 1)).toThrow("Invalid decimal");
    expect(() => fiatToAtomic("-1", 200, 1)).toThrow("Invalid decimal");
  });

  it("rejects invalid rates", () => {
    expect(() => fiatToAtomic("10", 0, 1)).toThrow("Invalid exchange rate");
    expect(() => fiatToAtomic("10", 200, 0)).toThrow("Invalid exchange rate");
  });
});

export {};
