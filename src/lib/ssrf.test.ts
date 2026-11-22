const { describe, expect, it } = await import("@/testkit");
const { createServer } = await import("node:http");
const { assertPublicUrl, isPrivateIp, postPinned } = await import("./ssrf");

describe("denied address classification", () => {
  it("blocks mapped, embedded and reserved IPv6 forms", () => {
    for (const address of [
      "::ffff:7f00:1",
      "::ffff:127.0.0.1",
      "::7f00:1",
      "febf::1",
      "fec0::1",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "2001:db8::1",
      "2002:7f00:1::1",
      "64:ff9b::7f00:1",
      "ff00::1",
      "::1",
      "::",
    ]) {
      expect(isPrivateIp(address)).toBe(true);
    }
  });

  it("blocks reserved IPv4 ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateIp(address)).toBe(true);
    }
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});

describe("URL validation", () => {
  it("rejects literal IP webhook targets", () => {
    expect(() => assertPublicUrl("https://[::ffff:7f00:1]/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://[::ffff:a9fe:a9fe]/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://[2002:7f00:1::1]/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://93.184.216.34/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://example.com/hook")).not.toThrow();
  });
});

describe("pinned delivery over a real socket", () => {
  it("connects to the pinned IP while keeping the hostname for Host header", async () => {
    const seen: Array<{ host?: string }> = [];
    const server = createServer((req, res) => {
      seen.push({ host: req.headers.host });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no test port");

    try {
      const target = {
        url: new URL(`http://example.com:${address.port}/hook`),
        hostname: "example.com",
      };
      const response = await postPinned(
        target,
        { address: "127.0.0.1", family: 4 },
        { "content-type": "application/json" },
        "{}"
      );
      expect(response).toEqual({ ok: true, status: 200 });
      expect(seen[0].host).toBe(`example.com:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

export {};
