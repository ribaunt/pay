export type MoneroNetwork = "mainnet" | "stagenet";

export function getMoneroNetwork(): MoneroNetwork {
  const value = (process.env.MONERO_NETWORK ?? "mainnet").trim().toLowerCase();
  if (value !== "mainnet" && value !== "stagenet") {
    throw new Error("MONERO_NETWORK must be 'mainnet' or 'stagenet'");
  }
  return value;
}

/** Mainnet: 4 = primary, 8 = subaddress. Stagenet: 5 = primary, 7 = subaddress. */
const PREFIXES: Record<MoneroNetwork, string[]> = {
  mainnet: ["4", "8"],
  stagenet: ["5", "7"],
};

export function isValidAddressForNetwork(address: string, network = getMoneroNetwork()): boolean {
  const prefix = address[0];
  return PREFIXES[network].includes(prefix) && /^[0-9A-Za-z]{95}$/.test(address);
}

export function networkLabel(network = getMoneroNetwork()): string {
  return network === "stagenet" ? "stagenet" : "mainnet";
}
