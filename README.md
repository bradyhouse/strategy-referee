# strategy-referee

> **Most strategy tools generate trades. This one rejects setups that don't match the small family of strategies that survived a 21-archetype walk-forward audit.**

A CoinMarketCap-powered evaluator that asks one question per token: *does this match the narrow, fee-aware, walk-forward-validated mean-reversion family we believe in?* If yes, emit a backtestable strategy spec, show retrospective evidence, and (for historical dates) show what would have happened. If no, reject with a plain-language explanation and refuse to fabricate signals.

Built on the [`@stratchai/*`](https://www.npmjs.com/org/stratchai) library suite — `indicators`, `strategy-spec`, `backtest`, `cathode`.

## Quick start

```bash
git clone https://github.com/bradyhouse/strategy-referee.git
cd strategy-referee
npm install
cp .env.example .env
# add your free-tier CMC API key to .env (sign up at https://coinmarketcap.com/api/pricing/)

node src/index.js --token BTC

# Or run the web UI
npm run serve     # build + serve at http://localhost:5174
```

> A repo-local `.npmrc` sets `legacy-peer-deps=true` so plain `npm install` works on a clean checkout. This is a workaround for a stale peer-range in `@stratchai/strategy-spec@0.5.0` — see the file's comment for the full context.

See [`docs/cmc_api_auth.md`](docs/cmc_api_auth.md) for full credential setup and the rationale behind the two-source data architecture (CMC for market intelligence + Kraken for historical OHLCV).

## The demo flow

Three commands that walk through the entire value proposition:

### 1. Live universe scan — most things are REJECT

```bash
node src/index.js --watchlist BTC,ETH,SOL,LINK,ADA,DOGE
```

In a downtrending market, expect mostly `REJECT/BELOW_SMA200`. That's the **anti-hype** behavior: the survivor family requires uptrend confirmation, and we don't pretend otherwise. A naive screener would flag deeply-oversold BTC as a buy; this tool doesn't.

### 2. Historical replay — find a real PASS

```bash
node src/index.js --watchlist BTC,ETH,SOL,LINK,ADA,DOGE --at-date 2025-09-25
```

That date was a real multi-coin correction-bounce moment. **3 simultaneous PASS verdicts** (LINK, ETH, SOL) — all in confirmed uptrend with RSI below 32.

### 3. Drill in — see the full reasoning + forward-look + emitted spec

```bash
node src/index.js --token ETH --at-date 2025-09-25
```

Output (abridged):

```
[PASS]  ETH  as of 2025-09-25
------------------------------------------------------------
  Close              3872.63
  RSI(14)            27.21
  SMA(200)           2919.89
  Close vs SMA200    32.63%

Reasoning:
  - RSI(14) = 27.21 confirms oversold (< 32).
  - Long-horizon uptrend confirmed (close 3872.63 > SMA200 2919.89).
  - Setup matches the walk-forward survivor family.

Forward-look (what would have happened if you entered at as-of close):
  Entered             2025-09-25 @ 3872.63
  Exited              2025-10-01 @ 4350.03  (PROFIT_FLOOR)
  Hold                6 days
  Net P&L (1.5% fees) 10.83%

Strategy spec emitted: rsi_oversold_bounce_daily__ETH
```

Extract the spec as standalone JSON:

```bash
node src/index.js --token ETH --at-date 2025-09-25 --emit-spec > eth-spec.json
```

That JSON validates against `@stratchai/strategy-spec`'s schema and is consumable by `@stratchai/backtest` for further validation. It's the canonical strategy-spec format — anything that consumes specs in that shape can run the emitted strategy as-is.

## Status

CLI is **feature-complete** for the demo. Web UI per [`docs/wireframes/`](docs/wireframes/) is planned but not yet built.

| Component | Status |
|---|---|
| Single-token evaluation (PASS / WATCH / REJECT) | ✅ shipped |
| Reasoning + signals (RSI / MFI / SMA200 / sma_distance) | ✅ shipped |
| Strategy-spec emission on PASS (`@stratchai/strategy-spec`) | ✅ shipped |
| Retrospective backtest (`@stratchai/backtest`) | ✅ shipped |
| Historical replay (`--at-date YYYY-MM-DD`) | ✅ shipped |
| Forward-look simulation (on PASS at historical date) | ✅ shipped |
| Watchlist mode with PASS-first ranking | ✅ shipped |
| Web UI per [wireframes](docs/wireframes/) | 🚧 designed, not built |
| Trust Wallet Agent Kit preview-mode integration (stretch) | 📋 planned |

## The thesis

A 21-archetype walk-forward audit at 1.5% real round-trip fees on a mixed crypto + stock universe identified two survivors. Full evidence in [`docs/methodology.md`](docs/methodology.md) — the audit setup, the 21-archetype final accounting, the structural fingerprint shared by the survivors, and the CMC top-30 re-check that confirms the cull verdicts hold on the current universe.

| Survivor | Defensibility | OOS mean | OOS win rate |
|---|---|---|---|
| `rsi_oversold + SMA200` | 6 / 10 defensible combos | +0.71% | 62% |
| `mfi_oversold + SMA200` | 2 / 10 defensible (marginal) | +0.89% | 56% |

Both share the same structural fingerprint:

1. Oscillator-confirmed oversold condition (RSI < 32 OR MFI < 20)
2. Long-horizon uptrend filter (close > SMA200)
3. Disciplined exit envelope (SL ~-8%, profit floor ~+10–11%, max hold ~10 days)

Everything else — Donchian, MACD/Stoch, bare ORB, volume-anomaly, framework ascending-triangle, intraday extensions — was killed under walk-forward + adversarial review. Most archetypes have *some* tiny gross edge that real fees swamp; the survivors have ~+2.2% gross, an order of magnitude richer.

## Does it transfer to Kraken?

The sigma audit ran on Coinbase + Alpaca. This evaluator uses Kraken klines for OHLCV. We re-ran both survivor archetypes against 30 curated top-cap Kraken tokens:

| Source | Archetype | n | Mean net | Win rate |
|---|---|---|---|---|
| Sigma audit | `rsi_oversold + SMA200` | 29 | +0.71% | 62% |
| Kraken top-30 (this repo) | `rsi_oversold + SMA200` | 56 | **+3.86%** | 67.9% |

**The edge directionally transfers, but the observed magnitude (+3.86%) is ~5.4× sigma's baseline.** Almost certainly bull-market tilt in the 720-day lookback + survivorship bias from selecting top-30-by-current-market-cap. **We treat sigma's +0.71% as the load-bearing claim**; the Kraken result is a transferability sanity check, not evidence of a stronger edge.

Full results + caveats: [`docs/cmc_universe_verification.md`](docs/cmc_universe_verification.md). Reproducible via `node scripts/verify_cmc_universe.js`.

## Architecture

Two-source data design — see [`docs/cmc_api_auth.md`](docs/cmc_api_auth.md) for the source-shopping notes (why not Binance.com, why not CryptoCompare).

| Layer | Source / library |
|---|---|
| Market intelligence (token discovery, market cap, live sanity quote, macro context) | CoinMarketCap Pro API (free tier — 15K credits/mo) |
| Historical OHLCV (RSI / MFI / SMA200 inputs) | Kraken public OHLC API (no auth, US-accessible, 720-bar depth) |
| Indicator computation | [`@stratchai/indicators`](https://www.npmjs.com/package/@stratchai/indicators) — RSI / MFI / SMA series |
| Strategy spec schema | [`@stratchai/strategy-spec`](https://www.npmjs.com/package/@stratchai/strategy-spec) — validation + spec authoring |
| Backtest engine | [`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest) — fees, aggregation, walk-forward primitives |
| Chart rendering (web UI, planned) | [`@stratchai/cathode`](https://www.npmjs.com/package/@stratchai/cathode) — CRT-styled Vue 3 candles |

## Decision logic

| Verdict | Conditions | Attached payload |
|---|---|---|
| **PASS** | RSI < 32 OR MFI < 20, AND close > SMA200, AND sma_distance ≥ 5%, AND ≥250 daily bars | Strategy spec + retrospective backtest + (on historical date) forward-look |
| **WATCH** (oversold-confirmed) | Oversold by oscillator + uptrend, BUT sma_distance < 5% (elevated-risk bucket from regime conditioning, suggestive only) | Strategy spec + retrospective backtest, flagged as elevated risk |
| **WATCH** (near-trigger) | RSI or MFI within 8 points of oversold threshold, in uptrend | No spec — informational only |
| **REJECT** | Below SMA200, no oversold signal, insufficient history, or no Kraken OHLC data | Plain-language explanation |

## What this tool does NOT do

- Recommend trades it can't justify with walk-forward evidence
- Suggest Donchian, MACD/Stoch, ORB, volume-anomaly, ascending-triangle, or any archetype that was killed in the audit
- Claim positive expectancy on any specific token — the population-level walk-forward audit is the load-bearing claim
- Execute trades or sign transactions — this is an evaluator, not an autonomous agent
- Pretend the Kraken verification's +3.86% is a stronger edge than sigma's +0.71% — see the universe verification doc

## CLI reference

```
Usage:
  node src/index.js --token <SYMBOL>
  node src/index.js --watchlist <SYM,SYM,...>

Flags:
  --token <SYMBOL>       Single-token evaluation
  --watchlist <SYM,...>  Comma-separated watchlist; PASS-first ranked
  --at-date <DATE>       Evaluate as of YYYY-MM-DD (historical replay)
  --json                 Emit full result as JSON
  --emit-spec            Print only the strategy-spec JSON (PASS / oversold-WATCH only)
  --help, -h             Show help

Exit codes:
  Single-token:  0 = PASS/WATCH, 2 = REJECT, 3 = no spec to emit
  Watchlist:     0 = any PASS/WATCH found, 2 = all REJECT
```

## Repository layout

```
strategy-referee/
├── src/
│   ├── index.js           CLI entry, flag parsing, pretty/JSON output
│   ├── evaluator.js       Verdict decision tree + signals + reasoning assembly
│   ├── cmc.js             CoinMarketCap Pro client (listings, quotes, info, key/info)
│   ├── ohlcv.js           Kraken OHLC client (with source-shopping rationale)
│   ├── backtest.js        Retrospective backtest + forward-look simulation
│   ├── spec_builder.js    @stratchai/strategy-spec payload builder
│   └── watchlist.js       Batched scan harness + PASS-first ranking
├── scripts/
│   └── verify_cmc_universe.js   Reproducible Kraken transferability test
└── docs/
    ├── cmc_api_auth.md              Credential setup + tier + data-source rationale
    ├── cmc_universe_verification.md Auto-generated transferability evidence
    └── wireframes/                  SVG mockups (Figma-importable) of the planned web UI
```

## Built for

The **BNB HACK Hackathon** — sponsored by CoinMarketCap, Trust Wallet, BNB Chain. Targeting **Track 2 (Strategy Skills)** + **Best CMC Data & Signal Use** special prize. Submission lock 2026-06-21 12:00 UTC.

## License

MIT.
