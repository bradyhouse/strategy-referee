# Consolidated Walk-Forward Evidence Table

The evidence behind every `strategy-referee` verdict, in one referenceable
artifact. This is the detailed accounting that backs the narrative in
[`methodology.md`](methodology.md).

**Provenance & reproducibility.** The 21-archetype walk-forward audit was run in
a private trading-fleet repo against a live Coinbase (crypto) + Alpaca (stock)
universe of 134 products. The *methodology* — walk-forward split, embargo,
per-product OOS gates, the 1.5% real-fee model — is packaged as public
infrastructure in [`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest),
so any of the verdicts below are reproducible on your own OHLCV + volume slice.
The fleet repo itself is private; nothing here depends on access to it.

---

## 1. Methodology

| Knob | Value | Rationale |
|---|---|---|
| Split | 60% IS / 40% OOS, walk-forward | OOS is the load-bearing metric; IS is for sanity |
| Fee model | **1.5% per round trip** | Realistic for retail spot crypto + stock; conservative side of Alpaca/Coinbase combined |
| Sweep | Param grid per archetype | Top-10-by-IS-mean carried forward |
| Defensibility filter | OOS-positive AND min-trades AND min-per-product | k-of-10 defensibility count is the survivor metric |
| Embargo | Per-product OOS gates | Prevents look-ahead via cross-product leakage |
| Universe | Mixed crypto + stock cohorts (134 products); stock-only sub-cohorts run separately | Asset-class segregation is non-trivial — see §4 |

Walk-forward primitives (split, embargo, per-product OOS gates) are in
[`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest);
`strategy-referee` consumes the same package.

---

## 2. The 21 Archetypes — Final Accounting

**15 daily archetypes + 4 intraday/extension tests + 2 new-archetype experiments
= 21 archetypes walk-forward-tested at 1.5% real fees. Two survivors remain:
`rsi_oversold + SMA200` (strong, 6 defensible) and `mfi_oversold + SMA200`
(marginal, 2 defensible).**

### 2a. Daily archetypes — verdicts (15)

| Archetype | Result | Defensibility |
|---|---|---|
| `rsi_oversold + SMA200` | **SURVIVOR** | 6/10 OOS defensible; n=29 mean +0.71% win 62% |
| `mfi_oversold + SMA200` | **SURVIVOR (marginal)** | 2/10 OOS defensible; n=18 mean +0.89% win 56% |
| `rsi_oversold + SMA50` | KILLED | Spec defaults: 0 entries (SMA50 + RSI<32 contradictory in practice) |
| `rsi_oversold + NONE` (no trend filter) | KILLED | 3-variant sweep: only the SMA200 variant survived |
| `donchian_breakout_daily` | KILLED | 320-combo sweep: 18 IS-positive → 0/10 OOS positive (in-sample mirage) |
| `macd_stoch_daily` | KILLED | 0/10 OOS positive |
| `bb_squeeze_daily` | KILLED | 0/10 OOS positive |
| 4× other mean-reversion archetypes | KILLED | Only mfi_oversold survived from the 5-archetype meanrev batch |
| `aroon_trend` (stock-cohort) | **COHORT-BOUND** | 10 defensible at 0.10% stock fees; 0 at 1.5% mixed-cohort fees |
| `ichimoku_trend` (stock-cohort) | **COHORT-BOUND** | 10 stock-only at 0.10% fees; 0 on mixed 134-product cohort at any fee |
| `adx_supertrend` (stock-cohort) | RE-SHELVED | 2 stock-only at 0.10% fees; 0 elsewhere |
| 2× trend-pattern archetypes | KILLED | From the 6-pattern walk-forward; ascending_triangle flagged but un-deployable (see §2c) |

**Stock-cohort-only edges note:** aroon, ichimoku, and adx_supertrend show
defensible numbers when restricted to stock cohorts at 0.10% Alpaca-spot fees.
They **do not generalize** to the broader token universe — when crypto is
included or 1.5% fees applied, defensibility collapses to zero. Real edges at
the cohort/fee they were validated against, not generalizable strategies — so
they are deliberately **excluded** from the skill.

### 2b. Intraday/extension tests (4)

| Test | Result |
|---|---|
| `opening_range_breakout` (bare ORB) | KILLED — gross +0.054%/trade swamped by fees; live 0-for-3 confirmed |
| ORB × SPY-regime filter | KILLED — causal pre-entry SPY buckets within 0.03pp; no defensible filter |
| Intraday 15m rsi_oversold extension | KILLED — 0/10 defensible; gross +0.12%, ~18× weaker than daily |
| rsi_oversold regime conditioning (sma_distance) | **PARKED — suggestive** — 5–15% bucket wins n=16 +1.19%; <5% loses n=11 -0.55%; underpowered at n=29 |

### 2c. New-archetype experiments (2)

| Experiment | Result |
|---|---|
| Framework `calcAscendingTriangle` | KILLED — methodology: +2.56% OOS BUT top-3 products = 68.7% of return, 19/28 products at n=1 |
| Volume-anomaly capitulation (drop + spike + SMA200 + buyer confirm) | KILLED — fluke: initial +1.535% OOS collapsed to +0.74% after removing one product's single winner; stricter rerun 0 defensible |

---

## 3. Survivor deep-dive

### 3a. `rsi_oversold + SMA200` (strong)

