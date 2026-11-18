import { getPriceConfig } from "@/lib/config";
import { setGauge } from "@/lib/metrics";

export type PriceQuote = {
  currency: string;
  usdPerXmr: number;
  fiatPerUsd: number;
  sources: string[];
  fetchedAt: string;
  stale: boolean;
  degraded: boolean;
};

type CacheEntry = { quote: PriceQuote; cachedAt: number };

const cache = new Map<string, CacheEntry>();
let currenciesCache: { codes: string[]; fetchedAt: number } | null = null;

export async function getSupportedCurrencies(): Promise<string[]> {
  const config = getPriceConfig();
  if (currenciesCache && Date.now() - currenciesCache.fetchedAt <= config.cacheTtlMs) {
    return currenciesCache.codes;
  }

  let codes: string[] = ["USD"];
  try {
    const data = (await fetchJson("https://api.frankfurter.app/currencies")) as Record<
      string,
      string
    >;
    codes = Array.from(new Set(["USD", ...Object.keys(data)]));
  } catch {
    const fallback = (await fetchJson("https://open.er-api.com/v6/latest/USD")) as {
      rates?: Record<string, number>;
    };
    codes = Array.from(new Set(["USD", ...Object.keys(fallback.rates ?? {})]));
  }

  currenciesCache = { codes: codes.sort(), fetchedAt: Date.now() };
  return currenciesCache.codes;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(getPriceConfig().httpTimeoutMs),
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function coingecko(): Promise<number | null> {
  const data = (await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd"
  )) as { monero?: { usd?: number } };
  return valid(data.monero?.usd);
}

async function coincap(): Promise<number | null> {
  const data = (await fetchJson("https://api.coincap.io/v2/assets/monero")) as {
    data?: { priceUsd?: string };
  };
  return valid(Number(data.data?.priceUsd));
}

async function coinbase(): Promise<number | null> {
  const data = (await fetchJson("https://api.coinbase.com/v2/prices/XMR-USD/spot")) as {
    data?: { amount?: string };
  };
  return valid(Number(data.data?.amount));
}

async function kraken(): Promise<number | null> {
  const data = (await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XMRUSD")) as {
    error?: string[];
    result?: Record<string, { c?: string[] }>;
  };
  if (data.error?.length) return null;
  const pair = Object.values(data.result ?? {})[0];
  return valid(Number(pair?.c?.[0]));
}

async function usdPerXmrSources(): Promise<{ name: string; value: number }[]> {
  const tasks: Array<[string, () => Promise<number | null>]> = [
    ["coingecko", coingecko],
    ["coincap", coincap],
    ["coinbase", coinbase],
    ["kraken", kraken],
  ];

  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const values: { name: string; value: number }[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value !== null) {
      values.push({ name: tasks[index][0], value: result.value });
    }
  });

  return values;
}

async function frankfurterFx(currency: string): Promise<number | null> {
  const data = (await fetchJson(
    `https://api.frankfurter.app/latest?from=USD&to=${currency}`
  )) as { rates?: Record<string, number> };
  return valid(data.rates?.[currency]);
}

async function erApiFx(currency: string): Promise<number | null> {
  const data = (await fetchJson("https://open.er-api.com/v6/latest/USD")) as {
    rates?: Record<string, number>;
  };
  return valid(data.rates?.[currency]);
}

async function fiatPerUsd(currency: string): Promise<{ rate: number; sources: string[] }> {
  if (currency === "USD") return { rate: 1, sources: [] };

  const tasks: Array<[string, () => Promise<number | null>]> = [
    ["frankfurter", () => frankfurterFx(currency)],
    ["er-api", () => erApiFx(currency)],
  ];

  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const values: { name: string; value: number }[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value !== null) {
      values.push({ name: tasks[index][0], value: result.value });
    }
  });

  if (values.length === 0) throw new Error(`Invalid currency: ${currency}`);

  return {
    rate: aggregatePrices(values.map((entry) => entry.value)).price,
    sources: values.map((entry) => entry.name),
  };
}

function valid(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function aggregatePrices(values: number[]): { price: number; degraded: boolean } {
  const clean = values.filter((value) => value > 0 && Number.isFinite(value));
  if (clean.length === 0) throw new Error("No valid price sources");

  const middle = median(clean);
  const tolerance = middle * (getPriceConfig().outlierBps / 10_000);
  const filtered = clean.filter((value) => Math.abs(value - middle) <= tolerance);
  const finalValues = filtered.length > 0 ? filtered : [middle];

  return {
    price: median(finalValues),
    degraded: clean.length < 2 || finalValues.length < 2,
  };
}

export async function getPriceQuote(currencyInput: string): Promise<PriceQuote> {
  const currency = currencyInput.trim().toUpperCase();
  const supported = await getSupportedCurrencies();
  if (!supported.includes(currency)) throw new Error(`Invalid currency: ${currency}`);

  const config = getPriceConfig();
  const cached = cache.get(currency);
  if (cached && Date.now() - cached.cachedAt <= config.cacheTtlMs) {
    setGauge("pay_price_age_seconds", (Date.now() - cached.cachedAt) / 1000, { currency });
    return cached.quote;
  }

  try {
    const [sources, fx] = await Promise.all([usdPerXmrSources(), fiatPerUsd(currency)]);
    const { price, degraded } = aggregatePrices(sources.map((entry) => entry.value));
    setGauge("pay_price_sources_healthy", sources.length);
    setGauge("pay_price_age_seconds", 0, { currency });

    const quote: PriceQuote = {
      currency,
      usdPerXmr: price,
      fiatPerUsd: fx.rate,
      sources: [...sources.map((entry) => entry.name), ...fx.sources],
      fetchedAt: new Date().toISOString(),
      stale: false,
      degraded,
    };

    cache.set(currency, { quote, cachedAt: Date.now() });
    return quote;
  } catch (error) {
    if (cached && Date.now() - cached.cachedAt <= config.maxStaleMs) {
      return { ...cached.quote, stale: true };
    }
    throw error instanceof Error ? error : new Error("Price feed unavailable");
  }
}

export function clearPriceCache() {
  cache.clear();
  currenciesCache = null;
}
