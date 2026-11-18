const { describe, expect, it } = await import("@/testkit");
const { isExpired, resolvePaymentTimeout } = await import("./timeout");

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("resolvePaymentTimeout", () => {
  it("uses the configured default when omitted", () => {
    const result = resolvePaymentTimeout(undefined, NOW);
    expect(result.timeoutSeconds).toBe(1800);
    expect(result.expiresAt?.toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });

  it("supports a custom timeout", () => {
    const result = resolvePaymentTimeout(120, NOW);
    expect(result.timeoutSeconds).toBe(120);
    expect(result.expiresAt?.toISOString()).toBe("2026-01-01T00:02:00.000Z");
  });

  it("clamps to the allowed range", () => {
    expect(resolvePaymentTimeout(1, NOW).timeoutSeconds).toBe(60);
    expect(resolvePaymentTimeout(999999, NOW).timeoutSeconds).toBe(86400);
  });

  it("supports never-expiring links", () => {
    const result = resolvePaymentTimeout(0, NOW);
    expect(result.expiresAt).toBeNull();
    expect(result.timeoutSeconds).toBe(0);
    expect(isExpired(result.expiresAt, NOW)).toBe(false);
  });

  it("rejects invalid values", () => {
    expect(() => resolvePaymentTimeout(-5, NOW)).toThrow("Invalid timeoutSeconds");
    expect(() => resolvePaymentTimeout("abc", NOW)).toThrow("Invalid timeoutSeconds");
  });
});

describe("isExpired", () => {
  it("detects expired links", () => {
    expect(isExpired(new Date("2025-12-31T23:59:59.000Z"), NOW)).toBe(true);
    expect(isExpired(new Date("2026-01-01T00:00:01.000Z"), NOW)).toBe(false);
    expect(isExpired(null, NOW)).toBe(false);
  });
});

export {};