- **Entry:** RSI(14) < 32 AND close > SMA200
- **Walk-forward:** 6/10 OOS defensible; n=29, **mean +0.71% net, 62% win rate** at 1.5% fees
- **Why it survives:** gross expectancy ~+2.2%/trade — an order of magnitude richer than killed archetypes (+0.05–0.12%). The fee floor doesn't wipe it.
- **Key params:** sl_pct -8, profit_floor_pct 10, max_hold 10d, candle_window 250

### 3b. `mfi_oversold + SMA200` (marginal)

- **Entry:** MFI(14) < 20 (currently oversold, NOT recovered) AND close > SMA200
- **Walk-forward:** 2/10 OOS defensible; n=18 mean +0.89% win 56% at 1.5% fees
- **Why marginal:** only 2 defensible splits vs RSI's 6 — competitive OOS numbers but thinner statistical evidence

### 3c. The structural fingerprint

Both survivors share the same shape:
1. **Oscillator-confirmed oversold** (RSI < 32 or MFI < 20)
2. **Long-horizon trend filter** (close > SMA200)
3. **Disciplined exit envelope** (SL ~-8%, profit floor ~+10–11%, max hold ~10 days)

RSI and MFI are **sibling implementations of the same pattern**, not independent
strategies. This is the entire surviving family.

---

## 4. Live paper validation (early, n=2 — right-tail, not significant)

The audit's edge claim has early live data points from a private broker-truth
paper sim (simulated execution against real exchange prices — no real capital):

| Product | Strategy | Hold | Net P&L | Exit |
|---|---|---|---|---|
| NEAR | `rsi_oversold_bounce_daily` | ~10.5h | **+5.25%** | PROFIT_FLOOR |
| FIDA | `rsi_oversold_bounce_daily` | ~1 day | **+5.42%** | PROFIT_FLOOR |

**Honest caveats (load-bearing):**
- n=2 is not significance. Both are right-tail outcomes; the mean will regress toward the walk-forward +0.71% prediction as n grows.
- This is **not** evidence of repeatable edge — it's two data points consistent with the spec's exit mechanic. The demo does not lean on it.

---

## 5. How the audit maps to the skill's decision logic

### 5a. PASS
- Oscillator-confirmed oversold: RSI(14) < 32 OR MFI(14) < 20 on daily bars
- Long-horizon uptrend: close > SMA200
- Sufficient history: ≥250 daily candles (SMA200 + sweep stability)

### 5b. WATCH
- RSI 32–40 (just above oversold) with a strong SMA200 uptrend, OR
- Oversold confirmed but `sma_distance < 5%` (suggestive losing bucket, n=11 mean -0.55%) — flag as elevated risk (risk flag, not a hard reject; the regime conditioning is parked-suggestive)

### 5c. REJECT (with plain-language explanation)
- Below SMA200 — "the survivor family requires a long-horizon uptrend; this token is in a downtrend"
- Not oversold by RSI or MFI — "no oversold reversal signal; entry conditions absent"
- Insufficient history — "fewer than 250 daily bars; SMA200 can't be computed honestly"

### 5d. Anti-claims the skill must NOT make
- ❌ "This strategy has positive expectancy on this token" (population-level edge ≠ per-trade conviction)
- ❌ "Donchian / volume-anomaly / MACD-Stoch / ORB signals entry" (all KILLED)
- ❌ Any claim that gross-edge below ~1% is tradeable (fee-floor rule)

### 5e. Emitted spec shape (on PASS)

```json
{
  "archetype": "rsi_oversold_bounce_daily | mfi_oversold_reversal_daily",
  "entry": { "rsi_max": 32, "trend_filter": "sma200_above" },
  "exit":  { "sl_pct": -8, "profit_floor_pct": 10, "max_hold_days": 10 },
  "candle_window": 250,
  "evidence": { "walk_forward_oos_mean_pct": 0.71, "walk_forward_oos_win_rate": 0.62 }
}
```

The emitted spec is a [`@stratchai/strategy-spec`](https://www.npmjs.com/package/@stratchai/strategy-spec)
payload, consumable by [`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest)
for the user's own re-validation.

---

## 6. Permitted vs forbidden pitch claims

**Permitted:** "Identifies setups resembling a narrow family of fee-aware,
walk-forward-surviving patterns." · "Rejects setups that don't match, with a
plain-language reason." · "Emits a backtestable strategy spec when conditions
qualify." · "Distilled from a 21-archetype walk-forward audit at 1.5% real fees."

**Forbidden:** "Best signals in crypto." · "Autonomous alpha." · "Guaranteed
profitable trades." · "Multi-strategy intelligence."

---

## 7. What's still unproven (for honest disclosure)

- **CMC token universe is unverified.** The audit ran on Coinbase crypto + Alpaca stocks. The survivor family *probably* transfers to CMC-listed tokens (same structural pattern, same indicator math), but transferability is not yet verified.
- **n=2 live wins is right-tail noise** — the mean will regress.
- **`sma_distance` regime conditioning is suggestive only** — instrumented as a risk flag, not a hard filter.
- **Stock-cohort-only edges (aroon, ichimoku) do not transfer to crypto** — deliberately excluded from the skill.

---

## 8. Reproducibility

The methodology is public infrastructure in
[`@stratchai/backtest`](https://www.npmjs.com/package/@stratchai/backtest)
(walk-forward split, embargo, per-product OOS gates, real-fee model). Given OHLC
+ volume for any token slice, the survivor walk-forward is reproducible with the
same package — which is exactly what `strategy-referee` runs under the hood.
