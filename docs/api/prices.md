---
icon: lucide/circle-dollar-sign
---

# Prices

Price endpoints are public and rate-limited to 60 requests per minute. They power fiat payment links, but you can also call them directly to show a quote before creating a link.

## Supported currencies

`GET /api/prices/currencies`

```bash
curl https://pay.example.com/api/prices/currencies
```

```json
{ "currencies": ["AUD", "CHF", "EUR", "GBP", "USD", "..."] }
```

The list comes from Frankfurter, with exchangerate.host as a fallback, and always includes `USD`.

## Quote

`GET /api/prices/quote`

| Query parameter | Required | Notes |
| --- | --- | --- |
| `fiatAmount` | yes | Decimal with up to 12 fractional digits. |
| `fiatCurrency` | yes | Code from the currencies endpoint. |

```bash
curl 'https://pay.example.com/api/prices/quote?fiatAmount=10.50&fiatCurrency=EUR'
```

```json
{
  "fiatAmount": "10.50",
  "fiatCurrency": "EUR",
  "amountXmr": "0.038888888888",
  "amountAtomic": "38888888888000",
  "rateUsd": "278.4",
  "fxRate": "0.92",
  "rateSources": "coingecko,coincap,coinbase,kraken,frankfurter",
  "rateStale": false,
  "rateDegraded": false,
  "rateFetchedAt": "2026-11-18T14:00:00.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `amountXmr`, `amountAtomic` | The converted amount, rounded up so the merchant receives at least the quoted value. |
| `rateUsd` | Median XMR/USD price from available sources. |
| `fxRate` | FX rate; `1` for USD. |
| `rateSources` | Comma-separated contributing sources. |
| `rateStale` | A cached quote was served because live sources failed. |
| `rateDegraded` | Fewer than two usable values were available, so the median is less robust. |
| `rateFetchedAt` | When the quote was fetched. |

These are the same `rate*` fields stored on a payment link, so a quote and the
link created from it can be compared directly.

## How the price is assembled

1. CoinGecko, CoinCap, Coinbase, and Kraken are queried in parallel for XMR/USD.
2. Valid responses are aggregated with a median. Values farther than `PRICE_OUTLIER_THRESHOLD_BPS` from the median are filtered out.
3. For non-USD currencies, Frankfurter and exchangerate.host provide the FX rate, aggregated the same way.
4. Conversion to piconero uses fixed-point integer math with 12 decimal places.
5. Results are cached for `PRICE_CACHE_TTL_SECONDS`. On failure, a cached quote up to `PRICE_MAX_STALENESS_SECONDS` old is served with `stale: true`.

## Errors

| Status | Reason |
| --- | --- |
| `400` | Missing or malformed `fiatAmount`. |
| `400` | Unknown or unsupported `fiatCurrency`. |
| `502` | No price sources available and no usable cached quote. |
| `429` | Rate limit exceeded. |

!!! note "Quotes aren't reservations"
    Calling this endpoint doesn't lock a rate. A payment link does: it stores the quote on the request so later price changes don't alter what the customer owes.
