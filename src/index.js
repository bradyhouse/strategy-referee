// strategy-referee CLI entry.
//
// Usage:
//   node src/index.js --token BTC
//   node src/index.js --token ETH --json

// Upstream bug workaround: @stratchai/strategy-spec/src/generator.js calls
// `require("dotenv").config()` at module import time using its own nested
// dotenv 17.x — and dotenv 17 prints a "tip" banner to stdout that breaks
// downstream JSON parsing. Setting DOTENV_CONFIG_QUIET=true BEFORE the
// strategy-spec import chain runs suppresses the banner. We have to set it
// before any other import (static imports get hoisted), then use a dynamic
// import for the rest of the app.
process.env.DOTENV_CONFIG_QUIET = "true";

const dotenv = (await import("dotenv")).default;
dotenv.config({ quiet: true });
const { evaluateToken } = await import("./evaluator.js");

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.token) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const result = await evaluateToken(args.token);

if (args.emitSpec) {
  if (!result.spec) {
    console.error(`No spec emitted — verdict was ${result.verdict}. Specs are only attached to PASS or oversold-confirmed WATCH verdicts.`);
    process.exit(3);
  }
  console.log(JSON.stringify(result.spec, null, 2));
} else if (args.json) {
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
    else if (a === "--emit-spec") out.emitSpec = true;
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
  console.log("  --json             Emit full result as JSON (verdict + signals + reasoning + spec)");
  console.log("  --emit-spec        Print only the strategy-spec JSON (PASS / oversold-WATCH only)");
  console.log("  --help, -h         Show this help");
  console.log("");
  console.log("Exit codes: 0=PASS/WATCH, 2=REJECT, 3=no spec to emit");
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
  if (r.spec) {
    console.log("");
    console.log(`Strategy spec emitted: ${r.spec.name}`);
    console.log(`  - Run \`node src/index.js --token ${r.symbol} --emit-spec\` to extract the JSON.`);
  }
  console.log("");
}

function formatLargeNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(n);
}
