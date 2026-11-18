const { afterEach, describe, expect, it } = await import("@/testkit");
const { getMoneroNetwork, isValidAddressForNetwork } = await import("./network");

const env = process.env as Record<string, string | undefined>;
const original = env.MONERO_NETWORK;

const MAIN_PRIMARY =
  "48nbZKRkv33Cq7ZbqfhZMNMgYvQurN1XrW669M9GqSETctDoxyFGPDg9zgib3bpjumYFCJ4UEXVkmHyy3yuWP7mME3VJSuz";
const MAIN_SUB =
  "851YMCyZXDKiJu7ckZdREfg5WmGGJgG37CjVvDT4Ds6W8joEXzV2DgSRpjX6cVKKKeMnsAYieKPRCN9wHC93Dj7SNbqJPxc";
const STAGE_PRIMARY =
  "58YaXDfeJVzTFHt3ZKQRsbHYuZtiVnDTMbtTz1Fn5LrQ45uEFEDcRJ2QQuUGitJqNyVqYv2JmGomRbHMtLxfhyybQQU1eRz";
const STAGE_SUB =
  "74k6YeXqVwe1rZTNAkHBHQWYv1D1ki9nnbdojJQJK5QqV7gx7JJiXwFJBoQ4R9TNkbQyMKEjA5uLeF2JoPYYX3QSCtdfNaX";

afterEach(() => {
  if (original === undefined) delete env.MONERO_NETWORK;
  else env.MONERO_NETWORK = original;
});

describe("getMoneroNetwork", () => {
  it("defaults to mainnet", () => {
    delete env.MONERO_NETWORK;
    expect(getMoneroNetwork()).toBe("mainnet");
  });

  it("reads stagenet", () => {
    env.MONERO_NETWORK = "stagenet";
    expect(getMoneroNetwork()).toBe("stagenet");
  });

  it("rejects unknown networks", () => {
    env.MONERO_NETWORK = "testnet";
    expect(() => getMoneroNetwork()).toThrow("MONERO_NETWORK");
  });
});

describe("address isolation", () => {
  it("accepts only mainnet addresses in mainnet mode", () => {
    expect(isValidAddressForNetwork(MAIN_PRIMARY, "mainnet")).toBe(true);
    expect(isValidAddressForNetwork(MAIN_SUB, "mainnet")).toBe(true);
    expect(isValidAddressForNetwork(STAGE_PRIMARY, "mainnet")).toBe(false);
    expect(isValidAddressForNetwork(STAGE_SUB, "mainnet")).toBe(false);
  });

  it("accepts only stagenet addresses in stagenet mode", () => {
    expect(isValidAddressForNetwork(STAGE_PRIMARY, "stagenet")).toBe(true);
    expect(isValidAddressForNetwork(STAGE_SUB, "stagenet")).toBe(true);
    expect(isValidAddressForNetwork(MAIN_PRIMARY, "stagenet")).toBe(false);
    expect(isValidAddressForNetwork(MAIN_SUB, "stagenet")).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(isValidAddressForNetwork("4short", "mainnet")).toBe(false);
    expect(isValidAddressForNetwork(`${MAIN_PRIMARY}0`, "mainnet")).toBe(false);
  });
});

export {};
