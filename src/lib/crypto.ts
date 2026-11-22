import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const VIEW_KEY_PURPOSE = "view-key";
export const WEBHOOK_SECRET_PURPOSE = "webhook-secret";

const DEV_KEY = createHash("sha256").update("pay-dev-only-encryption-key").digest();
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

type KeyEntry = { id: string; key: Buffer };

export function keyFingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function activeKey(): KeyEntry {
  const configured = process.env.WALLET_ENCRYPTION_KEY;
  const id = process.env.WALLET_ENCRYPTION_KEY_ID?.trim() || "env-1";

  if (configured && HEX_KEY.test(configured)) {
    const key = Buffer.from(configured, "hex");
    // Reusing an id with different key material makes old ciphertext
    // undecryptable and silently defeats rotation detection.
    const collision = previousKeys().find(
      (entry) => entry.id === id && !entry.key.equals(key)
    );
    if (collision) {
      throw new Error(
        `WALLET_ENCRYPTION_KEY_ID '${id}' collides with a different key in WALLET_ENCRYPTION_PREVIOUS_KEYS; choose a new id`
      );
    }
    return { id, key };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("WALLET_ENCRYPTION_KEY must be configured in production");
  }
  return { id: "dev", key: DEV_KEY };
}

function previousKeys(): KeyEntry[] {
  const raw = process.env.WALLET_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (!raw) return [];

  return raw.split(",").flatMap((entry) => {
    const [id, hex] = entry.split(":").map((part) => part.trim());
    if (!id || !hex || !HEX_KEY.test(hex)) {
      throw new Error("WALLET_ENCRYPTION_PREVIOUS_KEYS must be a comma-separated list of id:64-hex-key");
    }
    return [{ id, key: Buffer.from(hex, "hex") }];
  });
}

function keyById(id: string): Buffer {
  if (id === activeKey().id) return activeKey().key;
  const previous = previousKeys().find((entry) => entry.id === id);
  if (!previous) throw new Error(`Unknown encryption key id: ${id}`);
  return previous.key;
}

function aad(purpose: string, recordId: string): Buffer {
  return Buffer.from(`v2|${purpose}|${recordId}`, "utf8");
}

/**
 * AES-256-GCM envelope:
 *   v2.<key_id>.<iv>.<tag>.<ciphertext>  (all base64url except version/key_id)
 * Legacy v1.<iv>.<tag>.<ciphertext> records remain readable.
 */
export function encryptSecret(
  plaintext: string,
  purpose = "generic",
  recordId = "none"
): string {
  const active = activeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", active.key, iv);
  cipher.setAAD(aad(purpose, recordId));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v2",
    active.id,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptV1(parts: string[]): string {
  const [, ivPart, tagPart, cipherPart] = parts;
  if (!ivPart || !tagPart || !cipherPart) throw new Error("Invalid encrypted secret format");

  const candidateKeys: Buffer[] = [];
  const configured = process.env.WALLET_ENCRYPTION_KEY;
  if (configured && HEX_KEY.test(configured)) {
    candidateKeys.push(Buffer.from(configured, "hex"));
  } else if (process.env.NODE_ENV !== "production") {
    candidateKeys.push(DEV_KEY);
  } else {
    throw new Error("WALLET_ENCRYPTION_KEY must be configured in production");
  }
  candidateKeys.push(...previousKeys().map((entry) => entry.key));

  let lastError: unknown;
  for (const key of candidateKeys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
      decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(cipherPart, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to decrypt legacy secret");
}

export function decryptSecret(payload: string, purpose = "generic", recordId = "none"): string {
  const parts = payload.split(".");
  const version = parts[0];

  if (version === "v1") return decryptV1(parts);

  if (version !== "v2" || parts.length !== 5) {
    throw new Error("Invalid encrypted secret format");
  }
  const [, keyId, ivPart, tagPart, cipherPart] = parts;
  if (!keyId || !ivPart || !tagPart || !cipherPart) {
    throw new Error("Invalid encrypted secret format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyById(keyId),
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAAD(aad(purpose, recordId));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function needsRotation(payload: string): boolean {
  if (!payload.startsWith("v2.")) return true;
  const keyId = payload.split(".")[1];
  const expected = Buffer.from(keyId ?? "");
  const actual = Buffer.from(activeKey().id);
  return expected.length !== actual.length || !timingSafeEqual(expected, actual);
}

/** Decrypt with any available key and re-encrypt under the active key. */
export function reencryptSecret(
  payload: string,
  purpose = "generic",
  recordId = "none"
): string {
  return encryptSecret(decryptSecret(payload, purpose, recordId), purpose, recordId);
}
