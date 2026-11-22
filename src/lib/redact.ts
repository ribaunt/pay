/** Replaces values that must never appear in logs, traces or error messages. */
export function redact(value: string | null | undefined): string {
  if (!value) return "<empty>";
  const raw = String(value);

  const patterns: Array<[RegExp, string]> = [
    [/(x-api-key|x-csrf-token|authorization|x-pay-signature|cookie)\s*[:=]\s*\S+/gi, "$1=<redacted>"],
    [/\b(pay_session|pay_csrf)=[^\s;]+/gi, "$1=<redacted>"],
    [/\b(token|status_token|api_key)=[^\s&"']+/gi, "$1=<redacted>"],
    [/\bpk_[A-Za-z0-9_-]{20,}/g, "<redacted-api-key>"],
    [/\bv[12]\.[^\s"']+/g, "<redacted-envelope>"],
    [/\bwhsec_[A-Za-z0-9_-]+/g, "<redacted-webhook-secret>"],
    // Mainnet/stagenet primary and subaddress prefixes: 4/8 and 5/7 (9 on testnet).
    [/\b[45789][0-9A-Za-z]{94}\b/g, "<redacted-monero-address>"],
  ];

  return patterns.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), raw);
}
