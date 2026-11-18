const { describe, expect, it } = await import("@/testkit");
const { digestAuthorization, parseDigestChallenge } = await import("./digest");

const CHALLENGE =
  'Digest realm="monero-rpc", nonce="abc123", qop="auth", algorithm=MD5';

describe("parseDigestChallenge", () => {
  it("parses a Monero RPC digest challenge", () => {
    expect(parseDigestChallenge(CHALLENGE)).toEqual({
      realm: "monero-rpc",
      nonce: "abc123",
      qop: "auth",
      algorithm: "MD5",
      opaque: undefined,
    });
  });

  it("uses the first challenge when Monero advertises MD5 and MD5-sess", () => {
    const result = parseDigestChallenge(
      'Digest qop="auth",algorithm=MD5,realm="monero-rpc",nonce="abc",stale=false, Digest qop="auth",algorithm=MD5-sess,realm="monero-rpc",nonce="abc",stale=false'
    );
    expect(result?.algorithm).toBe("MD5");
    expect(result?.nonce).toBe("abc");
  });

  it("ignores non-digest headers", () => {
    expect(parseDigestChallenge("Basic realm=\"x\"")).toBeNull();
    expect(parseDigestChallenge(null)).toBeNull();
  });
});

describe("digestAuthorization", () => {
  it("produces a digest response header", () => {
    const header = digestAuthorization(
      { realm: "monero-rpc", nonce: "abc123", qop: "auth" },
      "user",
      "pass",
      "POST",
      "/json_rpc"
    );

    expect(header).toMatch(/^Digest /);
    expect(header).toContain('username="user"');
    expect(header).toContain('nonce="abc123"');
    expect(header).toContain('uri="/json_rpc"');
    expect(header).toMatch(/response="[0-9a-f]{32}"/);
    expect(header).toContain("nc=00000001");
  });
});

export {};
