// Shared skill definition — the tools that make strategy-referee an
// agent-invokable CMC Skill. Used by BOTH transports so they're identical:
//   - mcp/server.js  → stdio (local: `npm run skill`, `claude mcp add ... --`)
//   - api/mcp.js      → Streamable HTTP (deployed: remotely callable on Vercel)
//
// It generates a backtestable @stratchai/strategy-spec from CoinMarketCap data;
// it does NOT execute trades or sign transactions (quant-research referee, not
// a live agent).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { evaluateToken } from "../src/evaluator.js";
import { evaluateWatchlist } from "../src/watchlist.js";
import { parseAsOfDate } from "../api/_lib.js";

// The chart payload (full candle array + SMA series) is for the web UI's
// renderer — noise for an agent. Strip it so responses stay decision-ready.
function trim(result) {
  if (!result || typeof result !== "object") return result;
  const { chart, ...rest } = result;
  if (chart?.candles) rest.chart_bars = chart.candles.length;
  return rest;
}

function oneLine(r) {
  const v = r.verdict ?? "?";
  const why = Array.isArray(r.reasoning) ? r.reasoning[0] : (r.reasoning || r.code || "");
  const spec = r.spec?.archetype ? `  spec: ${r.spec.archetype}` : "";
  return `${v} — ${r.symbol ?? ""}${spec}\n${why}`;
}

const AS_OF = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .optional()
  .describe(
    "Optional as-of date (YYYY-MM-DD). When set, evaluates using only bars up to " +
    "that date and includes a forward-look of what the trade would have done. " +
    "Omit for a live, current evaluation.",
  );

// Build a fully-configured skill server. Call once per stdio process, or once
// per HTTP request in the stateless serverless transport.
export function buildSkillServer() {
  const server = new McpServer(
    { name: "strategy-referee", version: "0.1.0" },
    {
      instructions:
        "Anti-hype crypto strategy skill. Evaluates a token against a narrow, " +
        "walk-forward-validated mean-reversion family (rsi_oversold / mfi_oversold " +
        "+ SMA200) distilled from a 21-archetype audit at 1.5% real fees. Returns " +
        "PASS / WATCH / REJECT with reasoning; on PASS/WATCH it emits a backtestable " +
        "@stratchai/strategy-spec. It does not execute trades. Most tokens REJECT — " +
        "that is by design; it refuses to fabricate signals.",
    },
  );

  server.registerTool(
    "evaluate_token",
    {
      title: "Evaluate a token",
      description:
        "Evaluate one token against the walk-forward survivor family. Returns a " +
        "PASS / WATCH / REJECT verdict, plain-language reasoning, the gate checklist, " +
        "and — on PASS/WATCH — a backtestable @stratchai/strategy-spec. Not a buy " +
        "signal and not trade execution; a structural-match referee.",
      inputSchema: {
        symbol: z.string().min(1).describe("Token ticker, e.g. BTC, ETH, SOL."),
        as_of_date: AS_OF,
      },
    },
    async ({ symbol, as_of_date }) => {
      const parsed = parseAsOfDate(as_of_date ?? null);
      if (!parsed.ok) {
        return { isError: true, content: [{ type: "text", text: parsed.error }] };
      }
      try {
        const out = trim(await evaluateToken(symbol, { asOfDateMs: parsed.ms }));
        return {
          content: [
            { type: "text", text: oneLine(out) },
            { type: "text", text: JSON.stringify(out, null, 2) },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `evaluate_token failed: ${e.message}` }] };
      }
    },
  );

  server.registerTool(
    "evaluate_watchlist",
    {
      title: "Evaluate a watchlist",
      description:
        "Evaluate several tokens at once against the survivor family. Returns one " +
        "verdict per symbol (PASS / WATCH / REJECT + reasoning + spec on PASS/WATCH). " +
        "Useful for scanning a universe; expect most to REJECT.",
      inputSchema: {
        symbols: z.array(z.string().min(1)).min(1).max(30).describe("Token tickers, e.g. [\"BTC\",\"ETH\",\"SOL\"]."),
        as_of_date: AS_OF,
      },
    },
    async ({ symbols, as_of_date }) => {
      const parsed = parseAsOfDate(as_of_date ?? null);
      if (!parsed.ok) {
        return { isError: true, content: [{ type: "text", text: parsed.error }] };
      }
      try {
        const results = await evaluateWatchlist(symbols, { asOfDateMs: parsed.ms });
        const trimmed = (results || []).map(trim);
        const tally = trimmed.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
        const summary = `Scanned ${trimmed.length}: ` +
          Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ");
        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: JSON.stringify(trimmed, null, 2) },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `evaluate_watchlist failed: ${e.message}` }] };
      }
    },
  );

  return server;
}
