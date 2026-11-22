const { describe, expect, it } = await import("@/testkit");
const { redact } = await import("./redact");

describe("log redaction", () => {
  it("hides credentials, envelopes and addresses", () => {
    const text = [
      "x-api-key: pay_secret_123",
      "cookie: pay_session=abc",
      "v2.env-1.iv.tag.ciphertext",
      "whsec_abcdefghijklmnop",
      "46W8kLbMPuo7QBYDqsQyn2Nf3nW5G3v9K3LaWCB6uAbkV6uEJKqun776N9z2UrN4UoYEn2AWXbtQ5EK2D8vxTo2NDWpxPJo",
    ].join("\n");
    const output = redact(text);
    expect(output).not.toContain("pay_secret_123");
    expect(output).not.toContain("pay_session");
    expect(output).not.toContain("whsec_abcdefghijklmnop");
    expect(output).not.toContain("46W8kLb");
    expect(output).toContain("<redacted-monero-address>");
  });

  it("redacts subaddresses, stagenet addresses and bare credentials", () => {
    const subaddress = `8${"A".repeat(94)}`;
    const stagenetSubaddress = `7${"B".repeat(94)}`;
    const stagenetPrimary = `5${"C".repeat(94)}`;
    const output = redact(
      [subaddress, stagenetSubaddress, stagenetPrimary, "pk_abcdefghijklmnopqrstuvwx", "pay_session=abc123", "token=secret123"].join("\n")
    );
    expect(output).not.toContain(subaddress);
    expect(output).not.toContain(stagenetSubaddress);
    expect(output).not.toContain(stagenetPrimary);
    expect(output).not.toContain("pk_abcdefghijklmnopqrstuvwx");
    expect(output).not.toContain("pay_session=abc123");
    expect(output).not.toContain("token=secret123");
  });

  it("redacts a full encryption envelope", () => {
    expect(redact("v2.env-1.iv.tag.ciphertext")).toBe("<redacted-envelope>");
  });

  it("handles empty values", () => {
    expect(redact(undefined)).toBe("<empty>");
  });
});

export {};
