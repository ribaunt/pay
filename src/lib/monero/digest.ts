import { createHash, randomBytes } from "node:crypto";

export type DigestChallenge = {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
};

export function parseDigestChallenge(header: string | null): DigestChallenge | null {
  if (!header || !/^Digest\b/i.test(header)) return null;

  // Monero advertises two challenges (MD5 and MD5-sess). Use the first one.
  const withoutPrefix = header.replace(/^Digest\s*/i, "");
  const secondChallenge = withoutPrefix.search(/,\s*Digest\s/i);
  const segment =
    secondChallenge === -1 ? withoutPrefix : withoutPrefix.slice(0, secondChallenge);

  const fields: Record<string, string> = {};
  const pattern = /(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  for (const match of segment.matchAll(pattern)) {
    fields[match[1].toLowerCase()] = match[2] ?? match[3];
  }

  if (!fields.realm || !fields.nonce) return null;

  return {
    realm: fields.realm,
    nonce: fields.nonce,
    qop: fields.qop?.split(",")[0]?.trim(),
    opaque: fields.opaque,
    algorithm: fields.algorithm,
  };
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

let nonceCount = 0;

/** Build an RFC 7616 Digest Authorization header (MD5 / qop=auth). */
export function digestAuthorization(
  challenge: DigestChallenge,
  username: string,
  password: string,
  method: string,
  uri: string
): string {
  const cnonce = randomBytes(8).toString("hex");
  nonceCount += 1;
  const nc = nonceCount.toString(16).padStart(8, "0");

  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = challenge.qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (challenge.qop) {
    parts.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);

  return `Digest ${parts.join(", ")}`;
}
