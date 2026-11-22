import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { request as httpRequest, Agent as HttpAgent } from "node:http";
import type { IncomingMessage } from "node:http";

/**
 * Denied ranges for webhook delivery. A BlockList is used instead of ad-hoc
 * prefix matching so expanded/mapped IPv6 forms (::ffff:7f00:1, 6to4, NAT64,
 * Teredo) are classified correctly. Unknown/invalid values fail closed.
 */
const DENIED4 = new BlockList();
const DENIED6 = new BlockList();

for (const subnet of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]) {
  const [net, prefix] = subnet.split("/");
  DENIED4.addSubnet(net, Number(prefix), "ipv4");
}

for (const subnet of [
  "::/128",
  "::1/128",
  "::/96",
  "::ffff:0:0/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "2001::/32",
  "2001:2::/48",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
]) {
  const [net, prefix] = subnet.split("/");
  DENIED6.addSubnet(net, Number(prefix), "ipv6");
}

/** True for addresses that must never be reachable through a webhook. */
export function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase().trim();
  const family = isIP(ip);
  if (family === 0) return true;
  return family === 4 ? DENIED4.check(ip, "ipv4") : DENIED6.check(ip, "ipv6");
}

/** Catches integer/hex hosts that getaddrinfo may turn into loopback addresses. */
function looksLikeNumericHost(host: string): boolean {
  return /^[0-9.]+$/.test(host) || /^0[xX][0-9a-fA-F.]+$/.test(host);
}

export type ValidatedUrl = {
  url: URL;
  hostname: string;
};

export function assertPublicUrl(raw: string): ValidatedUrl {
  const url = new URL(raw);

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use https in production");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid webhook URL");
  }
  if (url.username || url.password) {
    throw new Error("Webhook URL must not contain credentials");
  }

  const hostname = url.hostname.toLowerCase().replace(/\[|\]/g, "");
  // Literal IPs are rejected outright: Node skips the custom lookup for them,
  // so pinning and revalidation cannot be enforced on that path.
  if (
    looksLikeNumericHost(hostname) ||
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Webhook URL must not target a private address");
  }

  return { url, hostname };
}

export type PublicAddress = { address: string; family: 4 | 6 };

/**
 * Resolves every A/AAAA record and rejects the whole set if any address is
 * forbidden. Returns one address that is safe to pin the connection to.
 */
export async function resolvePublicAddress(
  hostname: string,
  resolver: typeof dnsLookup = dnsLookup
): Promise<PublicAddress> {
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("Webhook host did not resolve");

  const parsed = records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? (6 as const) : (4 as const),
  }));

  if (parsed.some((record) => isPrivateIp(record.address))) {
    throw new Error("Webhook URL must not target a private address");
  }

  return parsed[0];
}

const HTTPS_AGENT = new HttpsAgent({ keepAlive: false, maxSockets: 10, maxTotalSockets: 20 });
const HTTP_AGENT = new HttpAgent({ keepAlive: false, maxSockets: 10, maxTotalSockets: 20 });
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type PinnedResponse = { ok: boolean; status: number };

/**
 * Sends a POST to the original hostname while forcing the TCP connection onto
 * the address that was validated. TLS SNI and the Host header keep the original
 * hostname, so certificate verification still applies to the real host.
 * https.request never follows redirects.
 */
export function postPinned(
  target: ValidatedUrl,
  pinned: PublicAddress,
  headers: Record<string, string>,
  body: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<PinnedResponse> {
  const { url, hostname } = target;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const transport: typeof httpsRequest = isHttps
      ? httpsRequest
      : (httpRequest as unknown as typeof httpsRequest);
    const options: import("node:https").RequestOptions = {
      protocol: url.protocol,
      hostname,
      port,
      method: "POST",
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, host: url.host },
      ...(isHttps ? { servername: hostname } : {}),
      agent: isHttps ? HTTPS_AGENT : HTTP_AGENT,
      lookup: ((_host: string, options: { all?: boolean }, callback: (...args: never[]) => void) => {
        // Node >= 20 with autoSelectFamily asks for all addresses. Returning a
        // single (address, family) pair there breaks the socket connection.
        if (options.all) {
          (callback as (error: null, addresses: Array<{ address: string; family: number }>) => void)(
            null,
            [{ address: pinned.address, family: pinned.family }]
          );
        } else {
          (callback as (error: null, address: string, family: number) => void)(
            null,
            pinned.address,
            pinned.family
          );
        }
      }) as LookupFunction,
      timeout: timeoutMs,
    };
    const req = transport(
      options,
      (res: IncomingMessage) => {
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            res.destroy(new Error("Webhook response too large"));
          }
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status });
        });
        res.on("error", reject);
      }
    );

    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
