import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { assertProductionEnv } from "./env";

export const SESSION_COOKIE = "pay_session";
export const SINGLE_USER_ID = "single-user";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret(): string {
  assertProductionEnv();
  return process.env.SESSION_SECRET ?? "pay-dev-only-session-secret-change-me";
}

export class AuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthError";
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** The only accepted credentials are SINGLE_USER_EMAIL / SINGLE_USER_PASSWORD. */
export function verifyEnvCredentials(email: string, password: string): boolean {
  const expectedEmail = process.env.SINGLE_USER_EMAIL?.trim().toLowerCase();
  const expectedPassword = process.env.SINGLE_USER_PASSWORD;

  if (!expectedEmail || !expectedPassword) return false;

  // Evaluate both comparisons to avoid a short-circuit timing oracle for the
  // email. Bitwise AND keeps both calls executing.
  const emailMatches = safeEqual(email.trim().toLowerCase(), expectedEmail) ? 1 : 0;
  const passwordMatches = safeEqual(password, expectedPassword) ? 1 : 0;
  return (emailMatches & passwordMatches) === 1;
}

/**
 * Maintains exactly one local user row so wallet records keep a valid relation.
 * Legacy users from previous sign-up modes are removed on first login.
 */
export async function ensureSingleUser() {
  const email = process.env.SINGLE_USER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("SINGLE_USER_EMAIL is not configured");

  return prisma.user.upsert({
    where: { id: SINGLE_USER_ID },
    update: { email, isAnonymous: false },
    create: { id: SINGLE_USER_ID, email, isAnonymous: false },
  });
}

type SessionPayload = { userId: string; expiresAt: number; sessionVersion: number };

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(userId: string, sessionVersion = 0): string {
  const payload: SessionPayload = {
    userId,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    sessionVersion,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (
      !payload.userId ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.sessionVersion !== "number"
    ) {
      return null;
    }
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const payload = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.sessionVersion !== payload.sessionVersion) return null;
  return user;
}

export async function revokeAllSessions(): Promise<void> {
  await prisma.user.update({
    where: { id: SINGLE_USER_ID },
    data: { sessionVersion: { increment: 1 } },
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}
