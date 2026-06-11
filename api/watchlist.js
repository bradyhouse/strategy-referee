import { parseAsOfDate, getBody, methodNotAllowed } from "./_lib.js";
import { evaluateWatchlist } from "../src/watchlist.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res);
  const { symbols, asOfDate } = getBody(req);
  if (!Array.isArray(symbols) || symbols.length === 0) {
    res.status(400).json({ error: "Missing or invalid `symbols` array in body" });
    return;
  }
  const parsed = parseAsOfDate(asOfDate);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const results = await evaluateWatchlist(symbols, { asOfDateMs: parsed.ms });
    res.status(200).json(results);
  } catch (e) {
    console.error("[api/watchlist]", e);
    res.status(500).json({ error: e.message });
  }
}
