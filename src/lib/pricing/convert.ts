const SCALE = 1_000_000_000_000n;

function decimalToScaled(value: string): bigint {
  if (!/^\d+(\.\d{1,12})?$/.test(value)) {
    throw new Error("Invalid decimal value");
  }

  const [whole, fraction = ""] = value.split(".");
  const padded = (fraction + "0".repeat(12)).slice(0, 12);
  return BigInt(whole) * SCALE + BigInt(padded);
}

/**
 * Convert a fiat amount to atomic XMR using fixed-point math.
 * Rounds up so the merchant never receives less than the quoted fiat value.
 */
export function fiatToAtomic(
  fiatAmount: string,
  usdPerXmr: number,
  fiatPerUsd: number
): bigint {
  const amount = decimalToScaled(fiatAmount);
  const price = decimalToScaled(usdPerXmr.toFixed(12));
  const fx = decimalToScaled(fiatPerUsd.toFixed(12));

  // fiatPerXmr, still scaled by 1e12
  const product = (price * fx) / SCALE;
  if (product <= 0n) throw new Error("Invalid exchange rate");

  const numerator = amount * SCALE;
  return (numerator + product - 1n) / product;
}
