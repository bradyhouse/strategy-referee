// Backtests the emitted survivor spec against the same OHLCV the evaluator
// uses. Produces "what would this strategy have done on this token's
// history" stats — NOT a prediction. Single-token, single-spec scope; for
// population-level evidence see the walk-forward audit cited in the README.
//
// Uses @stratchai/backtest's applyFees + aggregate for fee accounting and
// summary stats. Trade simulation logic is local because the library's
// walkForward harness is geared toward parameter sweeps, not single-spec
// retrospective evaluation.

import {
  calcRSISeries,
  calcMFISeries,
  calcSMASeries,
} from "@stratchai/indicators";
import backtestLib from "@stratchai/backtest";

const { applyFees, aggregate } = backtestLib;

const FEE_ROUND_TRIP_PCT = 1.5;
const SMA200_PERIOD = 200;
const BB_MIDDLE_PERIOD = 20;
const WARMUP_BARS = 250;

// Survivor archetypes — params match sigma's walk-forward defensible combos
// (see docs/cmc_evidence_table.md §3a / §3b in the sigma repo).
const ARCHETYPES = {
  rsi_oversold: {
    rsi_oversold: 32,
    rsi_floor:    20,
    sl_pct:       -8,
    profit_floor_pct: 10,
    tp_pct:       15,
    max_hold_days: 10,
  },
  mfi_oversold: {
    mfi_oversold: 20,
    mfi_floor:    5,
    rsi_max:      35,
    sl_pct:       -8,
    profit_floor_pct: 11,
    tp_pct:       15,
    max_hold_days: 10,
  },
};

export function backtestSurvivor(klines, archetype) {
  const params = ARCHETYPES[archetype];
  if (!params) throw new Error(`Unknown archetype: ${archetype}`);
  if (klines.length < WARMUP_BARS) {
    return {
      archetype,
      n: 0,
      note: `Insufficient history (need ≥${WARMUP_BARS} bars, got ${klines.length}).`,
    };
  }

  const closes  = klines.map(k => k.close);
  const highs   = klines.map(k => k.high);
  const lows    = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const rsi      = calcRSISeries(closes, 14);
  const mfiObjs  = calcMFISeries(highs, lows, closes, volumes, 14);
  const sma200   = calcSMASeries(closes, SMA200_PERIOD);
  const bbMiddle = calcSMASeries(closes, BB_MIDDLE_PERIOD);

  // MFI series returns {value, ...} objects per bar (vs RSI's plain numbers);
  // unwrap once here so the inner loop reads from a numeric array.
  const mfi = mfiObjs.map(o => o?.value ?? null);

  const trades = simulate(closes, rsi, mfi, sma200, bbMiddle, klines, archetype, params);
  const withFees = applyFees(trades, FEE_ROUND_TRIP_PCT);
  const stats = aggregate(withFees);

  return {
    archetype,
    fee_round_trip_pct: FEE_ROUND_TRIP_PCT,
    n: stats.n,
    win_rate: round4(stats.win_rate),
    mean_net_pnl_pct: round4(stats.mean),
    median_net_pnl_pct: round4(stats.median),
    total_net_pnl_pct: round4(stats.total),
    std_pnl_pct: round4(stats.std),
    max_drawdown_pct: round4(maxEquityDrawdown(withFees)),
    exit_reason_breakdown: countByReason(withFees),
    trades_preview: withFees.slice(0, 5).map(prettyTrade),
    note: stats.n < 10
      ? `n=${stats.n} is small — single-token retrospective. Use the population-level walk-forward audit (n=29 OOS for rsi_oversold, n=18 for mfi_oversold) as the load-bearing evidence, not this number.`
      : undefined,
  };
}

function simulate(closes, rsi, mfi, sma200, bbMiddle, klines, archetype, params) {
  const trades = [];
  let inPosition = false;
  let entry = null;

  for (let i = WARMUP_BARS; i < closes.length; i++) {
    const close   = closes[i];
    const sma     = sma200[i];
    const bb      = bbMiddle[i];
    const r       = rsi[i];
    const m       = mfi[i];
    if (sma == null || bb == null || r == null || m == null) continue;

    if (!inPosition) {
      const inUptrend = close > sma;
      if (!inUptrend) continue;
      const entrySignal = archetype === "rsi_oversold"
        ? (r < params.rsi_oversold && r > params.rsi_floor && close <= bb)
        : (m < params.mfi_oversold && m > params.mfi_floor && r <= params.rsi_max);
      if (entrySignal) {
        inPosition = true;
        entry = { entry_idx: i, entry_price: close, entry_time: klines[i].openTime };
      }
      continue;
    }

    // In position — evaluate exits in priority order (SL > profit_floor > TP > time)
    const pnlPct = (close - entry.entry_price) / entry.entry_price * 100;
    const holdDays = i - entry.entry_idx;
    let exitReason = null;
    if (pnlPct <= params.sl_pct) exitReason = "SL";
    else if (pnlPct >= params.tp_pct) exitReason = "TP";
    else if (pnlPct >= params.profit_floor_pct) exitReason = "PROFIT_FLOOR";
    else if (holdDays >= params.max_hold_days) exitReason = "TIME_EXIT";

    if (exitReason) {
      trades.push({
        pnl_pct:    pnlPct,
        entry_idx:  entry.entry_idx,
        exit_idx:   i,
        entry_time: entry.entry_time,
        exit_time:  klines[i].openTime,
        hold_days:  holdDays,
        reason:     exitReason,
      });
      inPosition = false;
      entry = null;
    }
  }

  return trades;
}

// Equity-curve peak-to-trough drawdown across the trade sequence (NOT
// single-trade worst loss). Compounds (1 + net_pnl_pct/100) per trade.
function maxEquityDrawdown(trades) {
  let equity = 1.0;
  let peak = 1.0;
  let maxDrawdownPct = 0;
  for (const t of trades) {
    equity *= 1 + (Number(t.net_pnl_pct) / 100);
    if (equity > peak) peak = equity;
    const drawdownPct = (peak - equity) / peak * 100;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }
  return maxDrawdownPct;
}

function countByReason(trades) {
  const out = {};
  for (const t of trades) {
    out[t.reason] = (out[t.reason] ?? 0) + 1;
  }
  return out;
}

function prettyTrade(t) {
  return {
    entry: new Date(t.entry_time).toISOString().slice(0, 10),
    exit:  new Date(t.exit_time).toISOString().slice(0, 10),
    hold_days: t.hold_days,
    net_pnl_pct: round4(t.net_pnl_pct),
    reason: t.reason,
  };
}

function round4(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 10000) / 10000;
}
