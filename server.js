// Local API server. Wraps the existing CLI evaluator behind HTTP endpoints
// so the Vue web app can call them. In production this same logic moves
// to Vercel serverless functions in api/* — the JSON contracts stay
// identical so the web client doesn't change.
//
// Suppress @stratchai/strategy-spec's nested-dotenv banner before any
// import touches it. Same workaround as src/index.js.

process.env.DOTENV_CONFIG_QUIET = "true";

const dotenv = (await import("dotenv")).default;
dotenv.config({ quiet: true });

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { evaluateToken } = await import("./src/evaluator.js");
const { evaluateWatchlist } = await import("./src/watchlist.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 5174;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/api/evaluate", async (req, res) => {
  const { symbol, asOfDate } = req.body || {};
  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "Missing or invalid `symbol` in body" });
    return;
  }
  let asOfDateMs = null;
  if (asOfDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
    if (!m) {
      res.status(400).json({ error: `Invalid asOfDate "${asOfDate}". Expected YYYY-MM-DD.` });
      return;
    }
    asOfDateMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  }
  try {
    const result = await evaluateToken(symbol, { asOfDateMs });
    res.json(result);
  } catch (e) {
    console.error("[/api/evaluate]", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/watchlist", async (req, res) => {
  const { symbols, asOfDate } = req.body || {};
  if (!Array.isArray(symbols) || symbols.length === 0) {
    res.status(400).json({ error: "Missing or invalid `symbols` array in body" });
    return;
  }
  let asOfDateMs = null;
  if (asOfDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
    if (!m) {
      res.status(400).json({ error: `Invalid asOfDate "${asOfDate}". Expected YYYY-MM-DD.` });
      return;
    }
    asOfDateMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  }
  try {
    const results = await evaluateWatchlist(symbols, { asOfDateMs });
    res.json(results);
  } catch (e) {
    console.error("[/api/watchlist]", e);
    res.status(500).json({ error: e.message });
  }
});

// Static serve the built web app in production.
const distDir = path.join(__dirname, "web", "dist");
import("node:fs").then(({ existsSync }) => {
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
});

app.listen(PORT, () => {
  console.log(`[strategy-referee] API + static server listening on http://localhost:${PORT}`);
  console.log(`[strategy-referee] In dev, run \`npm run dev:web\` in another terminal for hot-reload UI on :5173`);
});
