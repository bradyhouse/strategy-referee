#!/usr/bin/env node
// Local smoke test for the MCP skill (mcp/server.js).
//
// Spawns the skill over stdio with a real MCP client, lists the tools, and
// exercises evaluate_token + evaluate_watchlist (PASS, live REJECT, validation
// error). Prints a readable report and exits non-zero on failure.
//
//   npm run skill:test
//
// Requires a CMC_API_KEY in .env (the server self-loads it via dotenv).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["mcp/server.js"] });
const client = new Client({ name: "skill-smoke", version: "0.0.0" });

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};

await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\nTools: ${tools.map((t) => t.name).join(", ")}`);
check("evaluate_token registered", tools.some((t) => t.name === "evaluate_token"));
check("evaluate_watchlist registered", tools.some((t) => t.name === "evaluate_watchlist"));

async function callJson(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const summary = r.content?.[0]?.text?.split("\n")[0] ?? "";
  let obj = null;
  try { obj = JSON.parse(r.content?.[1]?.text ?? "null"); } catch {}
  return { r, summary, obj };
}

console.log("\nevaluate_token ETH @ 2025-09-28 (expect PASS + spec):");
{
  const { summary, obj } = await callJson("evaluate_token", { symbol: "ETH", as_of_date: "2025-09-28" });
  console.log(`    ${summary}`);
  check("verdict = PASS", obj?.verdict === "PASS");
  check("emits a backtestable spec", !!obj?.spec?.entry_rules);
  check("includes forward_look", !!obj?.forward_look);
  check("chart payload stripped (agent-compact)", obj && !("chart" in obj));
}

console.log("\nevaluate_token BTC (live, expect a clean verdict):");
{
  const { summary, obj } = await callJson("evaluate_token", { symbol: "BTC" });
  console.log(`    ${summary}`);
  check("returns a verdict", ["PASS", "WATCH", "REJECT"].includes(obj?.verdict));
}

console.log("\nevaluate_token bad date (expect validation error):");
{
  // SDK returns an isError result (not a throw) for input-schema validation failures.
  let isError = false;
  try {
    const r = await client.callTool({ name: "evaluate_token", arguments: { symbol: "ETH", as_of_date: "nope" } });
    isError = r?.isError === true;
  } catch {
    isError = true;  // some clients surface it as a throw — also acceptable
  }
  check("schema rejects malformed as_of_date", isError);
}

console.log("\nevaluate_watchlist [BTC,ETH,SOL] @ 2025-09-26:");
{
  const { summary, obj } = await callJson("evaluate_watchlist", { symbols: ["BTC", "ETH", "SOL"], as_of_date: "2025-09-26" });
  console.log(`    ${summary}`);
  check("returns one verdict per symbol", Array.isArray(obj) && obj.length === 3);
}

await client.close();

console.log(`\n${failures === 0 ? "ALL GREEN ✓" : `${failures} CHECK(S) FAILED ✗`}`);
process.exit(failures === 0 ? 0 : 1);
