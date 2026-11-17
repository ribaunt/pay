const TIMEOUT_MS = 5_000;

function normalize(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.includes("://") ? trimmed : `http://${trimmed}`;
}

function daemonUrls(): string[] {
  const primary = process.env.MONERO_DAEMON_ADDRESS?.trim();
  const fallbacks = (process.env.MONERO_DAEMON_FALLBACKS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const urls = [...(primary ? [primary] : []), ...fallbacks].map(normalize);
  if (urls.length === 0) throw new Error("MONERO_DAEMON_ADDRESS is not configured");
  return urls;
}

export async function getDaemonHeight(): Promise<number> {
  let lastError: unknown;

  for (const url of daemonUrls()) {
    try {
      const response = await fetch(`${url}/getheight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });

      if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);

      const data = (await response.json()) as { height?: number; status?: string };
      if (data.status && data.status !== "OK") throw new Error(`Daemon status: ${data.status}`);
      if (typeof data.height !== "number") throw new Error("Daemon returned no height");

      return data.height;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All Monero daemons failed");
}
