const { afterEach, describe, expect, it, vi } = await import("@/testkit");
const { getDaemonHeight } = await import("./daemon");

const env = process.env as Record<string, string | undefined>;
const original = env.MONERO_DAEMON_ADDRESS;
const originalFallbacks = env.MONERO_DAEMON_FALLBACKS;

afterEach(() => {
  if (original === undefined) delete env.MONERO_DAEMON_ADDRESS;
  else env.MONERO_DAEMON_ADDRESS = original;
  if (originalFallbacks === undefined) delete env.MONERO_DAEMON_FALLBACKS;
  else env.MONERO_DAEMON_FALLBACKS = originalFallbacks;
  vi.unstubAllGlobals();
});

describe("getDaemonHeight", () => {
  it("reads the height from a daemon", async () => {
    env.MONERO_DAEMON_ADDRESS = "example.com:18081";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ height: 1234, status: "OK" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getDaemonHeight()).toBe(1234);
    expect(fetchMock.mock.calls[0][0]).toBe("http://example.com:18081/getheight");
  });

  it("rejects a non-OK status", async () => {
    env.MONERO_DAEMON_ADDRESS = "http://example.com:18081";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "BUSY" }) })
    );

    await expect(getDaemonHeight()).rejects.toThrow("Daemon status");
  });

  it("falls back to a secondary daemon", async () => {
    env.MONERO_DAEMON_ADDRESS = "http://primary.invalid:18081";
    env.MONERO_DAEMON_FALLBACKS = "http://fallback.example:18081";

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("primary down"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ height: 42, status: "OK" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getDaemonHeight()).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

export {};
