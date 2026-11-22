import { NextResponse, type NextRequest } from "next/server";
import { CSRF_COOKIE, CSRF_HEADER, verifyCsrfToken } from "@/lib/csrf";
import { isSameOrigin } from "@/lib/origin";

/**
 * CSRF defense for browser sessions only. API-key and cron requests never carry
 * the session cookie, so they are deliberately not subjected to browser CSRF
 * rules. Token issuance lives in GET /api/auth/csrf.
 */
export async function middleware(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();
  if (!request.cookies.get("pay_session")) return NextResponse.next();

  const trustProxy = process.env.TRUST_PROXY === "1";
  const host = trustProxy
    ? request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    : request.headers.get("host");
  const protocol = trustProxy
    ? request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol
    : request.nextUrl.protocol;

  if (!isSameOrigin(request.headers.get("origin"), host, protocol)) {
    return NextResponse.json({ error: "Origin check failed" }, { status: 403 });
  }

  const valid = await verifyCsrfToken(
    request.headers.get(CSRF_HEADER),
    request.cookies.get(CSRF_COOKIE)?.value
  );
  if (!valid) {
    return NextResponse.json({ error: "CSRF token missing or invalid" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
