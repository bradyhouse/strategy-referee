# Deploy to Vercel

Strategy-referee is structured for zero-config Vercel deployment:

- Static UI (`web/`) builds via Vite to `web/dist/`
- API endpoints (`api/*.js`) run as serverless functions on the edge
- `vercel.json` declares the build + function config
- `server.js` (the local dev server) and the Vercel functions share the same per-request handlers in `api/*.js` — there's no duplicated logic

## Prerequisites

- A free Vercel account at [vercel.com/signup](https://vercel.com/signup)
- Your CoinMarketCap API key (free tier — see [`cmc_api_auth.md`](cmc_api_auth.md))

## Option A — Connect the GitHub repo via the Vercel UI (recommended)

1. Open [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Pick `bradyhouse/strategy-referee`
3. **Framework Preset:** leave as `Other` (Vercel will read `vercel.json`)
4. **Build & Output Settings:** leave defaults (overridden by `vercel.json`)
5. **Environment Variables:**
   - Add `CMC_API_KEY` = (your free-tier CMC Pro key)
   - Apply to: **Production + Preview + Development**
6. Click **Deploy**

The first deploy takes ~90 seconds (npm install + Vite build + function bundle). Subsequent deploys (on every `git push` to `main`) take ~30 seconds because most of `node_modules/` cache hits.

You'll get a URL like `https://strategy-referee.vercel.app` (or `strategy-referee-<hash>.vercel.app` for previews on PRs). The web UI lives at `/`; the API endpoints at `/api/evaluate`, `/api/watchlist`, `/api/health`; and the **remotely-callable MCP skill at `/api/mcp`** (Streamable HTTP — register with `claude mcp add --transport http strategy-referee <URL>/api/mcp`; see the README's "Use as an AI Agent Skill" section).

## Option B — Vercel CLI from your machine

```bash
npm install -g vercel
cd /path/to/strategy-referee
vercel login                           # one-time auth
vercel link                            # one-time, pairs the local repo to a Vercel project
vercel env add CMC_API_KEY production  # paste the key when prompted
vercel env add CMC_API_KEY preview     # so PR previews work too
vercel deploy --prod                   # actual production deploy
```

CLI deploys are ad-hoc. The Option A "connect the repo" flow is what you want for ongoing development — every `git push origin main` becomes a fresh production deploy automatically.

## Verifying the deploy

After it's live, hit these in order:

```bash
# Replace with your real URL
URL=https://strategy-referee.vercel.app

curl "$URL/api/health"
# → {"ok":true,"time":"..."}

curl -X POST "$URL/api/evaluate" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTC"}'
# → REJECT/BELOW_SMA200 (in current market)

curl -X POST "$URL/api/evaluate" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ETH","asOfDate":"2025-09-25"}'
# → PASS with forward_look showing +10.83% net exit
```

Then open the URL in a browser to verify the Vue UI loads and the demo flow works (Single token mode → "ETH · 2025-09-25" preset → see PASS card with forward-look + backtest + spec download button).

## Limits to be aware of

- **Hobby tier function timeout:** 10s per invocation. Our handlers typically complete in ~500ms (CMC + Kraken + indicator computation), well within the budget. The CMC free tier rate limit (50 req/min) is much more likely to bite first if a demo storm hits the URL.
- **Hobby tier monthly bandwidth:** 100GB. The web bundle is 31KB gzipped, so even 3M+ judges hitting the URL won't get you close.
- **Cold starts:** ~1.5s first invocation. Subsequent invocations within the same warm window are sub-100ms. For a hackathon demo this is fine; the first judge hit warms it.

## Custom domain (optional)

Vercel gives you a `*.vercel.app` URL automatically. To use a custom domain (e.g., `strategy-referee.yourdomain.com`):

1. **Project Settings → Domains → Add Domain**
2. Configure your DNS to point at Vercel (CNAME or A record per the dashboard's instructions)
3. Vercel auto-provisions a Let's Encrypt cert

Not necessary for the hackathon submission — the `vercel.app` URL is fine for judges.

## Troubleshooting

- **"Function execution failed" + 500 errors with no body:** check the function logs in Vercel's dashboard. Usually missing `CMC_API_KEY` env var.
- **`Cannot find module '@stratchai/strategy-spec'` during build:** make sure `installCommand: "npm install --legacy-peer-deps"` is set in `vercel.json` (it is by default). Without `--legacy-peer-deps`, the stale strategy-spec peer-dep on `@stratchai/indicators@^0.2.1` causes install to fail.
- **CORS errors from the browser:** all API routes are same-origin in production (the UI is served from the same Vercel project), so this shouldn't occur. If it does, check that `vercel.json` isn't overriding the default rewrites.

## Removing the deploy

Either:
- **From the Vercel dashboard:** Project Settings → Advanced → Delete Project
- **From the CLI:** `vercel remove strategy-referee`

Deleting the project removes the deployment URL but leaves your repo / env vars / source code untouched.
