// Shared helpers for the Vercel serverless functions. Each api/*.js file is
// a discrete entry-point (Vercel routes /api/foo → api/foo.js); we keep the
// per-request logic here so the entry-points stay one-liners and the local
// Express dev server (server.js) can reuse the same handlers without
// duplication.
//
// The DOTENV_CONFIG_QUIET set here mirrors the workaround in src/index.js
// for @stratchai/strategy-spec's auto-loading nested dotenv 17.x banner.

process.env.DOTENV_CONFIG_QUIET = "true";

export function parseAsOfDate(asOfDate) {
  if (!asOfDate) return { ok: true, ms: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
  if (!m) return { ok: false, error: `Invalid asOfDate "${asOfDate}". Expected YYYY-MM-DD.` };
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  if (!Number.isFinite(ms)) return { ok: false, error: `Invalid asOfDate "${asOfDate}". Could not parse.` };
  return { ok: true, ms };
}

// Vercel parses JSON bodies automatically when content-type is application/json;
// Express needs `express.json()` middleware which server.js already wires up.
// Both code paths land here with req.body as a parsed object.
export function getBody(req) {
  return req.body || {};
}

export function methodNotAllowed(res, allowed = ["POST"]) {
  res.setHeader("Allow", allowed.join(", "));
  res.status(405).json({ error: `Method not allowed. Use ${allowed.join(" or ")}.` });
}
