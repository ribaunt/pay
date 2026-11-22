import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireUser, SESSION_COOKIE, revokeAllSessions, sessionCookieOptions } from "@/lib/auth";
import { clientId, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // Logout revokes every session for the single user, so it must never be
    // reachable unauthenticated (a cross-site form post could otherwise keep
    // the operator permanently logged out).
    await rateLimit(`logout:${clientId(request)}`, 10, 60_000);
    await requireUser();

    await revokeAllSessions();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return apiError(error, "Logout failed");
  }
}
