// Evaluator — given a token symbol, return PASS / WATCH / REJECT plus
// reasoning. Decision logic mirrors the walk-forward survivor family:
// oscillator-oversold (RSI<32 OR MFI<20) inside a long-horizon uptrend
// (close > SMA200). See README.md and the sigma evidence table for the
// audit that justifies these thresholds.

import {
  calcRSISeries,
  calcMFISeries,
  calcSMASeries,
} from "@stratchai/indicators";
import { fetchDailyKlines } from "./ohlcv.js";
import { quotesLatest } from "./cmc.js";
import { buildRsiSurvivorSpec, buildMfiSurvivorSpec } from "./spec_builder.js";
import { backtestSurvivor, simulateForwardEntry } from "./backtest.js";

const RSI_OVERSOLD = 32;
const MFI_OVERSOLD = 20;
const RSI_NEAR     = 40;
const MFI_NEAR     = 30;
const MIN_BARS     = 250;
// sma_distance < 5% bucket lost -0.55% mean on n=11 in the rsi_oversold regime
// conditioning workflow. Underpowered but directionally consistent — treat as
// elevated-risk PASS rather than full confidence.
const ELEVATED_RISK_SMA_DISTANCE_PCT = 5;

export async function evaluateToken(symbol, opts = {}) {
  const sym = symbol.toUpperCase();
  let cmcQuote;
  try {
    const quotes = await quotesLatest(sym);
    cmcQuote = quotes[sym];
    if (!cmcQuote) {
      return reject(sym, "TOKEN_NOT_FOUND_ON_CMC", `${sym} is not listed on CoinMarketCap.`);
    }
  } catch (e) {
    return reject(sym, "CMC_LOOKUP_FAILED", e.message);
  }
  return evaluateTokenWithQuote(sym, cmcQuote, opts);
}

