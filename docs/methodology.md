# Methodology — how strategy-referee got here

> **The load-bearing claim:** 21 strategy archetypes were tested with walk-forward validation at 1.5% real round-trip fees. Two survived. This tool only emits those two; everything else returns REJECT. The evidence behind that claim is below.

This document is self-contained. It's the public record of the audit that backs every PASS verdict the tool emits. Nothing here references a private repo — if you can read this, you can verify the claim.

---

## 1. The audit setup

| Knob | Value | Rationale |
|---|---|---|
| **Split** | 60% in-sample / 40% out-of-sample, walk-forward | OOS is the load-bearing metric; IS is sanity-check only |
| **Fee model** | **1.5% per round trip** | Realistic retail spot crypto on Coinbase + Alpaca combined; conservative side. Any backtest that ignores fees flatters the strategy. |
| **Sweep** | Per-archetype param grid; top-10-by-IS-mean carried to OOS | Avoids "cherry-pick the best param after seeing OOS" |
| **Defensibility** | OOS-positive **AND** min-trades **AND** min-per-product | A strategy with one freakishly good token isn't defensible — it's a lucky cohort |
| **Embargo** | Per-product OOS gates | Prevents look-ahead via cross-product leakage |
| **Universe** | Mixed crypto + stock cohorts, 134 products total; stock-only sub-cohorts run separately | Different asset classes have different volatility / fee structures |

