#!/usr/bin/env node
// Smoke test for the MCP skill over Streamable HTTP — works against a LOCAL
// server or the DEPLOYED Vercel URL. Verifies the remotely-callable skill.
//
//   node scripts/skill_http_smoke.mjs                                  # default: http://localhost:5174/api/mcp
//   node scripts/skill_http_smoke.mjs https://<app>.vercel.app/api/mcp # verify the live deploy
//
// (Local default needs `node server.js` running with CMC_API_KEY in .env.)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] || "http://localhost:5174/api/mcp";
console.log(`Target: ${url}`);
const client = new Client({ name: "http-smoke", version: "0.0.0" });
let fails = 0;
const ck = (l, c) => { console.log(`  ${c ? "✓" : "✗"} ${l}`); if (!c) fails++; };

await client.connect(new StreamableHTTPClientTransport(new URL(url)));
console.log("connected (MCP initialize handshake OK)");
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
ck("evaluate_token + evaluate_watchlist listed", tools.length >= 2);

const r = await client.callTool({ name: "evaluate_token", arguments: { symbol: "ETH", as_of_date: "2025-09-28" } });
console.log("evaluate_token ETH@2025-09-28 →", r.content?.[0]?.text?.split("\n")[0]);
const obj = JSON.parse(r.content?.[1]?.text ?? "{}");
ck("verdict = PASS", obj.verdict === "PASS");
ck("backtestable spec returned", !!obj.spec?.entry_rules);

await client.close();
console.log(fails === 0 ? "\nALL GREEN ✓" : `\n${fails} FAILED ✗`);
process.exit(fails ? 1 : 0);
