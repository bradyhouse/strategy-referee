// Watchlist mode: scan N tokens with a single batched CMC call + parallel
// Kraken fetches. Returns array of per-token results, sorted with PASS at
// the top, then oversold-WATCH, near-WATCH, REJECT, then data-shape failures.
//
// Rate-limit footprint: 1 CMC call total (quotes/latest accepts comma-list)
// + N Kraken calls in parallel (no public rate-limit pressure at watchlist
// scope). Free-tier CMC quota easily sustains hundreds of scans per day.

import { quotesLatest } from "./cmc.js";
import { evaluateTokenWithQuote } from "./evaluator.js";

export async function evaluateWatchlist(symbols, opts = {}) {
  const symList = symbols.map(s => s.toUpperCase().trim()).filter(Boolean);
  if (symList.length === 0) {
    throw new Error("Watchlist is empty");
  }

  let quoteMap = {};
  try {
    quoteMap = await quotesLatest(symList);
  } catch (e) {
    // Non-fatal: every per-token evaluation will report TOKEN_NOT_FOUND_ON_CMC
    // since the batched lookup failed. Surface the original error via the
    // result rows so the demo can show "CMC down? still produces structured
    // output" instead of crashing.
    return symList.map(sym => ({
      verdict: "REJECT",
      symbol:  sym,
      code:    "CMC_LOOKUP_FAILED",
      reasoning: [`Batched CMC quote lookup failed: ${e.message}`],
    }));
  }

  const results = await Promise.all(symList.map(sym =>
    evaluateTokenWithQuote(sym, quoteMap[sym] ?? null, opts)
  ));

  return rankResults(results);
}

// Rank for display: PASS > oversold-WATCH > near-WATCH > REJECT (clean) >
// REJECT (data-shape failure). Within each rank, the more "active" signal
// (lower RSI or MFI on an oversold) bubbles up.
function rankResults(results) {
  const order = (r) => {
    if (r.verdict === "PASS") return 0;
    if (r.verdict === "WATCH" && r.spec) return 1; // oversold-WATCH (has spec)
    if (r.verdict === "WATCH") return 2;            // near-WATCH (no spec)
    if (r.verdict === "REJECT" && r.signals) return 3; // clean REJECT
    return 4;                                        // data-shape failure
  };
  return results.slice().sort((a, b) => {
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    // Within the same bucket, sort by RSI ascending (more oversold first)
    const ra = a.signals?.rsi ?? Infinity;
    const rb = b.signals?.rsi ?? Infinity;
    return ra - rb;
  });
}
