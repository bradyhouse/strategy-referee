import { parseAsOfDate, getBody, methodNotAllowed } from "./_lib.js";
import { evaluateToken } from "../src/evaluator.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res);
  const { symbol, asOfDate } = getBody(req);
  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "Missing or invalid `symbol` in body" });
    return;
  }
  const parsed = parseAsOfDate(asOfDate);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const result = await evaluateToken(symbol, { asOfDateMs: parsed.ms });
    res.status(200).json(result);
  } catch (e) {
    console.error("[api/evaluate]", e);
    res.status(500).json({ error: e.message });
  }
}