// Same flow as evaluateToken but with a pre-fetched CMC quote object. Used
// by watchlist mode to batch the CMC call across N symbols (single quote
// fetch, parallel Kraken fetches), avoiding the per-symbol CMC quota burn.
export async function evaluateTokenWithQuote(symbol, cmcQuote, opts = {}) {
  const sym = symbol.toUpperCase();
  const { asOfDateMs = null } = opts;

  if (!cmcQuote) {
    return reject(sym, "TOKEN_NOT_FOUND_ON_CMC", `${sym} is not listed on CoinMarketCap.`);
  }

  // Kraken historical OHLCV — the indicator pipeline. Always fetch the full
  // window; if asOfDateMs is provided, slice client-side into "as-of" (used
  // for verdict + spec + backtest) and "forward" (used for the post-entry
  // simulation when PASS) sets. No look-ahead leaks: as-of bars are the only
  // input to the decision tree.
  let fullKlines;
  try {
    fullKlines = await fetchDailyKlines(sym, 720);
  } catch (e) {
    if (e.code === "NO_OHLCV_HISTORY") {
      return reject(sym, "NO_OHLCV_HISTORY",
        `${sym} is on CoinMarketCap but the OHLCV source returns no daily history — survivor-family indicators cannot be computed honestly.`);
    }
    return reject(sym, "OHLCV_FETCH_FAILED", e.message);
  }

  let klines = fullKlines;
  let forwardKlines = [];
  if (asOfDateMs != null) {
    klines = fullKlines.filter(k => k.closeTime <= asOfDateMs);
    forwardKlines = fullKlines.filter(k => k.openTime > asOfDateMs);
    if (klines.length === 0) {
      return reject(sym, "AS_OF_DATE_BEFORE_HISTORY",
        `--at-date is before this token's OHLCV history begins (oldest available bar opens ${new Date(fullKlines[0].openTime).toISOString().slice(0,10)}).`);
    }
  }

  if (klines.length < MIN_BARS) {
    return reject(sym, "INSUFFICIENT_HISTORY",
      `Need ≥${MIN_BARS} daily bars to compute SMA(200) reliably; got ${klines.length}. Token is likely too new (or the as-of date is too early).`);
  }

  // Indicator pipeline
  const closes  = klines.map(k => k.close);
  const highs   = klines.map(k => k.high);
  const lows    = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const rsiSeries = calcRSISeries(closes, 14);
  const mfiSeries = calcMFISeries(highs, lows, closes, volumes, 14);
  const smaSeries = calcSMASeries(closes, 200);

  const i = closes.length - 1;
  const lastClose = closes[i];
  const lastRsi   = rsiSeries[i];
  // calcMFISeries returns {value, overbought, oversold} per bar — not a raw
  // number like RSI. Inconsistent API in @stratchai/indicators; flag upstream.
  const lastMfi   = mfiSeries[i]?.value ?? null;
  const lastSma   = smaSeries[i];
  const smaDistancePct = lastSma ? ((lastClose - lastSma) / lastSma * 100) : null;

  const signals = {
    close:               r2(lastClose),
    rsi:                 r2(lastRsi),
    mfi:                 r2(lastMfi),
    sma200:              r2(lastSma),
    sma_distance_pct:    r2(smaDistancePct),
    cmc_rank:            cmcQuote.cmc_rank,
    cmc_volume_24h_usd:  r2(cmcQuote.quote?.USD?.volume_24h),
    bars_used:           closes.length,
    last_bar_close_time: new Date(klines[i].closeTime).toISOString(),
  };

  // Decision tree
  if (lastClose <= lastSma) {
    return reject(sym, "BELOW_SMA200",
      `Close ${signals.close} is at or below SMA200 ${signals.sma200} (Δ ${signals.sma_distance_pct}%). The survivor family requires a long-horizon uptrend filter; do not enter long.`,
      signals);
  }

  const oversoldRsi = lastRsi < RSI_OVERSOLD;
  const oversoldMfi = lastMfi < MFI_OVERSOLD;
  const nearRsi     = lastRsi < RSI_NEAR;
  const nearMfi     = lastMfi < MFI_NEAR;

  if (oversoldRsi || oversoldMfi) {
    const oscillator = oversoldRsi ? "RSI" : "MFI";
    const oscValue   = oversoldRsi ? lastRsi : lastMfi;
    const threshold  = oversoldRsi ? RSI_OVERSOLD : MFI_OVERSOLD;

    const archetype = oversoldRsi ? "rsi_oversold" : "mfi_oversold";
    const spec = oversoldRsi ? buildRsiSurvivorSpec(sym) : buildMfiSurvivorSpec(sym);
    const backtest = backtestSurvivor(klines, archetype);
    // Forward-look only fires when we're evaluating a past as-of date AND have
    // future bars to walk through. Real-time evaluation has no forward bars,
    // so this stays null in normal usage.
    const forwardLook = forwardKlines.length > 0
      ? simulateForwardEntry({ asOfClose: lastClose, asOfTime: klines[i].closeTime, forwardKlines, archetype })
      : null;

    const asOfStamp = asOfDateMs != null
      ? new Date(asOfDateMs).toISOString().slice(0, 10)
      : null;

    if (smaDistancePct < ELEVATED_RISK_SMA_DISTANCE_PCT) {
      return {
        verdict: "WATCH",
        symbol:  sym,
        as_of:   asOfStamp,
        signals,
        reasoning: [
          `${oscillator}(14) = ${r2(oscValue)} confirms oversold (< ${threshold}).`,
          `Long-horizon uptrend confirmed (close ${signals.close} > SMA200 ${signals.sma200}).`,
          `BUT sma_distance ${signals.sma_distance_pct}% < ${ELEVATED_RISK_SMA_DISTANCE_PCT}% — close is in the elevated-risk regime bucket. Walk-forward regime conditioning (n=11, underpowered) showed this bucket lost -0.55% mean. Treat as elevated-risk WATCH rather than full-confidence PASS.`,
        ],
        spec,
        backtest,
        forward_look: forwardLook,
      };
    }

    return {
      verdict: "PASS",
      symbol:  sym,
      as_of:   asOfStamp,
      signals,
      reasoning: [
        `${oscillator}(14) = ${r2(oscValue)} confirms oversold (< ${threshold}).`,
        `Long-horizon uptrend confirmed (close ${signals.close} > SMA200 ${signals.sma200}).`,
        `sma_distance ${signals.sma_distance_pct}% is in the favorable regime bucket (>= ${ELEVATED_RISK_SMA_DISTANCE_PCT}%).`,
        `Setup matches the walk-forward survivor family. Audit context: rsi_oversold + SMA200 had 6/10 defensible OOS combos at 1.5% real fees, n=29 mean +0.71%, win 62%. NOT a prediction for this specific token — see honest disclosure in README.`,
      ],
      spec,
      backtest,
      forward_look: forwardLook,
    };
  }

  if (nearRsi || nearMfi) {
    return {
      verdict: "WATCH",
      symbol:  sym,
      signals,
      reasoning: [
        `RSI(14) ${signals.rsi} and MFI(14) ${signals.mfi} are below 'near' thresholds (${RSI_NEAR} / ${MFI_NEAR}) but neither below oversold (${RSI_OVERSOLD} / ${MFI_OVERSOLD}).`,
        `Long-horizon uptrend confirmed (close > SMA200).`,
        `No entry signal yet. Watch for further weakness; re-evaluate on next daily close.`,
      ],
    };
  }

  return reject(sym, "NO_OVERSOLD_SIGNAL",
    `RSI(14) ${signals.rsi}, MFI(14) ${signals.mfi}. Neither below the oversold thresholds (${RSI_OVERSOLD} / ${MFI_OVERSOLD}). The survivor family requires an oscillator-confirmed dip — no entry signal.`,
    signals);
}

function reject(symbol, code, message, signals = null) {
  return { verdict: "REJECT", symbol, code, signals, reasoning: [message] };
}

function r2(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}
