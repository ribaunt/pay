import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { SESSION_COOKIE, revokeAllSessions, sessionCookieOptions } from "@/lib/auth";

export async function POST() {
  try {
    await revokeAllSessions();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return apiError(error, "Logout failed");
  }
}
