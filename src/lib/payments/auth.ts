import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertProductionEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";

export type ApiKeyRecord = {
  id: string;
  name: string;
  scopes: string;
  storeId: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(sha256(a));
  const right = Buffer.from(sha256(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasScope(scopes: string, required: string): boolean {
  return scopes === "*" || scopes.split(",").map((s) => s.trim()).includes(required);
}

/** Verifies an API key, bootstrapping the env key into Postgres on first use. */
export async function verifyApiKey(
  request: Request,
  requiredScope = "payment:write"
): Promise<ApiKeyRecord | null> {
  assertProductionEnv();

  const provided = request.headers.get("x-api-key");
  if (!provided) return null;

  const keyHash = sha256(provided);
  let key = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!key) {
    const bootstrap = process.env.PAYMENT_API_KEY;
    if (!bootstrap || !safeEqual(provided, bootstrap)) return null;

    key = await prisma.apiKey.create({
      data: {
        name: "bootstrap-env-key",
        keyHash,
        prefix: `${provided.slice(0, 4)}...`,
        scopes: "payment:write,payment:read",
      },
    });
  }

  if (key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) return null;
  if (!hasScope(key.scopes, requiredScope)) return null;

  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: key.id, name: key.name, scopes: key.scopes, storeId: key.storeId ?? null };
}

export async function hasLinkControl(request: Request): Promise<boolean> {
  if (await verifyApiKey(request, "payment:read")) return true;
  try {
    await requireUser();
    return true;
  } catch {
    return false;
  }
}

export function verifyCronSecret(request: Request): boolean {
  assertProductionEnv();
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (!expected || !provided) return false;
  return safeEqual(provided, expected);
}
