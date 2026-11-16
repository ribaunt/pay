/**
 * Monero amounts are stored as unsigned 64-bit integers of piconero
 * (1 XMR = 1e12 piconero). Use strings/bigint end-to-end to avoid
 * floating point rounding errors.
 */
const PICONERO_PER_XMR = 1_000_000_000_000n;

export function xmrToAtomic(xmr: string | number): bigint {
  const value = typeof xmr === "number" ? xmr.toString() : xmr.trim();

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("Invalid XMR amount");
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 12) {
    throw new Error("XMR amount supports at most 12 decimal places");
  }

  const padded = (fraction + "0".repeat(12)).slice(0, 12);
  return BigInt(whole) * PICONERO_PER_XMR + BigInt(padded);
}

export function atomicToXmr(atomic: bigint | number | string): string {
  const value = BigInt(atomic);
  const negative = value < 0n;
  const absolute = negative ? -value : value;

  const whole = absolute / PICONERO_PER_XMR;
  const fraction = (absolute % PICONERO_PER_XMR).toString().padStart(12, "0");
  const trimmed = fraction.replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * JSON-RPC expects uint64 amounts as JSON numbers. Guard the safe-integer
 * range so we never silently lose precision in transit.
 */
export function atomicToRpcNumber(atomic: bigint): number {
  if (atomic < 0n || atomic > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is outside the safely representable JSON-RPC range");
  }
  return Number(atomic);
}
