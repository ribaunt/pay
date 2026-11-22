const { createHash } = await import("node:crypto");
const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/prisma", () => ({
  prisma: {
    wallet: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    subaddress: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentProof: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

await vi.mock(new URL("./rpc", import.meta.url).href, async (importOriginal: any) => {
  const actual = await (importOriginal as () => Promise<any>)();
  return {
    ...actual,
    walletRpc: vi.fn(),
    walletRpcPing: vi.fn(),
  };
});

const { prisma } = await import("@/lib/prisma");
const { walletRpc } = await import("./rpc");
const {
  createPaymentProof,
  createPaymentRequest,
  createSubaddress,
  createFreshSubaddress,
  markSubaddressUsed,
  refreshSubaddressUsage,
  setupWatchOnlyWallet,
  verifyPaymentProof,
} = await import("./wallet");

const rpc = vi.mocked(walletRpc);
const USER_ID = "user-test-1";

const PRIMARY_ADDRESS =
  "46W8kLbMPuo7QBYDqsQyn2Nf3nW5G3v9K3LaWCB6uAbkV6uEJKqun776N9z2UrN4UoYEn2AWXbtQ5EK2D8vxTo2NDWpxPJo";
const VIEW_KEY = "00C0A2D31BFB5D279F6EB032D984FD3F6D7E689A529D86A85F4B6A869CAF420C";

function expectedWalletFile() {
  return `watch-mainnet-${createHash("sha256")
    .update(`${USER_ID}:${PRIMARY_ADDRESS}:${VIEW_KEY.toLowerCase()}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function mockRpc(responses: Record<string, unknown>) {
  rpc.mockImplementation(async (method: string) => {
    if (method in responses) return responses[method] as never;
    throw new Error(`Unexpected RPC method: ${method}`);
  });
}

const addressResponse = {
  address: PRIMARY_ADDRESS,
  info: "",
  addresses: [
    { address: PRIMARY_ADDRESS, label: "Primary account", address_index: 0, used: false },
  ],
};
const balanceResponse = {
  balance: 0,
  unlocked_balance: 0,
  blocks_to_unlock: 0,
  time_to_unlock: 0,
  multisig_import_needed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
    walletFile: expectedWalletFile(),
  } as never);
  vi.mocked(prisma.wallet.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.wallet.findFirst).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(prisma.paymentProof.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.paymentProof.findMany).mockResolvedValue([]);
  vi.mocked(prisma.subaddress.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.subaddress.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.subaddress.findMany).mockResolvedValue([]);
  vi.mocked(prisma.subaddress.updateMany).mockResolvedValue({ count: 1 });
  mockRpc({
    get_address: addressResponse,
    get_balance: balanceResponse,
    close_wallet: {},
    open_wallet: {},
    generate_from_keys: {},
    rescan_blockchain: {},
  });
});

