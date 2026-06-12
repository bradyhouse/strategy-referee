#!/usr/bin/env node
// find_current_pass.js — scan the Kraken top-30 (UNIVERSE list from
// verify_cmc_universe.js) at successive as-of dates, walking backwards
// from today, until we find tokens that match the survivor-family gate.
//
// FAST PATH: fetch each symbol's Kraken klines ONCE (one HTTP per symbol,
// not per symbol-date pair) and slice in-memory by as-of date. Reuse the
// indicator computations across dates. The naive per-date evaluator
// hit Kraken for every (sym, date) pair which made the scan slow enough
// that a 60-day window took longer than the user's patience.
//
// Skips CMC lookup — quotesLatest is only used to populate cmc_rank /
// cmc_volume_24h_usd for display. The verdict math needs only Kraken
// OHLCV, so we fake the quote with a stub.
//
// Output: data/current_pass_scan_<YYYY-MM-DD>.json with the hits.
//
// Usage:
//   node scripts/find_current_pass.js                # scan back 30 days, find 3
//   node scripts/find_current_pass.js --days 90 --target 5

import { config } from "dotenv";
config({ quiet: true });

import {
  calcRSISeries,
  calcMFISeries,
  calcSMASeries,
} from "@stratchai/indicators";
import { fetchDailyKlines } from "../src/ohlcv.js";
import fs from "fs";
import path from "path";

const UNIVERSE = [
  "BTC", "ETH", "BNB", "XRP", "SOL", "ADA", "DOGE", "AVAX", "DOT", "LINK",
  "LTC", "BCH", "NEAR", "ATOM", "UNI", "XLM", "ETC", "FIL", "ALGO", "APT",
  "ARB", "OP", "INJ", "SUI", "AAVE", "MKR", "GRT", "RUNE", "TON", "ICP",
];

const RSI_OVERSOLD = 32;
const MFI_OVERSOLD = 20;
const MIN_BARS     = 250;
const ELEVATED_RISK_SMA_DISTANCE_PCT = 5;

const args = process.argv.slice(2);
let maxDays = 30, targetHits = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--days") maxDays = parseInt(args[++i], 10);
  else if (args[i] === "--target") targetHits = parseInt(args[++i], 10);
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }
function r2(v) { return v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100; }

(async () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  today.setUTCDate(today.getUTCDate() - 2);   // T-2 to skip the in-progress bar

  console.log(`Scanning ${UNIVERSE.length} tokens, walking back from ${fmtDate(today)} up to ${maxDays} days, target ${targetHits} PASSes`);
  console.log(`Fetching Kraken klines for ${UNIVERSE.length} symbols (one-shot)...`);

  // Fetch + precompute indicator series ONCE per symbol.
  const cache = {};
  for (const sym of UNIVERSE) {
    try {
      const klines = await fetchDailyKlines(sym, 720);
      if (klines.length < MIN_BARS) { console.log(`  ${sym}: skip (${klines.length} bars, need ${MIN_BARS})`); continue; }
      const closes  = klines.map(k => k.close);
      const highs   = klines.map(k => k.high);
      const lows    = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);
      cache[sym] = {
        klines,
        rsiSeries: calcRSISeries(closes, 14),
        mfiSeries: calcMFISeries(highs, lows, closes, volumes, 14),
        smaSeries: calcSMASeries(closes, 200),
      };
      process.stdout.write(`  ${sym}: ${klines.length} bars  `);
    } catch (e) {
      console.log(`  ${sym}: FAILED (${e.message?.slice(0, 60)})`);
    }
  }
  console.log("\n\nScanning by as-of date:");

  const hits = [];
  for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
    const asOf = new Date(today);
    asOf.setUTCDate(asOf.getUTCDate() - dayOffset);
    // Use END-of-day for asOfMs so the bar whose closeTime is YYYY-MM-DD
    // 23:59:59 is included — that's the bar that closes ON the named date.
    // The UI's api/_lib.js parseAsOfDate does the same. The start-of-day
    // version was off by one: "BCH @ 2026-01-28" was actually evaluating
    // the 2026-01-27 close because the 01-28 bar's closeTime was > asOf.
    const asOfMs = asOf.getTime() + 86399999;
    const asOfStr = fmtDate(asOf);
    let dayHits = 0;

    for (const sym of UNIVERSE) {
      const c = cache[sym];
      if (!c) continue;
      // Find the last bar index whose closeTime is <= asOfMs (the as-of close)
      const i = (() => {
        for (let j = c.klines.length - 1; j >= 0; j--) {
          if (c.klines[j].closeTime <= asOfMs) return j;
        }
        return -1;
      })();
      if (i < MIN_BARS - 1) continue;   // not enough history at this date

      const close = c.klines[i].close;
      const sma   = c.smaSeries[i];
      const rsi   = c.rsiSeries[i];
      const mfi   = c.mfiSeries[i]?.value ?? null;
      if (sma == null || rsi == null) continue;
      // Gate 1: uptrend
      if (close <= sma) continue;
      // Gate 2: oversold
      const oversoldRsi = rsi < RSI_OVERSOLD;
      const oversoldMfi = mfi != null && mfi < MFI_OVERSOLD;
      if (!oversoldRsi && !oversoldMfi) continue;
      // Gate 3: favorable regime
      const smaDistancePct = ((close - sma) / sma) * 100;
      const verdict = smaDistancePct >= ELEVATED_RISK_SMA_DISTANCE_PCT ? "PASS" : "WATCH (elevated)";

      if (verdict === "PASS") {
        const archetype = oversoldRsi ? "rsi_oversold" : "mfi_oversold";
        console.log(`  ✓ PASS: ${sym} @ ${asOfStr}  RSI=${r2(rsi)}  MFI=${r2(mfi)}  SMA200=${r2(sma)}  Δ=${r2(smaDistancePct)}%  via ${archetype}`);
        hits.push({
          symbol: sym, asOfDate: asOfStr, archetype,
          signals: { close: r2(close), rsi: r2(rsi), mfi: r2(mfi), sma200: r2(sma), sma_distance_pct: r2(smaDistancePct), bars_used: i + 1 },
        });
        dayHits++;
        if (hits.length >= targetHits) break;
      }
    }
    if (hits.length >= targetHits) break;
    if (dayHits === 0 && dayOffset % 7 === 0) console.log(`  ${asOfStr}: 0 PASSes`);
  }

  console.log(`\n=== ${hits.length} total PASS(es) ===`);
  if (hits.length === 0) {
    console.log("  No PASSes found in the scan window. Possibilities:");
    console.log("    - Sustained downtrend (most tokens below SMA200) — likely given current market");
    console.log("    - Window too narrow — try --days 120");
    console.log("    - Universe too narrow — broaden UNIVERSE list");
    process.exit(1);
  }
  const outPath = path.join("data", `current_pass_scan_${fmtDate(new Date())}.json`);
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ scanned_at: new Date().toISOString(), universe_size: UNIVERSE.length, days_scanned: Math.min(maxDays, hits.length ? maxDays : maxDays), hits }, null, 2));
  console.log(`\nWrote ${outPath}`);
})();
