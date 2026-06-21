// strategy-referee — MCP skill over Streamable HTTP (deployed / remotely callable).
//
// Same skill as the stdio server (mcp/server.js), exposed as a Vercel serverless
// function at /api/mcp so an MCP client can reach it over the network:
//
//   claude mcp add --transport http strategy-referee https://<app>.vercel.app/api/mcp
//
// Stateless: serverless functions have no cross-request memory, so we build a
// fresh skill server + transport per request (sessionIdGenerator: undefined,
// no session validation) and return a single JSON response (enableJsonResponse)
// instead of a long-lived SSE stream — which fits Vercel's request/response model.

import { config } from "dotenv";
config({ quiet: true });

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildSkillServer } from "../mcp/skill.js";

export default async function handler(req, res) {
  // CORS — an MCP client may be browser-hosted; harmless for CLI clients.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const server = buildSkillServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,   // stateless — no sessions on serverless
    enableJsonResponse: true,        // single JSON response, not an SSE stream
  });

  // Tear down per-request resources when the response finishes.
  res.on("close", () => {
    try { transport.close(); } catch {}
    try { server.close(); } catch {}
  });

  try {
    await server.connect(transport);
    // req.body is pre-parsed JSON (Vercel + local express.json()).
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: `MCP handler error: ${e?.message || e}` },
        id: null,
      }));
    }
  }
}
