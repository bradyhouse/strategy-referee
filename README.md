# strategy-referee

> **Most strategy tools generate trades. This one rejects setups that don't match the small family of strategies that survived a 21-archetype walk-forward audit.**

CoinMarketCap-powered strategy evaluator. Given a token or watchlist, evaluates whether current conditions resemble a narrow, fee-aware, walk-forward-validated mean-reversion setup family. Emits a backtestable strategy spec on PASS; rejects with plain-language reasoning on REJECT.

Built on the [@stratchai](https://www.npmjs.com/org/stratchai) library suite — `indicators`, `strategy-spec`, `backtest`, `cathode`.

## Status

🚧 **Bootstrap.** Skeleton structure only. Implementation in progress.

## The thesis

A 21-archetype walk-forward audit at 1.5% real fees on a mixed crypto + stock universe identified two survivors:

| Survivor | Defensibility | OOS mean | OOS win rate |
|---|---|---|---|
| `rsi_oversold + SMA200` | 6 / 10 defensible | +0.71% | 62% |
| `mfi_oversold + SMA200` | 2 / 10 defensible (marginal) | +0.89% | 56% |

Both share the same structural fingerprint:

1. Oscillator-confirmed oversold condition (RSI < 32 OR MFI < 20)
2. Long-horizon uptrend filter (close > SMA200)
3. Disciplined exit envelope (SL ~-8%, profit floor ~+10%, max hold ~10 days)

Everything else — Donchian, MACD/Stoch, bare ORB, volume-anomaly, framework ascending-triangle, intraday extensions — was killed under walk-forward + adversarial review. Most archetypes have *some* tiny gross edge that real fees swamp; the survivors have ~+2.2% gross, an order of magnitude richer.

## Usage (planned)

```bash
# Evaluate a token
node src/index.js --token BTC

# Evaluate a watchlist
node src/index.js --watchlist BTC,ETH,SOL,LINK

# Emit strategy spec on PASS
node src/index.js --token ETH --emit-spec
```

## Architecture

- **Market intelligence layer:** CoinMarketCap Pro API (`/listings/latest`, `/quotes/latest`, `/info`, `/global-metrics`) — token discovery, market cap ranking, live sanity quotes, macro context.
- **Price-action layer:** Kraken public OHLC API — historical daily OHLCV for RSI / MFI / SMA200 computation. No auth required; US-accessible; 720-bar depth per request. See `docs/cmc_api_auth.md §4.1` for the source-shopping notes (Binance.com geo-blocked from US, CryptoCompare paywalled, etc.).
- **Decision layer:** `@stratchai/indicators` computes RSI / MFI / SMA series; `@stratchai/strategy-spec` defines the emitted spec schema.
- **Backtest layer:** `@stratchai/backtest` runs the emitted spec against the OHLCV history for confidence-scoring.
- **Visualization layer:** `@stratchai/cathode` renders the candle chart with overlays in the demo UI.

## Decision logic

| Verdict | Conditions | Output |
|---|---|---|
| **PASS** | RSI < 32 OR MFI < 20, AND close > SMA200, AND ≥250 daily bars available | Compact strategy-spec payload |
| **WATCH** | One signal borderline OR `sma_distance < 5%` (elevated-risk bucket from regime conditioning) | Risk-flagged "near-trigger" notice |
| **REJECT** | Below SMA200, no oversold signal, or insufficient history | Plain-language explanation |

## What this tool does NOT do

- Recommend trades it can't justify with walk-forward evidence
- Suggest Donchian, MACD/Stoch, ORB, volume-anomaly, ascending-triangle, or any archetype that was killed in the audit
- Claim positive expectancy on any specific token (the live paper sample is n=2 right-tail wins; mean will regress to the +0.71% prediction)
- Execute trades or sign transactions — this is an evaluator, not an autonomous agent

## Built for

The **BNB HACK Hackathon** (sponsored by CoinMarketCap, Trust Wallet, BNB Chain) — Track 2 (Strategy Skills). Submission lock 2026-06-21 12:00 UTC.

## License

MIT.
