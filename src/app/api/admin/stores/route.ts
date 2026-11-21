import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { createWalletAccount } from "@/lib/monero/wallet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser();
    await rateLimit(`store-list:${clientId(request)}`, 60, 60_000);
    const stores = await prisma.store.findMany({
      orderBy: { accountIndex: "asc" },
      select: { id: true, name: true, slug: true, accountIndex: true, createdAt: true },
    });
    return NextResponse.json({ stores });
  } catch (error) {
    return apiError(error, "Failed to list stores");
  }
}

/** Create an isolated store backed by its own Monero account (major index). */
export async function POST(request: Request) {
  try {
    await requireUser();
    await rateLimit(`store-create:${clientId(request)}`, 10, 60_000);

    const body = (await request.json()) as { name?: string; slug?: string };
    const name = body.name?.trim();
    const slug = (body.slug ?? body.name)?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (!name || name.length > 80 || !slug || !/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: "Invalid name or slug" }, { status: 400 });
    }

    const accountIndex = await createWalletAccount(slug);
    const store = await prisma.store.create({
      data: { name, slug, accountIndex },
      select: { id: true, name: true, slug: true, accountIndex: true, createdAt: true },
    });
    return NextResponse.json({ store }, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create store");
  }
}
