// Local API + static server. In dev/local, this runs the same per-request
// handlers Vercel runs as serverless functions in production. The
// (req, res) signature is identical between Express and Vercel, so
// api/*.js exports are usable directly here as Express handlers.

process.env.DOTENV_CONFIG_QUIET = "true";

const dotenv = (await import("dotenv")).default;
dotenv.config({ quiet: true });

import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const evaluateHandler  = (await import("./api/evaluate.js")).default;
const watchlistHandler = (await import("./api/watchlist.js")).default;
const healthHandler    = (await import("./api/health.js")).default;
const universeHandler  = (await import("./api/universe.js")).default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 5174;

app.use(cors());
app.use(express.json());

app.get("/api/health",      healthHandler);
app.get("/api/universe",    universeHandler);
app.post("/api/evaluate",   evaluateHandler);
app.post("/api/watchlist",  watchlistHandler);

const distDir = path.join(__dirname, "web", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[strategy-referee] API + static server listening on http://localhost:${PORT}`);
  console.log(`[strategy-referee] In dev, run \`npm run dev:web\` in another terminal for hot-reload UI on :5173`);
});
