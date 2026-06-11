# CoinMarketCap API Authentication & .env Setup

The CoinMarketCap (CMC) Pro API is the **market-intelligence layer** for strategy-referee: token discovery, market-cap ranking, live sanity quotes, token metadata, and macro context. Historical OHLCV — the price-action layer that feeds RSI / MFI / SMA computation — is **not** sourced from CMC; see §4 below.

You must configure `CMC_API_KEY` in `.env` before running the evaluator against live CMC data.

---

## 1. Required environment variable

```bash
# CoinMarketCap Pro API key
CMC_API_KEY=your_cmc_pro_api_key
```

### 1.1 Where to get the key

1. Sign up at [coinmarketcap.com/api/pricing/](https://coinmarketcap.com/api/pricing/)
2. The **Basic** tier is free and sufficient for this project — no credit card required.
3. After signup, find the key on your [Pro account dashboard](https://pro.coinmarketcap.com/account)
4. Copy the key into `.env`

### 1.2 Verify the key

```bash
node -e "require('dotenv').config(); \
  fetch('https://pro-api.coinmarketcap.com/v1/key/info', { \
    headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY } \
  }).then(r => r.json()).then(j => console.log(JSON.stringify(j.data, null, 2)));"
```

A working key returns plan tier, credit usage, and rate-limit information.

---

## 2. Plan tier (Basic / free)

| Quota | Value |
|---|---|
| Monthly credits | 15,000 |
| Rate limit | 50 requests / minute |
| Historical OHLCV endpoint | ❌ **NOT included** |
| Endpoints available | 35+ (listings, quotes, info, global metrics, categories) |
| Price | $0 |
| Reset | 1st of each month, 00:00 UTC |

Endpoints used by strategy-referee fit comfortably in the free tier: a full 50-token demo refreshing live quotes daily uses fewer than 2,000 credits/month — under 14% of quota.

---

## 3. Endpoints used

| Endpoint | Purpose | Credit cost |
|---|---|---|
| `/v1/cryptocurrency/listings/latest` | Top-N tokens by market cap (the candidate universe) | ~1 per call |
| `/v1/cryptocurrency/quotes/latest?symbol=BTC,ETH,...` | Live price + 24h volume for sanity check | ~1 per call (regardless of symbol count, up to limit) |
| `/v1/cryptocurrency/info?symbol=BTC` | Token metadata (name, logo, category, description) for UI | ~1 per call |
| `/v1/global-metrics/quotes/latest` | Total market cap, BTC dominance — macro context | ~1 per call |
| `/v1/key/info` | Plan tier and usage diagnostics | Free (doesn't count toward quota) |

Auth header for all endpoints:

```
X-CMC_PRO_API_KEY: <CMC_API_KEY>
Accept: application/json
```

Base URL: `https://pro-api.coinmarketcap.com`

---

## 4. Historical OHLCV — why we use Binance, not CMC

The survivor family this project evaluates requires daily RSI(14), MFI(14), and SMA(200) over **≥250 daily bars per token**. CMC's historical OHLCV endpoint (`/v2/cryptocurrency/ohlcv/historical`) is **not included in the free tier**. The cheapest paid tier that includes it (Startup, $79/month) is overkill for a hackathon-scope project.

Instead, this project uses **Binance public klines API** for historical OHLCV:

| Property | Binance public klines |
|---|---|
| URL | `https://api.binance.com/api/v3/klines` |
| Authentication | None required |
| Rate limit | 1,200 requests / minute (anonymous) |
| Historical depth | Most majors back to 2017–2018; varies per symbol |
| Cost | $0 |
| Coverage | All Binance-listed tokens, which spans most CMC top-200 |

### 4.1 Architecture rationale

The two-source split is a **product feature**, not a workaround:

- **CMC = market intelligence.** Token discovery, market-cap-weighted candidate selection, live quote sanity, metadata, macro context. CMC defines *which tokens are worth looking at*.
- **Binance = price action.** Daily OHLCV history that feeds indicator computation. Binance defines *what the price did*.

This separation also lets the project meaningfully integrate **two CMC surfaces** (REST + optional MCP / x402 in the demo) rather than just one, which is competitive for the BNB HACK "Best CMC Data Use" special prize.

### 4.2 Tokens not on Binance

A small minority of CMC-listed tokens are not on Binance. The evaluator's REJECT path includes the case `INSUFFICIENT_BINANCE_HISTORY` — the verdict honestly reports the data gap rather than fabricating a result.

---

## 5. Rate-limit guardrails

The free tier caps at 50 requests/minute. At the project's planned cadence (one full evaluator pass over a watchlist runs ~5–10 CMC calls plus 50–100 Binance klines calls), the rate limit is not a practical constraint. No backoff/queue code is needed for hackathon scope.

If rate-limit headers indicate quota stress (`X-CMC_PRO_API_QUOTA_REMAINING_MINUTE` < 5), the evaluator should pause for 60 seconds rather than retrying.

---

## 6. Security recommendations

- Keep `.env` out of source control (already in `.gitignore`).
- The free-tier CMC key has zero financial exposure (no trading capability, no wallet access) — leakage is low-risk but should still be rotated promptly.
- If the key is ever pasted into a chat, commit history, or screen recording, rotate it from the [Pro account dashboard](https://pro.coinmarketcap.com/account).
- For the hackathon submission, do **not** ship a `.env` file with a real key into the public repo. The `.env.example` template is the only env file that belongs in git.

---

## 7. Quick-start checklist

- [ ] CMC Pro account created at [pro.coinmarketcap.com](https://pro.coinmarketcap.com/account)
- [ ] `CMC_API_KEY` copied into local `.env`
- [ ] `.env` is in `.gitignore` (verify with `git check-ignore -v .env`)
- [ ] Verification call to `/v1/key/info` succeeds and returns Basic plan tier
- [ ] `.env.example` (committed) has `CMC_API_KEY=` empty placeholder

---

## 8. Related

- [coinmarketcap.com/api/documentation](https://coinmarketcap.com/api/documentation/) — full endpoint reference
- [coinmarketcap.com/api/pricing/](https://coinmarketcap.com/api/pricing/) — tier comparison
- [binance.com/en/binance-api](https://www.binance.com/en/binance-api) — Binance public klines documentation
- Project scope: see [README.md](../README.md)
