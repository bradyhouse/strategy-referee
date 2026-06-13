// /api/universe — return the current top-N tokens by market cap from
// CoinMarketCap Pro (free tier /cryptocurrency/listings/latest).
//
// Used by the watchlist UI to populate a "CMC top 30 today" preset that's
// curated by CMC rather than hardcoded by us. Demonstrates real CMC data
// usage for the BNB HACK "Best CMC Data Use" prize angle.
//
// Cached in-process for 5 minutes — the universe doesn't shift that
// quickly and we don't want to burn the free-tier 10K monthly credit
// budget on rapid refreshes during demos. First request after server
// restart hits CMC; subsequent requests within the TTL serve from cache.

import { listLatest } from "../src/cmc.js";
import { methodNotAllowed } from "./_lib.js";

const TTL_MS = 5 * 60_000;
let _cache = { at: 0, limit: null, data: null };

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit || "30", 10)));

  try {
    const now = Date.now();
    if (_cache.data && _cache.limit === limit && now - _cache.at < TTL_MS) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json({ source: "cache", limit, ttl_remaining_ms: TTL_MS - (now - _cache.at), data: _cache.data });
      return;
    }

    const raw = await listLatest({ limit });
    // Reshape CMC's listing payload to what the UI needs: symbol + name +
    // rank + market_cap + 24h price change. Strip the bulky platform/tags
    // arrays — those belong on the per-token info endpoint, not the universe
    // listing.
    const data = raw.map(t => ({
      symbol:                 t.symbol,
      name:                   t.name,
      cmc_rank:               t.cmc_rank,
      market_cap:             t.quote?.USD?.market_cap ?? null,
      price:                  t.quote?.USD?.price ?? null,
      percent_change_24h:     t.quote?.USD?.percent_change_24h ?? null,
    }));

    _cache = { at: now, limit, data };
    res.setHeader("X-Cache", "MISS");
    res.status(200).json({ source: "cmc", limit, ttl_remaining_ms: TTL_MS, data });
  } catch (e) {
    console.error("[api/universe]", e);
    res.status(500).json({ error: e.message });
  }
}
