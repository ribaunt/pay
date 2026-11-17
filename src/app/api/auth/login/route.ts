import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { assertProductionEnv } from "@/lib/env";
import { clientId, rateLimit } from "@/lib/rate-limit";
import {
  SESSION_COOKIE,
  createSessionToken,
  ensureSingleUser,
  sessionCookieOptions,
  verifyEnvCredentials,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertProductionEnv();
    await rateLimit(`login:${clientId(request)}`, 10, 60_000);

    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email || !body.password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    if (!verifyEnvCredentials(email, body.password)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const user = await ensureSingleUser();

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(user.id, user.sessionVersion),
      sessionCookieOptions()
    );
    return response;
  } catch (error) {
    return apiError(error, "Login failed");
  }
}
