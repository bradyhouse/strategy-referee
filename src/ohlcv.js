// Historical OHLCV client (Kraken public API). Free, no auth, US-accessible.
//
// Chosen over:
//   - Binance.com (HTTP 451 from US IPs — geo-blocked)
//   - CryptoCompare (recently moved free tier behind an API key after the
//     CoinDesk acquisition)
//   - Binance.US (~3x smaller token universe)
//   - Coinbase Exchange (300-candle hard cap, too tight for SMA200)
//   - CoinGecko (free OHLC endpoint returns no volume, breaking MFI)
//
// Endpoint: GET /0/public/OHLC?pair=<PAIR>&interval=1440
// Returns up to 720 daily bars per call. Format per bar:
//   [time_sec, open, high, low, close, vwap, volume, trade_count]
//
// See docs/cmc_api_auth.md §4 for the architecture rationale.

const BASE = "https://api.kraken.com";

// Kraken still uses XBT (the ISO 4217 code) instead of BTC for Bitcoin in
// some pair-naming contexts. The public OHLC endpoint accepts either; we
// normalize to XBT for stability across pair-key lookups.
function resolvePairCode(symbol) {
  const s = symbol.toUpperCase();
  if (s === "BTC") return "XBTUSD";
  return `${s}USD`;
}

export async function fetchDailyKlines(symbol, limit = 720) {
  const pair = resolvePairCode(symbol);
  const url = `${BASE}/0/public/OHLC?pair=${pair}&interval=1440`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Kraken HTTP ${r.status}: ${await r.text()}`);
  }
  const j = await r.json();
  if (j.error?.length) {
    const msg = j.error.join("; ");
    if (/Unknown asset pair/i.test(msg)) {
      const err = new Error(`Kraken has no daily history for ${symbol} (${pair}): ${msg}`);
      err.code = "NO_OHLCV_HISTORY";
      throw err;
    }
    throw new Error(`Kraken: ${msg}`);
  }
  // The response key for the pair is not always identical to the request
  // (e.g. XBTUSD → XXBTZUSD). Pick the only data key that isn't "last".
  const resultKeys = Object.keys(j.result || {}).filter(k => k !== "last");
  if (!resultKeys.length) {
    const err = new Error(`Kraken returned no data for ${symbol} (${pair})`);
    err.code = "NO_OHLCV_HISTORY";
    throw err;
  }
  const rows = j.result[resultKeys[0]];

  // Take the most recent `limit` bars. Kraken returns oldest-first.
  const recent = rows.slice(-limit);

  return recent.map(b => ({
    openTime:  b[0] * 1000,
    closeTime: b[0] * 1000 + 86400000 - 1,
    open:      Number(b[1]),
    high:      Number(b[2]),
    low:       Number(b[3]),
    close:     Number(b[4]),
    volume:    Number(b[6]),
  }));
}
