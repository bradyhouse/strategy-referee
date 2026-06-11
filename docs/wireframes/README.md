# Wireframes

Low-fidelity SVG mockups of the planned web UI. Each file is a single screen at 1440 px wide and is importable into Figma (`File → Import` or paste). Groups have meaningful `id` attributes so the imported layers carry their semantic names.

| File | Verdict shown | Purpose |
|---|---|---|
| `01_pass_view.svg` | **PASS** — ETH as of 2025-09-25 | Full demo flow: PASS verdict + signals + reasoning + forward-look + retrospective backtest + emitted spec |
| `02_watchlist_view.svg` | **3 PASS / 3 WATCH** — historical scan of 6 majors on 2025-09-25 | Tabular watchlist scan with PASS-first ranking + drill-in hint |
| `03_reject_view.svg` | **REJECT** — BTC today (BELOW_SMA200) | Anti-hype thesis: oversold but in downtrend → reject the "falling knife" setup |

## How these map to the implementation

The CLI already produces all the verdicts and data shown here. The web UI is a thin presentation layer over the same `evaluateToken` / `evaluateWatchlist` functions:

| Wireframe component | Implementation source |
|---|---|
| Verdict badge + reasoning bullets | `result.verdict`, `result.reasoning[]` |
| Signals grid (close / RSI / MFI / SMA / Δ) | `result.signals` |
| Chart panel | `@stratchai/cathode` candles + SMA200 overlay (uses Kraken klines passed through) |
| Forward-look block (PASS only) | `result.forward_look` from `simulateForwardEntry` |
| Backtest block (PASS only) | `result.backtest` from `backtestSurvivor` |
| Strategy spec emission | `result.spec` from `buildRsiSurvivorSpec` / `buildMfiSurvivorSpec` |

## Notes on the design

- **Color discipline:** green (`#10b981`) for PASS / favorable, amber (`#f59e0b`) for WATCH / borderline, red (`#ef4444`) for REJECT / unfavorable.
- **The REJECT view is intentionally honest about the contradiction.** RSI and MFI being deeply oversold while the verdict is REJECT is exactly the "anti-hype" thesis the project promises — most screeners would flag BTC as a buy here; we don't, because the survivor family's audit said "falling knives lose money."
- **The PASS view leans into the demo gold.** The forward-look block with concrete entry/exit dates and a real +10.83% net P&L is the moment that earns judge attention. Numbers come from the actual ETH 2025-09-25 backtest run, not mock data.
- **The watchlist view emphasizes ranking.** PASS rows bubble to the top; WATCH with spec ranks above WATCH without; REJECT rows at the bottom. This is what the user sees first when they scan a list.

## Editing

Open any `.svg` in Figma (drag-and-drop or `File → Import`). Each top-level `<g>` becomes a Figma frame; child elements become editable shapes. Text uses Inter (system fallback) and JetBrains Mono for numeric values.
