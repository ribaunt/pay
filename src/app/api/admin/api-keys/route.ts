import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientId, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser();
    await rateLimit(`api-key-list:${clientId(request)}`, 60, 60_000);

    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });
    return NextResponse.json({ keys });
  } catch (error) {
    return apiError(error, "Failed to list API keys");
  }
}

export async function POST(request: Request) {
  try {
    await requireUser();
    await rateLimit(`api-key-create:${clientId(request)}`, 10, 60_000);

    const body = (await request.json()) as { name?: string; scopes?: string; storeId?: string };
    const name = body.name?.trim();
    const scopes = (body.scopes ?? "payment:write,payment:read").trim();

    if (!name || name.length > 80) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    if (!/^[a-z:, ]+$/i.test(scopes)) {
      return NextResponse.json({ error: "Invalid scopes" }, { status: 400 });
    }

    const rawKey = `pk_${randomBytes(24).toString("base64url")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const key = await prisma.apiKey.create({
      data: {
        name,
        scopes,
        keyHash,
        prefix: `${rawKey.slice(0, 8)}...`,
        storeId: body.storeId || null,
      },
    });

    return NextResponse.json(
      {
        key: {
          id: key.id,
          name: key.name,
          scopes: key.scopes,
          prefix: key.prefix,
          storeId: key.storeId,
          secret: rawKey,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return apiError(error, "Failed to create API key");
  }
}