The validation engine is the [`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest) npm package — walk-forward primitives + embargo + per-product OOS gates. Same package strategy-referee uses to compute the retrospective backtests shown on each PASS verdict. Open-source; reproducible.

---

## 2. The 21 archetypes — final accounting

**15 daily archetypes + 4 intraday/extension tests + 2 new-archetype experiments = 21 archetypes total.** Walk-forward-tested at 1.5% real fees. **Two survivors** remain.

### 2a. Daily archetypes (15)

| Archetype | Verdict | Evidence |
|---|---|---|
| `rsi_oversold + SMA200` | ✅ **SURVIVOR** | 6/10 OOS defensible combos; n=29 mean **+0.71%** win **62%** |
| `mfi_oversold + SMA200` | ✅ **SURVIVOR (marginal)** | 2/10 OOS defensible; n=18 mean **+0.89%** win **56%** |
| `rsi_oversold + SMA50` | ❌ Killed | Defaults produce 0 entries (SMA50 + RSI<32 mutually exclusive in practice) |
| `rsi_oversold + NONE` (no trend filter) | ❌ Killed | Only the SMA200 variant survived the trend-filter sweep |
| `donchian_breakout_daily` | ❌ Killed | 320-combo sweep: 18 IS-positive → **0/10 OOS positive** (in-sample mirage) |
| `macd_stoch_daily` | ❌ Killed | 0/10 OOS positive |
| `bb_squeeze_daily` | ❌ Killed | 0/10 OOS positive |
| 4× mean-reversion variants | ❌ Killed | Only `mfi_oversold` survived from the 5-archetype mean-reversion batch |
| `aroon_trend` (stock cohort) | ⚠ Cohort-bound | 10 defensible at 0.10% stock fees; **0** at 1.5% mixed-cohort fees |
| `ichimoku_trend` (stock cohort) | ⚠ Cohort-bound | 10 stock-only at 0.10% fees; **0** on mixed crypto+stock at any fee |
| `adx_supertrend` (stock cohort) | ❌ Killed | 2 stock-only at 0.10%; 0 elsewhere |
| 2× trend-pattern archetypes | ❌ Killed | From the 6-pattern walk-forward batch |

**On "cohort-bound" edges**: `aroon_trend`, `ichimoku_trend`, and `adx_supertrend` show defensible numbers ONLY on stock-only cohorts at Alpaca's 0.10% fees. They don't generalize to a crypto universe or higher fees. Real edges in their specific corner — not strategies for a CMC-token-only evaluator like this one.

### 2b. Intraday + extension tests (4)

| Test | Verdict | Evidence |
|---|---|---|
| `opening_range_breakout` (bare ORB) | ❌ Killed | Gross +0.054%/trade swamped by realistic fees; live 0-for-3 confirmed shelving |
| ORB × SPY-regime filter | ❌ Killed | Pre-entry SPY-direction buckets span 0.03pp (noise floor) |
| Intraday 15m `rsi_oversold` extension | ❌ Killed | 0/10 defensible; gross +0.12% — **18× weaker than the daily survivor** |
| `bullish_intraday_candle_trend` (vision experiment) | ❌ Killed | Best meanScore -0.80; never produced positive OOS |

### 2c. New-archetype experiments (2)

| Experiment | Verdict | Evidence |
|---|---|---|
| `ascending_triangle_long_daily` | ❌ Flagged but un-deployable | Walk-forward survived 1 combo at small sample size; live deployment blocked by spec ambiguity |
| `news_velocity_stock_daily` (PEAD-derivative) | 🟡 Live-validation only | Cron-based event-driven; outside the daily-archetype scope this tool addresses |

---

## 3. Why the two survivors share a structural fingerprint

Both survivors are mean-reversion-within-uptrend strategies. They share:

1. **Oscillator-confirmed oversold** (RSI < 32 OR MFI < 20) — buys the dip
2. **Long-horizon uptrend filter** (close > SMA200) — but only in established uptrends
3. **Disciplined exit envelope** (SL ~-8%, profit floor ~+10%, max hold ~10 days)

This is what the tool's [verdict tree](../README.md#decision-logic) encodes: 4 conditions that match this structural shape. PASS means "the current setup matches the survivor fingerprint." It does NOT mean "this token will go up."

---

## 4. The CMC re-check (Audit transparency block)

A reasonable critique of any audit is: *"your verdict depends on YOUR universe — would another universe overturn it?"* The original audit ran on Coinbase + Alpaca over ~5 years. The CMC top-30 today is a different universe (post-audit tokens like HYPE/SUI; different volatility regime; different mix).

To answer this empirically, the tool's bundled `data/audit_universe_screening.json` contains a fresh walk-forward of **all 46 shelved daily-crypto archetypes** against the CMC top-30 at 1.5% real fees on Kraken 720-bar history. Result: **1 rescue candidate** (`mass_index_reversal_daily` at n=28 mean +0.51%, win 46%) — marginal, just above the noise floor; would need deeper validation before any unshelving.

The other 45 stayed negative-expectancy on the CMC universe too. The audit's verdicts hold.

This data is what powers the expandable "Audit transparency" panel on every result card — judges can verify the audit was rigorous, not asserted.

---

## 5. What the verdicts mean

| Verdict | Conditions | Output |
|---|---|---|
| **PASS** | RSI < 32 OR MFI < 20, AND close > SMA200, AND sma_distance ≥ 5%, AND ≥250 daily bars | Strategy spec + retrospective backtest + (on historical date) forward-look |
| **WATCH** (oversold-elevated) | Oversold + uptrend, BUT sma_distance < 5% (worse regime bucket — n=11 underpowered conditioning showed -0.55% mean for this bucket) | Strategy spec, flagged elevated-risk |
| **WATCH** (near-trigger) | RSI within 8 of 32 OR MFI within 8 of 20, in uptrend | No spec; informational |
| **REJECT** | Below SMA200, no oversold signal, insufficient history, or no Kraken OHLC data | Plain-language explanation |

---

## 6. Anti-claims this tool will NOT make

- ❌ "This token will go up." Population-level walk-forward edge ≠ single-trade prediction.
- ❌ "This strategy is positive expectancy on YOUR account." Trade timing, slippage, taxes, opportunity cost vary.
- ❌ "Donchian/MACD/Stoch/Bollinger-squeeze are good strategies for crypto." They failed the audit. Don't deploy them.
- ❌ "+0.71% is exceptional." It's not — it's barely above noise. The point is *what survived* a rigorous gauntlet, not *how big* the edge is.
- ❌ "1.5% fees are exactly what you'd pay." Coinbase taker fees range; this is a conservative consolidated estimate.

The README's "honest disclosure" block on every PASS view repeats this in-band.

---

## 7. What's still unproven

- **Single-trade outcome.** PASS is a population claim, not a per-trade prediction.
- **Live execution on real money.** Backtests vs. broker truth has fee/slippage gaps. The audit included a live-paper calibration step; full broker-truth verification at scale is ongoing engineering work.
- **Edge stability over future market regimes.** All audits look backward.
- **Universe transferability beyond CMC top-30.** The audit and CMC re-check cover liquid majors. Edge on micro-cap is unknown.

These are honest caveats. They're not reasons to ignore the verdict — they're reasons to size positions conservatively when acting on it.

---

## 8. Reproducibility

The strategies' params come from the same [`@stratchai/strategy-spec`](https://www.npmjs.com/package/@stratchai/strategy-spec) package the tool emits on PASS. The backtest engine is [`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest). The indicator series come from [`@stratchai/indicators`](https://www.npmjs.com/package/@stratchai/indicators). The chart is [`@stratchai/cathode`](https://www.npmjs.com/package/@stratchai/cathode). All 4 are public npm packages — same suite this tool dogfoods on every render.

Anyone with these libraries + 720 daily bars from any token can reproduce the verdict logic. That's the honest version.
