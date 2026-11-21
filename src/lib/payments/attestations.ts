import { createHmac, timingSafeEqual } from "node:crypto";
import { atomicToXmr } from "@/lib/monero/money";

export type AttestationInput = {
  from: Date;
  to: Date;
  totalAtomic: bigint;
  fiatTotal: string | null;
  fiatCurrency: string | null;
  confirmedCount: number;
  network: string;
};

export type Attestation = {
  kind: "ribaunt-pay-revenue-attestation";
  version: 1;
  from: string;
  to: string;
  network: string;
  confirmedCount: number;
  totalXmr: string;
  totalAtomic: string;
  fiatTotal: string | null;
  fiatCurrency: string | null;
  generatedAt: string;
  signature: string;
};

function payload(attestation: Omit<Attestation, "signature">): string {
  return JSON.stringify(attestation);
}

/** Create a signed aggregate statement without individual payment details. */
export function createAttestation(
  input: AttestationInput,
  secret: string,
  now = new Date()
): Attestation {
  const unsigned: Omit<Attestation, "signature"> = {
    kind: "ribaunt-pay-revenue-attestation",
    version: 1,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    network: input.network,
    confirmedCount: input.confirmedCount,
    totalXmr: atomicToXmr(input.totalAtomic),
    totalAtomic: input.totalAtomic.toString(),
    fiatTotal: input.fiatTotal,
    fiatCurrency: input.fiatCurrency,
    generatedAt: now.toISOString(),
  };
  const signature = createHmac("sha256", secret).update(payload(unsigned)).digest("hex");
  return { ...unsigned, signature };
}

/** Verify the signature without needing an account or database access. */
export function verifyAttestation(attestation: Attestation, secret: string): boolean {
  const { signature, ...unsigned } = attestation;
  const expected = createHmac("sha256", secret).update(payload(unsigned)).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
