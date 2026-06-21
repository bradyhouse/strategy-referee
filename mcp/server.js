#!/usr/bin/env node
// strategy-referee — MCP skill over STDIO (local).
//
// The agent-invokable skill for BNB HACK Track 2. An MCP client (Claude
// Desktop / Claude Code) spawns this as a subprocess and calls its tools —
// `evaluate_token`, `evaluate_watchlist` — to get a PASS/WATCH/REJECT verdict
// and, on PASS, a backtestable @stratchai/strategy-spec. Generates a spec from
// CMC data; does NOT execute trades.
//
// Tool definitions live in ./skill.js (shared with the deployed HTTP transport
// in api/mcp.js). The web app (web/) is a demo UI over the SAME evaluator core.
//
//   npm run skill            # run on stdio
//   npm run skill:test       # end-to-end smoke test
//   claude mcp add strategy-referee -e CMC_API_KEY=... -- node mcp/server.js

import { config } from "dotenv";
config({ quiet: true });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildSkillServer } from "./skill.js";

const server = buildSkillServer();
await server.connect(new StdioServerTransport());
// stderr only — stdout is the MCP channel and must stay clean.
console.error("[strategy-referee] MCP skill server ready on stdio (tools: evaluate_token, evaluate_watchlist)");
