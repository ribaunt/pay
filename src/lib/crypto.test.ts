const { describe, expect, it } = await import("@/testkit");
const { createCipheriv, randomBytes } = await import("node:crypto");
const { decryptSecret, encryptSecret, needsRotation, reencryptSecret } = await import("./crypto");

describe("secret encryption", () => {
  it("round-trips a secret in a versioned envelope", () => {
    const encrypted = encryptSecret("view-key-secret", "view-key", "wallet-1");
    expect(encrypted).toMatch(/^v2\.[^.]+\.[^.]+\.[^.]+\.[^.]+$/);
    expect(encrypted).not.toContain("view-key-secret");
    expect(decryptSecret(encrypted, "view-key", "wallet-1")).toBe("view-key-secret");
    expect(needsRotation(encrypted)).toBe(false);
  });

  it("uses a random IV", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("secret", "webhook-secret", "endpoint-1");
    const parts = encrypted.split(".");
    parts[4] = `${parts[4].slice(0, -2)}xx`;
    expect(() => decryptSecret(parts.join("."), "webhook-secret", "endpoint-1")).toThrow();
  });

  it("binds ciphertext to its purpose and record id via AAD", () => {
    const encrypted = encryptSecret("secret", "webhook-secret", "endpoint-1");
    expect(() => decryptSecret(encrypted, "webhook-secret", "endpoint-2")).toThrow();
    expect(() => decryptSecret(encrypted, "view-key", "endpoint-1")).toThrow();
  });

  it("reads legacy v1 records", () => {
    const previous = process.env.WALLET_ENCRYPTION_KEY;
    process.env.WALLET_ENCRYPTION_KEY = "a".repeat(64);
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.from("a".repeat(64), "hex"), iv);
      const ciphertext = Buffer.concat([cipher.update("legacy", "utf8"), cipher.final()]);
      const legacy = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
      expect(decryptSecret(legacy)).toBe("legacy");
      expect(needsRotation(legacy)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.WALLET_ENCRYPTION_KEY;
      else process.env.WALLET_ENCRYPTION_KEY = previous;
    }
  });

  it("rejects reusing a key id with different key material", () => {
    const previousKeys = process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS;
    const active = process.env.WALLET_ENCRYPTION_KEY;
    const activeId = process.env.WALLET_ENCRYPTION_KEY_ID;
    process.env.WALLET_ENCRYPTION_KEY_ID = "env-1";
    process.env.WALLET_ENCRYPTION_KEY = "b".repeat(64);
    process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS = `env-1:${"a".repeat(64)}`;
    try {
      expect(() => encryptSecret("secret")).toThrow("collides");
    } finally {
      if (active === undefined) delete process.env.WALLET_ENCRYPTION_KEY;
      else process.env.WALLET_ENCRYPTION_KEY = active;
      if (previousKeys === undefined) delete process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS;
      else process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS = previousKeys;
      if (activeId === undefined) delete process.env.WALLET_ENCRYPTION_KEY_ID;
      else process.env.WALLET_ENCRYPTION_KEY_ID = activeId;
    }
  });

  it("rotates records to the active key", () => {
    const previousKeys = process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS;
    const active = process.env.WALLET_ENCRYPTION_KEY;
    const activeId = process.env.WALLET_ENCRYPTION_KEY_ID;
    process.env.WALLET_ENCRYPTION_KEY_ID = "k1";
    process.env.WALLET_ENCRYPTION_KEY = "a".repeat(64);
    delete process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS;
    const old = encryptSecret("rotate-me", "view-key", "wallet-2");

    process.env.WALLET_ENCRYPTION_KEY_ID = "k2";
    process.env.WALLET_ENCRYPTION_KEY = "b".repeat(64);
    process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS = `k1:${"a".repeat(64)}`;
    try {
      expect(needsRotation(old)).toBe(true);
      const rotated = reencryptSecret(old, "view-key", "wallet-2");
      expect(needsRotation(rotated)).toBe(false);
      expect(decryptSecret(rotated, "view-key", "wallet-2")).toBe("rotate-me");
    } finally {
      if (active === undefined) delete process.env.WALLET_ENCRYPTION_KEY;
      else process.env.WALLET_ENCRYPTION_KEY = active;
      if (previousKeys === undefined) delete process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS;
      else process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS = previousKeys;
      if (activeId === undefined) delete process.env.WALLET_ENCRYPTION_KEY_ID;
      else process.env.WALLET_ENCRYPTION_KEY_ID = activeId;
    }
  });
});

export {};
