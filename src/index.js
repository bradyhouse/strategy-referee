// strategy-referee CLI entry.
//
// Usage:
//   node src/index.js --token BTC
//   node src/index.js --token ETH --json

import "dotenv/config";
import { evaluateToken } from "./evaluator.js";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.token) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const result = await evaluateToken(args.token);

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printPretty(result);
}

process.exit(result.verdict === "REJECT" ? 2 : 0);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--token") out.token = argv[++i];
  }
  return out;
}

function printHelp() {
  console.log("strategy-referee — anti-hype crypto strategy evaluator");
  console.log("");
  console.log("Usage:");
  console.log("  node src/index.js --token <SYMBOL>");
  console.log("");
  console.log("Flags:");
  console.log("  --token <SYMBOL>   Token to evaluate (required)");
  console.log("  --json             Emit raw JSON instead of pretty output");
  console.log("  --help, -h         Show this help");
  console.log("");
  console.log("Exit codes: 0=PASS/WATCH, 2=REJECT");
}

function printPretty(r) {
  const label = { PASS: "[PASS]", WATCH: "[WATCH]", REJECT: "[REJECT]" }[r.verdict] || `[${r.verdict}]`;
  console.log("");
  console.log(`${label}  ${r.symbol}${r.code ? "  (" + r.code + ")" : ""}`);
  console.log("-".repeat(60));
  if (r.signals) {
    console.log(`  Close              ${r.signals.close}`);
    console.log(`  RSI(14)            ${r.signals.rsi}`);
    console.log(`  MFI(14)            ${r.signals.mfi}`);
    console.log(`  SMA(200)           ${r.signals.sma200}`);
    console.log(`  Close vs SMA200    ${r.signals.sma_distance_pct}%`);
    if (r.signals.cmc_rank) {
      console.log(`  CMC market rank    #${r.signals.cmc_rank}`);
    }
    if (r.signals.cmc_volume_24h_usd) {
      console.log(`  24h volume (USD)   $${formatLargeNumber(r.signals.cmc_volume_24h_usd)}`);
    }
    console.log(`  Bars used          ${r.signals.bars_used}`);
    console.log(`  Last bar           ${r.signals.last_bar_close_time}`);
  }
  console.log("");
  console.log("Reasoning:");
  for (const line of r.reasoning) {
    console.log(`  - ${line}`);
  }
  console.log("");
}

function formatLargeNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(n);
}
