import { NextResponse } from "next/server";
import { CSRF_COOKIE, createCsrfToken } from "@/lib/csrf";

export const dynamic = "force-dynamic";

/** Read-only token issuance for cookie-authenticated browser mutations. */
export async function GET() {
  const token = await createCsrfToken();
  const response = NextResponse.json({ token });
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
