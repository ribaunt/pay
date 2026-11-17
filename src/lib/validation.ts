import { xmrToAtomic } from "./monero/money";
import { getMoneroNetwork, isValidAddressForNetwork } from "./monero/network";

export function requireMoneroAddress(value: unknown, label = "address"): string {
  const network = getMoneroNetwork();
  if (typeof value !== "string" || !isValidAddressForNetwork(value.trim(), network)) {
    throw new Error(
      `Invalid ${network} address (expected ${network === "stagenet" ? "5... or 7..." : "4... or 8..."})`
    );
  }
  return value.trim();
}

export function requireViewKey(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error("Invalid private view key (expected 64 hex characters)");
  }
  return value.trim().toLowerCase();
}

export function requireXmrAmount(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid XMR amount");
  xmrToAtomic(value);
  return value;
}

export function requireTxHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error("Invalid transaction hash (expected 64 hex characters)");
  }
  return value.trim().toLowerCase();
}

export function requireSignature(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 20 || value.length > 8192) {
    throw new Error("Invalid payment proof signature");
  }
  return value.trim();
}

export function optionalMessage(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 500) throw new Error("Invalid message");
  return value;
}

export function optionalLabel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 200) throw new Error("Invalid label");
  return value;
}

export function optionalRestoreHeight(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const height = Number(value);
  if (!Number.isInteger(height) || height < 0) throw new Error("Invalid restore height");
  return height;
}