describe("setupWatchOnlyWallet validation", () => {
  it("rejects an invalid primary address", async () => {
    await expect(
      setupWatchOnlyWallet(USER_ID, { address: "not-an-address", viewKey: VIEW_KEY })
    ).rejects.toThrow("Invalid mainnet address");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid view key", async () => {
    await expect(
      setupWatchOnlyWallet(USER_ID, { address: PRIMARY_ADDRESS, viewKey: "abc" })
    ).rejects.toThrow("Invalid private view key");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a negative restore height", async () => {
    await expect(
      setupWatchOnlyWallet(USER_ID, {
        address: PRIMARY_ADDRESS,
        viewKey: VIEW_KEY,
        restoreHeight: -1,
      })
    ).rejects.toThrow("Invalid restore height");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setupWatchOnlyWallet", () => {
  it("restores a watch-only wallet via generate_from_keys", async () => {
    const wallet = await setupWatchOnlyWallet(USER_ID, {
      address: PRIMARY_ADDRESS,
      viewKey: VIEW_KEY,
      restoreHeight: 12345,
      description: "Storefront",
    });

    const generateCall = rpc.mock.calls.find(([method]) => method === "generate_from_keys");
    expect(generateCall).toBeDefined();
    expect(generateCall?.[1]).toMatchObject({
      filename: expectedWalletFile(),
      address: PRIMARY_ADDRESS,
      viewkey: VIEW_KEY.toLowerCase(),
      restore_height: 12345,
      language: "English",
      autosave_current: true,
    });
    expect(generateCall?.[1]).not.toHaveProperty("spendkey");

    expect(wallet).toMatchObject({
      name: expectedWalletFile(),
      address: PRIMARY_ADDRESS,
      balanceXmr: "0",
      unlockedBalanceXmr: "0",
    });
  });

  it("rejects a keypair whose generated files cannot be reopened", async () => {
    rpc.mockImplementation(async (method: string) => {
      if (method === "open_wallet") throw new Error("file does not correspond to .keys");
      if (method === "close_wallet" || method === "generate_from_keys") return {} as never;
      if (method === "get_address") return addressResponse as never;
      if (method === "get_balance") return balanceResponse as never;
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    await expect(
      setupWatchOnlyWallet(USER_ID, { address: PRIMARY_ADDRESS, viewKey: VIEW_KEY })
    ).rejects.toThrow("do not correspond");
    expect(prisma.wallet.upsert).not.toHaveBeenCalled();
  });

  it("encrypts the view key and scopes the wallet to the user", async () => {
    await setupWatchOnlyWallet(USER_ID, {
      address: PRIMARY_ADDRESS,
      viewKey: VIEW_KEY,
      description: "Storefront",
    });

    const upsert = vi.mocked(prisma.wallet.upsert).mock.calls[0][0];
    expect(upsert.where).toEqual({ userId: USER_ID });
    expect(upsert.create).toMatchObject({
      name: expectedWalletFile(),
      userId: USER_ID,
      isWatchOnly: true,
      description: "Storefront",
    });

    const storedViewKey = (upsert.create as { viewKey: string }).viewKey;
    expect(storedViewKey).toMatch(/^v2\./);
    expect(storedViewKey).not.toContain(VIEW_KEY);
  });
});

describe("subaddresses", () => {
  it("creates a labelled subaddress", async () => {
    const newAddress =
      "8AeUGNGhfafB6eWTv5aqaaMSwX8Rd8TQn1eDKYnAgoFZ43B6LePnz9ibM3agj5behEhDJu3CRw7UR8TWzHdb11aZ1NpYEiv";
    mockRpc({
      get_address: addressResponse,
      get_balance: balanceResponse,
      create_address: {
        address: newAddress,
        address_index: 1,
        address_indices: [1],
        addresses: [newAddress],
      },
    });

    const result = await createSubaddress(USER_ID, "Invoice 1");

    expect(result).toEqual({ address: newAddress, addressIndex: 1, label: "Invoice 1" });
    const createCall = rpc.mock.calls.find(([method]) => method === "create_address");
    expect(createCall?.[1]).toEqual({ account_index: 0, label: "Invoice 1" });
  });

  it("uses a fresh subaddress for each payment request", async () => {
    const freshAddress =
      "83gsqoRNcJ91QQhHY3esxHKxVbA1UJHuKS6BCKKdVT9fNchQYqHPHwrRNTZx1EychXizWJuqveDXnSGNFgEmYuGZ9P5Ko1v";
    mockRpc({
      get_address: addressResponse,
      get_balance: balanceResponse,
      create_address: {
        address: freshAddress,
        address_index: 7,
        address_indices: [7],
        addresses: [freshAddress],
      },
      make_uri: { uri: `monero:${freshAddress}?tx_amount=0.100000000000` },
    });

    const result = await createPaymentRequest(USER_ID, "0.1", "Order 42");

    expect(result.address).toBe(freshAddress);
    expect(result.addressIndex).toBe(7);
    expect(result.amountAtomic).toBe("100000000000");
    expect(result.uri).toContain(freshAddress);

    const uriCall = rpc.mock.calls.find(([method]) => method === "make_uri");
    expect(uriCall?.[1]).toMatchObject({ address: freshAddress, amount: 100_000_000_000 });
  });
});

describe("payment proofs", () => {
  const TX_HASH = "a".repeat(64);
  const SIGNATURE = "InProofV1" + "b".repeat(80);

  it("generates and stores a transaction proof", async () => {
    mockRpc({
      get_address: addressResponse,
      get_balance: balanceResponse,
      get_tx_proof: { signature: SIGNATURE },
    });

    const proof = await createPaymentProof(USER_ID, {
      txHash: TX_HASH,
      address: PRIMARY_ADDRESS,
      message: "order-42",
    });

    expect(proof).toEqual({
      txHash: TX_HASH,
      address: PRIMARY_ADDRESS,
      message: "order-42",
      signature: SIGNATURE,
    });

    const call = rpc.mock.calls.find(([method]) => method === "get_tx_proof");
    expect(call?.[1]).toEqual({
      txid: TX_HASH,
      address: PRIMARY_ADDRESS,
      message: "order-42",
    });
    expect(prisma.paymentProof.upsert).toHaveBeenCalled();
  });

  it("rejects an invalid transaction hash before calling RPC", async () => {
    await expect(
      createPaymentProof(USER_ID, { txHash: "nope", address: PRIMARY_ADDRESS })
    ).rejects.toThrow("Invalid transaction hash");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("marks a subaddress as used exactly once", async () => {
    await markSubaddressUsed("wallet-1", "8address");

    expect(prisma.subaddress.updateMany).toHaveBeenCalledWith({
      where: { walletId: "wallet-1", address: "8address", used: false },
      data: expect.objectContaining({ used: true }),
    });
  });

  it("verifies a proof without requiring a specific user", async () => {
    mockRpc({
      get_address: addressResponse,
      get_balance: balanceResponse,
      check_tx_proof: {
        good: true,
        confirmations: 12,
        in_pool: false,
        received: 100_000_000_000,
      },
    });

    const result = await verifyPaymentProof({
      txHash: TX_HASH,
      address: PRIMARY_ADDRESS,
      message: "order-42",
      signature: SIGNATURE,
    });

    expect(result).toEqual({
      good: true,
      confirmations: 12,
      inPool: false,
      receivedXmr: "0.1",
      receivedAtomic: "100000000000",
    });
    expect(prisma.wallet.findFirst).toHaveBeenCalled();
  });
});

describe("subaddress rotation", () => {
  it("syncs used status from the wallet RPC", async () => {
    mockRpc({
      get_address: {
        ...addressResponse,
        addresses: [
          { ...addressResponse.addresses[0], used: true },
        ],
      },
      get_balance: balanceResponse,
    });

    await refreshSubaddressUsage(USER_ID);

    expect(prisma.subaddress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ used: true }),
      })
    );
  });

  it("creates and stores a fresh subaddress", async () => {
    const fresh = {
      address: "8freshaddress",
      address_index: 9,
      address_indices: [9],
      addresses: ["8freshaddress"],
    };
    mockRpc({ get_address: addressResponse, get_balance: balanceResponse, create_address: fresh });

    const result = await createFreshSubaddress(USER_ID, "new invoice");

    expect(result.addressIndex).toBe(9);
    expect(prisma.subaddress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ addressIndex: 9, label: "new invoice" }),
      })
    );
  });
});

export {};
