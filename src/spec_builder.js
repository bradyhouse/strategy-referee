// Builds a runnable @stratchai/strategy-spec payload for a PASS verdict.
// The emitted spec uses the survivor family's walk-forward-validated params
// (see docs/cmc_evidence_table.md §3a / §3b) and the canonical exit envelope.
// Always validated before return.

// @stratchai/strategy-spec is published as CJS with module.exports = { ... }.
// Node's ESM/CJS interop heuristics don't auto-detect named exports from that
// assignment pattern (works fine for indicators because it uses exports.foo = ...).
// Default-import + destructure is the documented workaround.
import strategySpec from "@stratchai/strategy-spec";
const { parseSpecOrThrow } = strategySpec;

const NEAR_INFINITY_DAY = 86_400_000;

// Build the rsi_oversold + SMA200 survivor spec for one token.
// Params mirror the n=29 OOS mean +0.71% / win 62% defensible combo
// (rsi_oversold=32, sl=-8, profit_floor=10, max_hold=10d).
export function buildRsiSurvivorSpec(symbol) {
  const sym = symbol.toUpperCase();
  return buildAndValidate({
    name: `rsi_oversold_bounce_daily__${sym}`,
    exchange: "coinbase-paper",
    candle_granularity: "ONE_DAY",
    candle_window: 250,
    description: descriptionFor("rsi_oversold", sym),
    params: {
      rsi_period:                    14,
      rsi_oversold:                  32,
      rsi_floor:                     20,
      rsi_exit:                      55,
      slow_ma_len:                   200,
      fast_ma_len:                   10,
      tp_pct:                        15,
      sl_pct:                        -8,
      profit_floor_pct:              10,
      min_hold_ms:                   NEAR_INFINITY_DAY,
      max_hold_ms:                   NEAR_INFINITY_DAY * 10,
      strategy_cooldown_ms:          NEAR_INFINITY_DAY,
      flat_regime_profit_floor_pct:  6,
    },
    entry_rules: [{
      mode: "RSI_OVERSOLD",
      when: [
        { indicator: "rsi",   field: "value",            op: "<",  value_from_param: "rsi_oversold" },
        { indicator: "rsi",   field: "value",            op: ">",  value_from_param: "rsi_floor"    },
        { indicator: "band",  field: "priceAboveMiddle", op: "==", value: false },
        { indicator: "trend", field: "up",               op: "==", value: true },
      ],
    }],
    exit_rules: rsiExitRules(),
    scan_whitelist: [`${sym}-USDC`],
    limit_order_mode: { enabled: true },
  });
}

// Build the mfi_oversold + SMA200 survivor spec.
// Params mirror the n=18 OOS mean +0.89% / win 56% defensible combo
// (mfi_oversold=20, rsi_max=35, sl=-8, profit_floor=11, max_hold=10d).
export function buildMfiSurvivorSpec(symbol) {
  const sym = symbol.toUpperCase();
  return buildAndValidate({
    name: `mfi_oversold_reversal_daily__${sym}`,
    exchange: "coinbase-paper",
    candle_granularity: "ONE_DAY",
    candle_window: 250,
    description: descriptionFor("mfi_oversold", sym),
    params: {
      mfi_period:                    14,
      mfi_oversold:                  20,
      mfi_floor:                     5,
      rsi_period:                    14,
      rsi_max:                       35,
      slow_ma_len:                   200,
      fast_ma_len:                   10,
      tp_pct:                        15,
      sl_pct:                        -8,
      profit_floor_pct:              11,
      min_hold_ms:                   NEAR_INFINITY_DAY,
      max_hold_ms:                   NEAR_INFINITY_DAY * 10,
      strategy_cooldown_ms:          NEAR_INFINITY_DAY,
      flat_regime_profit_floor_pct:  6,
    },
    entry_rules: [{
      mode: "MFI_OVERSOLD",
      when: [
        { indicator: "mfi",   field: "value", op: "<",  value_from_param: "mfi_oversold" },
        { indicator: "mfi",   field: "value", op: ">",  value_from_param: "mfi_floor"    },
        { indicator: "rsi",   field: "value", op: "<=", value_from_param: "rsi_max"      },
        { indicator: "trend", field: "up",    op: "==", value: true },
      ],
    }],
    exit_rules: mfiExitRules(),
    scan_whitelist: [`${sym}-USDC`],
    limit_order_mode: { enabled: true },
  });
}

function rsiExitRules() {
  return [
    { applies_to: "RSI_OVERSOLD", when: [{ type: "pnl", field: "pnlPct", op: "<=", value_from_param: "sl_pct" }],          reason: "SL" },
    { applies_to: "RSI_OVERSOLD", when: [{ type: "pnl", field: "pnlPct", op: ">=", value_from_param: "profit_floor_pct" }], reason: "PROFIT_FLOOR" },
    { applies_to: "RSI_OVERSOLD", when: [{ type: "pnl", field: "pnlPct", op: ">=", value_from_param: "tp_pct" }],           reason: "TP" },
    { applies_to: "RSI_OVERSOLD", when: [{ type: "hold", field: "holdMs", op: ">=", value_from_param: "max_hold_ms" }],      reason: "TIME_EXIT" },
  ];
}

function mfiExitRules() {
  return [
    { applies_to: "MFI_OVERSOLD", when: [{ type: "pnl", field: "pnlPct", op: "<=", value_from_param: "sl_pct" }],           reason: "SL" },
    { applies_to: "MFI_OVERSOLD", when: [{ type: "pnl", field: "pnlPct", op: ">=", value_from_param: "profit_floor_pct" }], reason: "PROFIT_FLOOR" },
    { applies_to: "MFI_OVERSOLD", when: [{ type: "pnl", field: "pnlPct", op: ">=", value_from_param: "tp_pct" }],           reason: "TP" },
    { applies_to: "MFI_OVERSOLD", when: [{ type: "hold", field: "holdMs", op: ">=", value_from_param: "max_hold_ms" }],     reason: "TIME_EXIT" },
  ];
}

function descriptionFor(archetype, symbol) {
  const audit = archetype === "rsi_oversold"
    ? "rsi_oversold + SMA200 was 1 of 2 walk-forward survivors. 6/10 defensible OOS combos; n=29 mean +0.71%, win 62% at 1.5% real fees."
    : "mfi_oversold + SMA200 was 1 of 2 walk-forward survivors (marginal). 2/10 defensible OOS combos; n=18 mean +0.89%, win 56% at 1.5% real fees.";

  return [
    `Auto-generated by strategy-referee for ${symbol}.`,
    "",
    "This spec encodes the walk-forward-validated survivor family from a",
    "21-archetype audit at 1.5% real fees on a mixed crypto + stock universe.",
    "",
    audit,
    "",
    "The emitted spec is informational — it represents WHAT a runnable strategy",
    "would look like for this token under the survivor family's params. It",
    "validates against @stratchai/strategy-spec and runs in @stratchai/backtest;",
    "to deploy, verify the token trades on the chosen exchange and hand the JSON",
    "to a @stratchai/core runtime.",
    "",
    "Not a prediction. Not financial advice. Single-token live performance is",
    "expected to regress toward the walk-forward OOS mean.",
  ].join("\n");
}

function buildAndValidate(spec) {
  return parseSpecOrThrow(spec);
}
