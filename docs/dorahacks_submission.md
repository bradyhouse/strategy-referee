# DoraHacks submission — strategy-referee (BNB HACK 2026)

> Live demo:  https://strategy-referee.vercel.app/
> MCP skill:  https://strategy-referee.vercel.app/api/mcp   (remotely callable, verified)
> GitHub:     https://github.com/bradyhouse/strategy-referee   (public)

---

## Field-by-field

### Project name

```
strategy-referee
```

### Tagline (~140 chars)

```
An MCP agent skill that turns CoinMarketCap data into a backtestable strategy spec — PASS / WATCH / REJECT against a walk-forward-validated family. Rejects most, by design.
```

### Tracks

- **Track 2 — Strategy Skills** (primary)
- **Best CMC Data & Signal Use** (special prize)

### Short description (~280 chars)

```
An agent-invokable MCP skill (local + deployed over HTTP) that evaluates a token against a narrow walk-forward survivor family (rsi/mfi-oversold + SMA200, distilled from a 21-archetype audit at 1.5% real fees) and emits a backtestable @stratchai/strategy-spec. Most tokens REJECT — it won't fabricate signals.
```

### Details (the main body field — renders Markdown)

**See [dorahacks_details.md](dorahacks_details.md)**


### Demo URL

```
https://strategy-referee.vercel.app/
```

### Deployed MCP skill endpoint (mention prominently — it's the Track-2 deliverable)

```
https://strategy-referee.vercel.app/api/mcp
Register:  claude mcp add --transport http strategy-referee https://strategy-referee.vercel.app/api/mcp
```

### GitHub URL

```
https://github.com/bradyhouse/strategy-referee
```

### Team

- Brady House — solo build
- Telegram - @bradylhouse
- Email - bradyhouse@gmail.com


### Tech keywords

```
MCP, model context protocol, AI agent skill, CMC skill, CoinMarketCap, crypto, strategy, walk-forward-validated, anti-hype, backtestable spec, mean-reversion, RSI, MFI, SMA200, @stratchai, Vue 3, Vercel
```

---

## Pre-submit checklist

- [x] Vercel deploy live — root 200, /api/evaluate returns PASS+spec, /api/mcp verified green
- [x] GitHub repo public
- [x] Deployed MCP skill verified remotely (npm run skill:test:http -- .../api/mcp → ALL GREEN)
- [x] Evidence docs accessible in the repo: docs/methodology.md, docs/cmc_evidence_table.md, docs/cmc_universe_verification.md, docs/cmc_api_auth.md
- [x] No private-repo references or secrets in public source/history
- [x] License MIT, explicit in LICENSE
- [x] Details body fact-reconciled vs repo; demo + docs corrected to match the 90-day scan artifact (commit 390711a)
- [x] **Redeploy on Vercel** so the corrected PASS-disclosure text is live (push 390711a triggers auto-deploy if GitHub-connected)
- [x] Logo uploaded to the BUIDL (web/public/logo.png)
- [ ] (optional) short demo video recorded + linked
- [ ] Submit on DoraHacks before the lock
