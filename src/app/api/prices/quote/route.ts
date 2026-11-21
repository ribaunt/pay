import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { fiatToAtomic } from "@/lib/pricing/convert";
import { getPriceQuote } from "@/lib/pricing/oracle";
import { atomicToXmr } from "@/lib/monero/money";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await rateLimit(`quote:${clientId(request)}`, 60, 60_000);

    const params = new URL(request.url).searchParams;
    const fiatAmount = params.get("fiatAmount") ?? "";
    const fiatCurrency = params.get("fiatCurrency") ?? "";
    if (!/^\d+(\.\d{1,12})?$/.test(fiatAmount)) {
      return NextResponse.json({ error: "Invalid fiatAmount" }, { status: 400 });
    }

    const quote = await getPriceQuote(fiatCurrency);
    const atomic = fiatToAtomic(fiatAmount, quote.usdPerXmr, quote.fiatPerUsd);

    return NextResponse.json({
      fiatAmount,
      fiatCurrency: quote.currency,
      amountXmr: atomicToXmr(atomic),
      amountAtomic: atomic.toString(),
      rateUsd: quote.usdPerXmr.toString(),
      fxRate: quote.fiatPerUsd.toString(),
      rateSources: quote.sources.join(","),
      rateStale: quote.stale,
      rateDegraded: quote.degraded,
      rateFetchedAt: quote.fetchedAt,
    });
  } catch (error) {
    return apiError(error, "Failed to build quote");
  }
}
