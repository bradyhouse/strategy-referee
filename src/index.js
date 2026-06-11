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

let asOfDateMs = null;
if (args.atDate) {
  asOfDateMs = parseAsOfDate(args.atDate);
  if (asOfDateMs == null) {
    console.error(`--at-date must be YYYY-MM-DD; got "${args.atDate}"`);
    process.exit(1);
  }
}

const result = await evaluateToken(args.token, { asOfDateMs });

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
    else if (a === "--at-date") out.atDate = argv[++i];
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
  console.log("  --at-date <DATE>   Evaluate as of YYYY-MM-DD (historical replay; default: today)");
  console.log("  --json             Emit full result as JSON (verdict + signals + reasoning + spec)");
  console.log("  --emit-spec        Print only the strategy-spec JSON (PASS / oversold-WATCH only)");
  console.log("  --help, -h         Show this help");
  console.log("");
  console.log("Exit codes: 0=PASS/WATCH, 2=REJECT, 3=no spec to emit");
}

function printPretty(r) {
  const label = { PASS: "[PASS]", WATCH: "[WATCH]", REJECT: "[REJECT]" }[r.verdict] || `[${r.verdict}]`;
  const asOfTag = r.as_of ? `  as of ${r.as_of}` : "";
  console.log("");
  console.log(`${label}  ${r.symbol}${asOfTag}${r.code ? "  (" + r.code + ")" : ""}`);
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
  if (r.backtest) {
    console.log("");
    console.log(`Retrospective backtest (${r.backtest.archetype}, ${r.backtest.fee_round_trip_pct}% real fees):`);
    if (r.backtest.n === 0) {
      console.log(`  ${r.backtest.note || "No trades fired in lookback."}`);
    } else {
      const bt = r.backtest;
      console.log(`  Entries fired       n=${bt.n}`);
      console.log(`  Win rate            ${(bt.win_rate * 100).toFixed(1)}%`);
      console.log(`  Mean P&L (net)      ${bt.mean_net_pnl_pct}%`);
      console.log(`  Median P&L (net)    ${bt.median_net_pnl_pct}%`);
      console.log(`  Cumulative (net)    ${bt.total_net_pnl_pct}%`);
      console.log(`  Std dev             ${bt.std_pnl_pct}%`);
      console.log(`  Max drawdown        ${bt.max_drawdown_pct}%`);
      console.log(`  Exit reasons        ${JSON.stringify(bt.exit_reason_breakdown)}`);
      if (bt.note) console.log(`  Caveat              ${bt.note}`);
    }
  }
  if (r.forward_look) {
    console.log("");
    console.log(`Forward-look (what would have happened if you entered at as-of close):`);
    const fl = r.forward_look;
    if (fl.status === "OPEN_AT_EOF") {
      console.log(`  ${fl.note}`);
    } else {
      console.log(`  Entered             ${fl.entry_date}  @ ${fl.entry_price}`);
      console.log(`  Exited              ${fl.exit_date}  @ ${fl.exit_price}  (${fl.reason})`);
      console.log(`  Hold                ${fl.hold_days} days`);
      console.log(`  Gross P&L           ${fl.gross_pnl_pct}%`);
      console.log(`  Net P&L (${fl.fee_round_trip_pct}% fees)  ${fl.net_pnl_pct}%`);
    }
  }
  if (r.spec) {
    console.log("");
    console.log(`Strategy spec emitted: ${r.spec.name}`);
    console.log(`  - Run \`node src/index.js --token ${r.symbol}${r.as_of ? " --at-date " + r.as_of : ""} --emit-spec\` to extract the JSON.`);
  }
  console.log("");
}

function formatLargeNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(n);
}

// Parse YYYY-MM-DD into end-of-day UTC milliseconds. End-of-day so that any
// bar that closed on the given date is included (UTC midnight is the start
// of the next day). Returns null on parse failure.
function parseAsOfDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isFinite(ms) ? ms : null;
}
