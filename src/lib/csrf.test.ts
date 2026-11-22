const { describe, expect, it } = await import("@/testkit");
const { createCsrfToken, verifyCsrfToken } = await import("./csrf");
const { isSameOrigin } = await import("./origin");

describe("CSRF tokens", () => {
  it("accepts a matching token and cookie", async () => {
    const token = await createCsrfToken();
    expect(await verifyCsrfToken(token, token)).toBe(true);
  });

  it("rejects missing, mismatched or forged tokens", async () => {
    const token = await createCsrfToken();
    expect(await verifyCsrfToken(null, token)).toBe(false);
    expect(await verifyCsrfToken(token, undefined)).toBe(false);
    expect(await verifyCsrfToken(token, `${token}x`)).toBe(false);
    expect(await verifyCsrfToken(token.replace(/\.[^.]+$/, ".forged"), token.replace(/\.[^.]+$/, ".forged"))).toBe(false);
  });

  it("uses a fresh nonce each time", async () => {
    expect(await createCsrfToken()).not.toBe(await createCsrfToken());
  });
});

describe("origin validation", () => {
  it("requires an exact origin match", () => {
    expect(isSameOrigin("https://pay.example.com", "pay.example.com", "https")).toBe(true);
    expect(isSameOrigin("https://evil.example", "pay.example.com", "https")).toBe(false);
    expect(isSameOrigin("http://pay.example.com", "pay.example.com", "https")).toBe(false);
    expect(isSameOrigin(null, "pay.example.com", "https")).toBe(false);
  });
});

export {};
