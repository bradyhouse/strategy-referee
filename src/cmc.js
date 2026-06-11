// CoinMarketCap Pro API client. Free-tier (Basic) endpoints only.
// See docs/cmc_api_auth.md for the full tier and endpoint reference.

const BASE = "https://pro-api.coinmarketcap.com";

function headers() {
  const key = process.env.CMC_API_KEY;
  if (!key) {
    throw new Error("CMC_API_KEY missing — set it in .env (see docs/cmc_api_auth.md)");
  }
  return {
    "X-CMC_PRO_API_KEY": key,
    "Accept": "application/json",
  };
}

async function cmcGet(path) {
  const r = await fetch(`${BASE}${path}`, { headers: headers() });
  const j = await r.json();
  if (j.status?.error_code) {
    throw new Error(`CMC ${j.status.error_code}: ${j.status.error_message}`);
  }
  return j.data;
}

export function listLatest({ limit = 50, sort = "market_cap" } = {}) {
  return cmcGet(`/v1/cryptocurrency/listings/latest?limit=${limit}&sort=${sort}`);
}

export function quotesLatest(symbols) {
  const list = Array.isArray(symbols) ? symbols.join(",") : symbols;
  return cmcGet(`/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(list)}`);
}

export function tokenInfo(symbols) {
  const list = Array.isArray(symbols) ? symbols.join(",") : symbols;
  return cmcGet(`/v1/cryptocurrency/info?symbol=${encodeURIComponent(list)}`);
}

export function keyInfo() {
  return cmcGet("/v1/key/info");
}
