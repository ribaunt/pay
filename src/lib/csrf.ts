export const CSRF_COOKIE = "pay_csrf";
export const CSRF_HEADER = "x-csrf-token";

function secret(): string {
  return process.env.SESSION_SECRET ?? "pay-dev-only-session-secret-change-me";
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(value: string): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(value)
  );
  return bytesToBase64url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

/** Nonce + HMAC. The nonce is also stored in a cookie for double-submit. */
export async function createCsrfToken(): Promise<string> {
  const nonce = bytesToBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return `${nonce}.${await sign(nonce)}`;
}

/** Requires the submitted token to match the cookie and carry a valid HMAC. */
export async function verifyCsrfToken(
  submitted: string | null | undefined,
  cookie: string | null | undefined
): Promise<boolean> {
  if (!submitted || !cookie || submitted !== cookie) return false;
  const [nonce, signature] = submitted.split(".");
  if (!nonce || !signature) return false;
  return constantTimeEqual(signature, await sign(nonce));
}
