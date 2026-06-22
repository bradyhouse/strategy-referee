# strategy-referee — an MCP agent skill that turns CoinMarketCap data into a backtestable strategy spec, and rejects most tokens by design

**Track 2 (Strategy Skills)** — a reusable, agent-invokable MCP skill that emits a backtestable spec; no live execution. · **Best CMC Data & Signal Use** candidate — CMC defines the eligible universe and supplies the live quote, rank, and macro context behind every verdict.

**Demo:** https://strategy-referee.vercel.app/ · **Live MCP endpoint:** https://strategy-referee.vercel.app/api/mcp · **GitHub (MIT):** https://github.com/bradyhouse/strategy-referee

## TL;DR

Most strategy tools generate trades. **strategy-referee** generates *refusals*. It is an agent-callable MCP skill that evaluates a CoinMarketCap-listed token against one narrow, fee-aware, walk-forward-validated mean-reversion family — and emits a backtestable [`@stratchai/strategy-spec`](https://www.npmjs.com/package/@stratchai/strategy-spec) when the token matches the survivor family (a spec also accompanies the elevated-risk WATCH case, explicitly flagged). Everything else gets a plain-language REJECT. For an agent, a calibrated REJECT with a reason is actionable; a forced setup on every token is noise.

## The anti-hype thesis

A 21-archetype walk-forward audit at **1.5% real round-trip fees** — a conservative consolidated retail estimate for Coinbase/Alpaca spot, deliberately on the high side so the audit can't flatter a strategy by under-charging costs — found that almost nothing survives once real costs are charged. Some archetypes showed in-sample edge that vanished out-of-sample; others had a tiny gross edge that fees swamped; a few were single-product flukes. Under one consistent gauntlet (15 daily + 4 intraday/extension + 2 new-archetype = 21), **only two survived.** The narrow filter is the product.

## The two survivors

| Survivor | Defensibility (OOS) | OOS mean / trade | Win rate | n |
|---|---|---|---|---|
| `rsi_oversold + SMA200` | 6 / 10 defensible combos | +0.71% | 62% | 29 |
| `mfi_oversold + SMA200` | 2 / 10 defensible (marginal) | +0.89% | 56% | 18 |

*Defensibility = how many of the top-10 in-sample parameter combinations stayed positive out-of-sample (OOS) — a guard against post-hoc parameter cherry-picking. The defensibility count, not the point mean, is the survivor metric: MFI's higher +0.89% is **not** a stronger edge — it rests on thinner evidence (2/10 splits, n=18) than RSI (6/10, n=29).*

Both share one structural fingerprint: an oscillator-confirmed oversold condition (**RSI(14) < 32 OR MFI(14) < 20**), inside a long-horizon uptrend (**close > SMA(200)**), with a disciplined exit envelope (**SL −8%, profit floor +10% RSI / +11% MFI, max hold ~10 days**). Killed under the same audit: Donchian, MACD/Stoch, bare ORB, volume-anomaly, and ascending-triangle (one of two trend-pattern archetypes from a 6-pattern batch), among others.

## Most tokens reject — by design

The survivor gate is narrow on purpose: a token qualifies only inside a specific oversold-in-uptrend window. A trailing-90-day re-check of the CMC top-30 (scanned 2026-06-20) matched **exactly one token** — TON, five `rsi_oversold` entries in late May (most recent 2026-05-25); the other 29 never qualified. That scarcity is the refusal behavior this submission argues for, not a broken pipeline — the PASS demos use historical dates where the setup genuinely occurred.

## How CMC data drives the decision (per-evaluation pipeline)

CMC defines **which** tokens are even eligible (cap rank + live USD volume gate the universe) and supplies the live sanity quote and rank that every verdict reports; Kraken only supplies the historical bars CMC's free tier withholds.

1. **Discovery / universe** — `/v1/cryptocurrency/listings/latest` ranks the top-cap CMC universe (live discovery pulls the top ~50, manually filtered to drop stablecoins and tokens with no Kraken USD pair; exclusions are reported per-token).
2. **Live quote + market cap** — `/v1/cryptocurrency/quotes/latest` (batched, comma-list) for the live sanity quote, CMC market rank, and 24h USD volume.
3. **Macro context** — `/v1/global-metrics/quotes/latest` for total-cap / BTC-dominance context.
4. **Metadata** — `/v1/cryptocurrency/info` resolves the canonical CMC id (disambiguating duplicate ticker symbols) used to batch the quotes call.
5. **Signal → rule** — Kraken daily OHLCV (free, no-auth, 720-bar depth — margin above the 250-bar SMA200 floor, and well beyond the 300-candle cap that ruled out Coinbase during source-shopping) feeds [`@stratchai/indicators`](https://www.npmjs.com/package/@stratchai/indicators) to compute RSI/MFI/SMA200. A **3-condition hard gate** (≥250 bars, close > SMA200, oscillator-oversold) decides PASS vs REJECT; a fourth **regime check** (`sma_distance ≥ 5%`) downgrades a qualifying PASS to an elevated-risk WATCH (still spec-emitting, flagged). Below-SMA200 / not-oversold / insufficient-history / no-Kraken-pair are the REJECT paths.

See [`docs/cmc_api_auth.md`](https://github.com/bradyhouse/strategy-referee/blob/main/docs/cmc_api_auth.md) for the source-shopping rationale.

## Three ways to use it

Same evaluator core behind all three.

**1. As an MCP skill (the Track 2 deliverable).** Two tools — `evaluate_token` and `evaluate_watchlist` — over two transports built from one shared definition:

```bash
# Streamable HTTP (stateless, deployed on Vercel — no clone, no key, nothing to install)
claude mcp add --transport http strategy-referee https://strategy-referee.vercel.app/api/mcp

# stdio (local — requires git clone + npm install first, and a CMC key)
claude mcp add strategy-referee --env CMC_API_KEY=your-key -- node /abs/path/to/strategy-referee/mcp/server.js
```

Then ask your agent *"evaluate ETH"* or *"scan BTC, SOL, LINK"* — it returns a verdict, a per-condition gate checklist, and (on PASS/WATCH) a spec you can hand to [`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest) for your own re-validation.

**2. Web demo** — the same core with an in-browser **Agent skill** tab (a [`@stratchai/cathode`](https://www.npmjs.com/package/@stratchai/cathode) terminal) that drives the real tools live.

**3. CLI** — `node src/index.js --token BTC`.

## Tech stack

Built by dogfooding the full `@stratchai/*` suite: `indicators` ^0.4.0 (RSI/MFI/SMA), `strategy-spec` ^0.5.0 (validated spec authoring), `backtest` ^0.0.3 (fees + walk-forward primitives), `cathode` ^0.1.6 (CRT-styled Vue charts). MCP via `@modelcontextprotocol/sdk` ^1.29.0 (stdio + stateless Streamable-HTTP). Data: CoinMarketCap Pro (free tier) + Kraken public OHLC. MIT licensed.

## What it does NOT do

- Recommend trades it can't justify with walk-forward evidence.
- Suggest any archetype killed in the audit (Donchian, MACD/Stoch, bare ORB, volume-anomaly, ascending-triangle).
- Claim positive expectancy on a specific token — the population-level audit is the load-bearing claim, not an in-sample re-run.
- Execute trades or sign transactions. It is an evaluator, not an autonomous agent.

## Links

- **Demo:** https://strategy-referee.vercel.app/
- **Deployed MCP endpoint:** https://strategy-referee.vercel.app/api/mcp
- **GitHub (MIT):** https://github.com/bradyhouse/strategy-referee
- **Methodology + evidence:** [`docs/methodology.md`](https://github.com/bradyhouse/strategy-referee/blob/main/docs/methodology.md) · [`docs/cmc_evidence_table.md`](https://github.com/bradyhouse/strategy-referee/blob/main/docs/cmc_evidence_table.md) · [`docs/cmc_universe_verification.md`](https://github.com/bradyhouse/strategy-referee/blob/main/docs/cmc_universe_verification.md) (historical edge-transfer test)
- **Trailing-90-day scan (CMC top-30, dated):** [`data/current_pass_scan_2026-06-20.json`](https://github.com/bradyhouse/strategy-referee/blob/main/data/current_pass_scan_2026-06-20.json) — 1 of 30 tokens matched (TON, late May)
