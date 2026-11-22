const { describe, expect, it } = await import("@/testkit");
const { cutoff, retentionPolicy } = await import("./retention");

describe("retention policy", () => {
  it("uses conservative defaults", () => {
    expect(retentionPolicy()).toEqual({
      paymentRequestsDays: 365,
      webhookDeliveriesDays: 30,
      rateLimitBucketsDays: 1,
    });
  });

  it("reads per-category overrides", () => {
    const original = process.env.RETENTION_PAYMENT_REQUESTS_DAYS;
    process.env.RETENTION_PAYMENT_REQUESTS_DAYS = "90";
    try {
      expect(retentionPolicy().paymentRequestsDays).toBe(90);
    } finally {
      if (original === undefined) delete process.env.RETENTION_PAYMENT_REQUESTS_DAYS;
      else process.env.RETENTION_PAYMENT_REQUESTS_DAYS = original;
    }
  });

  it("rejects invalid day values", () => {
    const original = process.env.RETENTION_WEBHOOK_DELIVERIES_DAYS;
    process.env.RETENTION_WEBHOOK_DELIVERIES_DAYS = "-1";
    try {
      expect(() => retentionPolicy()).toThrow("non-negative integer");
    } finally {
      if (original === undefined) delete process.env.RETENTION_WEBHOOK_DELIVERIES_DAYS;
      else process.env.RETENTION_WEBHOOK_DELIVERIES_DAYS = original;
    }
  });

  it("computes a cutoff relative to now", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    expect(cutoff(10, now).toISOString()).toBe("2025-12-31T00:00:00.000Z");
  });
});

export {};
