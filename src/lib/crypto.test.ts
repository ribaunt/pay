const { describe, expect, it } = await import("@/testkit");
const { decryptSecret, encryptSecret } = await import("./crypto");

describe("secret encryption", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("view-key-secret");
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("view-key-secret");
    expect(decryptSecret(encrypted)).toBe("view-key-secret");
  });

  it("uses a random IV", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(".");
    parts[3] = `${parts[3].slice(0, -2)}xx`;
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

export {};
