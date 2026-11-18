const { describe, expect, it, vi } = await import("@/testkit");
const { aggregatePrices, clearPriceCache, getSupportedCurrencies } = await import("./oracle");

describe("aggregatePrices", () => {
  it("uses the median of healthy sources", () => {
    expect(aggregatePrices([100, 101, 102]).price).toBe(101);
  });

  it("marks a single source as degraded", () => {
    expect(aggregatePrices([100]).degraded).toBe(true);
  });

  it("marks multiple agreeing sources as not degraded", () => {
    expect(aggregatePrices([100, 101]).degraded).toBe(false);
  });

  it("filters outliers beyond the threshold", () => {
    const result = aggregatePrices([100, 101, 102, 1000]);
    expect(result.price).toBe(101);
    expect(result.degraded).toBe(false);
  });

  it("throws when no valid source exists", () => {
    expect(() => aggregatePrices([])).toThrow("No valid price sources");
    expect(() => aggregatePrices([0, -1])).toThrow("No valid price sources");
  });
});

describe("supported currencies", () => {
  it("uses the FX provider currency list", async () => {
    clearPriceCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ USD: {}, EUR: {}, JPY: {}, TRY: {} }),
      })
    );

    const codes = await getSupportedCurrencies();
    expect(codes).toContain("JPY");
    expect(codes).toContain("TRY");
    clearPriceCache();
  });
});

export {};
