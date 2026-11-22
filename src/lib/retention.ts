/** Data retention limits, per record category. Conservative defaults: records
 * merchants may need for accounting/reconciliation are kept for a year. Set a
 * category to 0 to disable purging that category. */

function daysFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer number of days`);
  }
  return parsed;
}

export function retentionPolicy() {
  return {
    paymentRequestsDays: daysFromEnv("RETENTION_PAYMENT_REQUESTS_DAYS", 365),
    webhookDeliveriesDays: daysFromEnv("RETENTION_WEBHOOK_DELIVERIES_DAYS", 30),
    rateLimitBucketsDays: daysFromEnv("RETENTION_RATE_LIMIT_BUCKETS_DAYS", 1),
  };
}

export function cutoff(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
