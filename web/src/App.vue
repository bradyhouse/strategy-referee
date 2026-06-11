<script setup>
import { ref, computed } from "vue";

const mode = ref("single"); // "single" | "watchlist"

// Single-token state
const token = ref("ETH");
const atDate = ref("2025-09-25");
const loading = ref(false);
const result = ref(null);
const error = ref(null);

// Watchlist state
const watchlistInput = ref("BTC, ETH, SOL, LINK, ADA, DOGE");
const watchlistLoading = ref(false);
const watchlistResults = ref(null);
const watchlistError = ref(null);

const presets = [
  { label: "ETH · 2025-09-25", token: "ETH", atDate: "2025-09-25" },
  { label: "LINK · 2025-09-25", token: "LINK", atDate: "2025-09-25" },
  { label: "SOL · 2025-09-25", token: "SOL", atDate: "2025-09-25" },
];

const watchlistPresets = [
  { label: "Crypto majors @ 2025-09-25 (3 PASS)", symbols: "BTC, ETH, SOL, LINK, ADA, DOGE", atDate: "2025-09-25" },
  { label: "Top 10 today (mostly REJECT)", symbols: "BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, DOT, LTC", atDate: "" },
];

async function evaluate() {
  if (!token.value.trim()) return;
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    const r = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: token.value.trim().toUpperCase(),
        asOfDate: atDate.value || null,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    result.value = await r.json();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function loadPreset(p) {
  token.value = p.token;
  atDate.value = p.atDate;
  evaluate();
}

function loadWatchlistPreset(p) {
  watchlistInput.value = p.symbols;
  atDate.value = p.atDate;
  scanWatchlist();
}

async function scanWatchlist() {
  const symbols = watchlistInput.value
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) return;
  watchlistLoading.value = true;
  watchlistError.value = null;
  watchlistResults.value = null;
  try {
    const r = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols,
        asOfDate: atDate.value || null,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    watchlistResults.value = await r.json();
  } catch (e) {
    watchlistError.value = e.message;
  } finally {
    watchlistLoading.value = false;
  }
}

function drillIn(row) {
  // Switch to single-token mode, prefill from the row, and run.
  mode.value = "single";
  token.value = row.symbol;
  if (row.as_of) atDate.value = row.as_of;
  evaluate();
}

function switchMode(newMode) {
  mode.value = newMode;
  error.value = null;
  watchlistError.value = null;
}

const watchlistTally = computed(() => {
  if (!watchlistResults.value) return null;
  const t = { PASS: 0, WATCH: 0, REJECT: 0 };
  let oversoldWatch = 0;
  for (const r of watchlistResults.value) {
    t[r.verdict] = (t[r.verdict] ?? 0) + 1;
    if (r.verdict === "WATCH" && r.spec) oversoldWatch++;
  }
  return { ...t, oversoldWatch };
});

function downloadSpec() {
  const spec = result.value?.spec;
  if (!spec) return;
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${spec.name}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyCliCommand() {
  const sym = result.value?.symbol || token.value.trim().toUpperCase();
  const dateFlag = result.value?.as_of ? ` --at-date ${result.value.as_of}` : "";
  const cmd = `node src/index.js --token ${sym}${dateFlag}`;
  navigator.clipboard?.writeText(cmd);
}

// Formatters
function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1) return "$" + Number(n).toFixed(4);
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + Number(n).toFixed(decimals) + "%";
}
function fmtNum(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(decimals);
}

// Verdict styling
const verdictClass = computed(() => {
  if (!result.value) return "";
  return {
    PASS:   "bg-emerald-500 text-white",
    WATCH:  "bg-amber-500 text-white",
    REJECT: "bg-rose-500 text-white",
  }[result.value.verdict] ?? "bg-gray-500 text-white";
});

const cardBorder = computed(() => {
  if (!result.value) return "border-gray-200";
  return {
    PASS:   "border-emerald-200",
    WATCH:  "border-amber-200",
    REJECT: "border-rose-200",
  }[result.value.verdict] ?? "border-gray-200";
});

const trendBadgeClass = computed(() => {
  const dist = result.value?.signals?.sma_distance_pct;
  if (dist == null) return "text-gray-500";
  return dist >= 0 ? "text-emerald-600" : "text-rose-600";
});
</script>

<template>
  <div class="min-h-screen bg-white">
    <!-- Header -->
    <header class="border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div>
          <h1 class="text-lg font-bold text-gray-900">strategy-referee</h1>
          <p class="text-xs text-gray-500">Anti-hype crypto strategy evaluator — built for BNB HACK</p>
        </div>
        <nav class="flex gap-6 text-sm text-gray-500">
          <a href="https://github.com/bradyhouse/strategy-referee" class="hover:text-gray-900">GitHub</a>
          <a href="https://github.com/bradyhouse/sigma-swing-agent/blob/main/docs/cmc_evidence_table.md" class="hover:text-gray-900">Evidence ↗</a>
        </nav>
      </div>
    </header>

    <!-- Mode bar -->
    <div class="bg-gray-50 border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
        <span class="text-sm font-semibold text-gray-900">Mode</span>
        <button
          @click="switchMode('single')"
          :class="['px-4 py-1.5 rounded-md text-sm font-medium', mode === 'single' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50']"
        >
          Single token
        </button>
        <button
          @click="switchMode('watchlist')"
          :class="['px-4 py-1.5 rounded-md text-sm font-medium', mode === 'watchlist' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50']"
        >
          Watchlist
        </button>
        <div class="ml-8 flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-900">As of</span>
          <input
            v-model="atDate"
            type="date"
            class="px-3 py-1.5 rounded-md border border-gray-300 text-sm font-mono"
            :max="new Date().toISOString().slice(0, 10)"
          />
        </div>
      </div>
    </div>

    <!-- Single-token input section -->
    <div v-if="mode === 'single'" class="max-w-7xl mx-auto px-6 py-6">
      <div class="flex items-center gap-3 mb-4">
        <span class="text-sm font-semibold text-gray-900">Token</span>
        <input
          v-model="token"
          type="text"
          placeholder="BTC, ETH, SOL..."
          class="px-3 py-2 rounded-md border border-gray-300 w-64 text-sm uppercase"
          @keyup.enter="evaluate"
        />
        <button
          @click="evaluate"
          :disabled="loading"
          class="px-5 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {{ loading ? "Evaluating..." : "Evaluate" }}
        </button>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-xs text-gray-500">Or try a known historical PASS:</span>
        <button
          v-for="p in presets"
          :key="p.label"
          @click="loadPreset(p)"
          class="px-3 py-1 rounded-full border border-gray-300 text-xs hover:bg-gray-50"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Watchlist input section -->
    <div v-if="mode === 'watchlist'" class="max-w-7xl mx-auto px-6 py-6">
      <div class="flex items-start gap-3 mb-4">
        <span class="text-sm font-semibold text-gray-900 pt-2">Tokens</span>
        <input
          v-model="watchlistInput"
          type="text"
          placeholder="BTC, ETH, SOL, LINK..."
          class="px-3 py-2 rounded-md border border-gray-300 flex-1 max-w-2xl text-sm font-mono"
          @keyup.enter="scanWatchlist"
        />
        <button
          @click="scanWatchlist"
          :disabled="watchlistLoading"
          class="px-5 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {{ watchlistLoading ? "Scanning..." : "Scan" }}
        </button>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-xs text-gray-500">Presets:</span>
        <button
          v-for="p in watchlistPresets"
          :key="p.label"
          @click="loadWatchlistPreset(p)"
          class="px-3 py-1 rounded-full border border-gray-300 text-xs hover:bg-gray-50"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="mode === 'single' && error" class="max-w-7xl mx-auto px-6 pb-6">
      <div class="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-800 text-sm">
        <strong>Error:</strong> {{ error }}
      </div>
    </div>

    <!-- Watchlist error -->
    <div v-if="mode === 'watchlist' && watchlistError" class="max-w-7xl mx-auto px-6 pb-6">
      <div class="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-800 text-sm">
        <strong>Error:</strong> {{ watchlistError }}
      </div>
    </div>

    <!-- Watchlist results -->
    <div v-if="mode === 'watchlist' && watchlistResults" class="max-w-7xl mx-auto px-6 pb-12">
      <div class="flex items-center gap-3 mb-4">
        <h2 class="text-lg font-bold text-gray-900">
          Scan{{ atDate ? ` as of ${atDate}` : "" }} — {{ watchlistResults.length }} token{{ watchlistResults.length === 1 ? "" : "s" }}
        </h2>
        <span v-if="watchlistTally" class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
          {{ watchlistTally.PASS }} PASS
        </span>
        <span v-if="watchlistTally" class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
          {{ watchlistTally.WATCH }} WATCH
        </span>
        <span v-if="watchlistTally" class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold">
          {{ watchlistTally.REJECT }} REJECT
        </span>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-600 font-bold">
            <tr>
              <th class="text-left px-4 py-3 w-24">Verdict</th>
              <th class="text-left px-4 py-3 w-24">Symbol</th>
              <th class="text-right px-4 py-3 tabular-nums">Δ TO SMA200</th>
              <th class="text-right px-4 py-3 tabular-nums">RSI(14)</th>
              <th class="text-right px-4 py-3 tabular-nums">MFI(14)</th>
              <th class="text-center px-4 py-3 w-20">Spec</th>
              <th class="text-left px-4 py-3">Detail</th>
              <th class="text-right px-4 py-3 w-28">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="r in watchlistResults" :key="r.symbol" class="hover:bg-gray-50">
              <td class="px-4 py-3">
                <span
                  :class="['px-2 py-0.5 rounded-full text-xs font-bold', {
                    'bg-emerald-500 text-white': r.verdict === 'PASS',
                    'bg-amber-500 text-white': r.verdict === 'WATCH',
                    'bg-rose-500 text-white': r.verdict === 'REJECT',
                  }]"
                >
                  {{ r.verdict }}
                </span>
              </td>
              <td class="px-4 py-3 font-mono font-bold">{{ r.symbol }}</td>
              <td
                class="px-4 py-3 font-mono text-right tabular-nums"
                :class="{
                  'text-emerald-600': r.signals?.sma_distance_pct >= 5,
                  'text-amber-600': r.signals?.sma_distance_pct != null && r.signals.sma_distance_pct >= 0 && r.signals.sma_distance_pct < 5,
                  'text-rose-600': r.signals?.sma_distance_pct < 0,
                }"
              >
                {{ r.signals ? fmtPct(r.signals.sma_distance_pct) : "—" }}
              </td>
              <td
                class="px-4 py-3 font-mono text-right tabular-nums"
                :class="r.signals?.rsi < 32 ? 'text-emerald-600' : 'text-gray-900'"
              >
                {{ r.signals ? fmtNum(r.signals.rsi) : "—" }}
              </td>
              <td
                class="px-4 py-3 font-mono text-right tabular-nums"
                :class="r.signals?.mfi < 20 ? 'text-emerald-600' : 'text-gray-900'"
              >
                {{ r.signals ? fmtNum(r.signals.mfi) : "—" }}
              </td>
              <td class="px-4 py-3 text-center">
                <span
                  v-if="r.spec"
                  :class="['inline-block px-2 py-0.5 rounded text-xs font-bold border', {
                    'bg-emerald-50 text-emerald-800 border-emerald-300': r.verdict === 'PASS',
                    'bg-amber-50 text-amber-800 border-amber-300': r.verdict === 'WATCH',
                  }]"
                >
                  YES
                </span>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="px-4 py-3 text-gray-600">
                <span v-if="r.code" class="font-mono text-xs">{{ r.code }}</span>
                <span v-else-if="r.verdict === 'PASS'">survivor-family match</span>
                <span v-else-if="r.verdict === 'WATCH' && r.spec">oversold-confirmed, elevated risk</span>
                <span v-else-if="r.verdict === 'WATCH'">near-trigger</span>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  @click="drillIn(r)"
                  class="text-xs text-gray-700 underline hover:text-gray-900"
                >
                  Drill in →
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Single-token result card -->
    <div v-if="mode === 'single' && result" class="max-w-7xl mx-auto px-6 pb-12">
      <div :class="['rounded-xl border bg-white shadow-sm overflow-hidden', cardBorder]">
        <!-- Verdict header -->
        <div class="px-6 py-5 border-b border-gray-100 flex items-center gap-4">
          <span :class="['px-3 py-1 rounded-full text-xs font-bold tracking-wide', verdictClass]">
            {{ result.verdict }}
          </span>
          <h2 class="text-2xl font-bold text-gray-900">{{ result.symbol }}</h2>
          <span v-if="result.as_of" class="text-sm text-gray-500">as of {{ result.as_of }}</span>
          <span v-if="result.code" class="ml-auto text-xs font-mono px-2 py-1 bg-gray-100 text-gray-600 rounded">
            {{ result.code }}
          </span>
        </div>

        <!-- Signals grid -->
        <div v-if="result.signals" class="px-6 py-5 border-b border-gray-100 grid grid-cols-5 gap-6">
          <div>
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Close</div>
            <div class="text-xl font-bold font-mono mt-1">{{ fmtUsd(result.signals.close) }}</div>
          </div>
          <div>
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">RSI(14)</div>
            <div class="text-xl font-bold font-mono mt-1" :class="result.signals.rsi < 32 ? 'text-emerald-600' : 'text-gray-900'">
              {{ fmtNum(result.signals.rsi) }}
            </div>
            <div v-if="result.signals.rsi < 32" class="text-xs text-gray-500 mt-0.5">oversold</div>
          </div>
          <div>
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">MFI(14)</div>
            <div class="text-xl font-bold font-mono mt-1" :class="result.signals.mfi < 20 ? 'text-emerald-600' : 'text-gray-900'">
              {{ fmtNum(result.signals.mfi) }}
            </div>
            <div v-if="result.signals.mfi < 20" class="text-xs text-gray-500 mt-0.5">oversold</div>
          </div>
          <div>
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">SMA(200)</div>
            <div class="text-xl font-bold font-mono mt-1">{{ fmtUsd(result.signals.sma200) }}</div>
          </div>
          <div>
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Δ to SMA200</div>
            <div :class="['text-xl font-bold font-mono mt-1', trendBadgeClass]">
              {{ fmtPct(result.signals.sma_distance_pct) }}
            </div>
            <div v-if="result.signals.sma_distance_pct != null" class="text-xs text-gray-500 mt-0.5">
              {{ result.signals.sma_distance_pct >= 0 ? "uptrend" : "downtrend" }}
            </div>
          </div>
        </div>

        <!-- Reasoning -->
        <div class="px-6 py-5 border-b border-gray-100">
          <h3 class="text-sm font-bold text-gray-900 mb-2">
            Why this is {{ result.verdict === "PASS" ? "a PASS" : result.verdict === "REJECT" ? "REJECTED" : "WATCH" }}
          </h3>
          <ul class="space-y-1.5">
            <li v-for="(line, i) in result.reasoning" :key="i" class="text-sm text-gray-700 flex gap-2">
              <span :class="['mt-1.5 w-1 h-1 rounded-full flex-shrink-0', verdictClass]"></span>
              <span>{{ line }}</span>
            </li>
          </ul>
        </div>

        <!-- Forward-look (PASS or oversold-WATCH at historical date) -->
        <div v-if="result.forward_look && !result.forward_look.status" class="px-6 py-5 border-b border-gray-100">
          <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div class="text-xs font-bold text-emerald-800 uppercase tracking-wide mb-3">
              Forward-look — what would have happened if you entered at as-of close
            </div>
            <div class="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
              <div><span class="text-gray-500">Entered</span> <span class="font-mono ml-2">{{ result.forward_look.entry_date }} @ {{ fmtUsd(result.forward_look.entry_price) }}</span></div>
              <div><span class="text-gray-500">Exited</span> <span class="font-mono ml-2">{{ result.forward_look.exit_date }} @ {{ fmtUsd(result.forward_look.exit_price) }} <span class="text-xs text-gray-500">({{ result.forward_look.reason }})</span></span></div>
              <div><span class="text-gray-500">Hold</span> <span class="font-mono ml-2">{{ result.forward_look.hold_days }} days</span></div>
              <div><span class="text-gray-500">Gross P&L</span> <span class="font-mono ml-2">{{ fmtPct(result.forward_look.gross_pnl_pct) }}</span></div>
            </div>
            <div class="mt-3 pt-3 border-t border-emerald-200">
              <span class="text-gray-700">Net P&L ({{ result.forward_look.fee_round_trip_pct }}% fees):</span>
              <span class="text-lg font-bold font-mono text-emerald-700 ml-3">{{ fmtPct(result.forward_look.net_pnl_pct) }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="result.forward_look?.status === 'OPEN_AT_EOF'" class="px-6 py-5 border-b border-gray-100">
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <strong>Forward-look:</strong> {{ result.forward_look.note }}
          </div>
        </div>

        <!-- Backtest -->
        <div v-if="result.backtest && result.backtest.n != null" class="px-6 py-5 border-b border-gray-100">
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div class="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">
              Retrospective backtest ({{ result.backtest.archetype }}, {{ result.backtest.fee_round_trip_pct }}% real fees)
            </div>
            <div v-if="result.backtest.n === 0" class="text-sm text-gray-700">
              {{ result.backtest.note || "No trades fired in lookback." }}
            </div>
            <div v-else class="grid grid-cols-4 gap-x-8 gap-y-2 text-sm">
              <div><span class="text-gray-500">Entries (n)</span> <span class="font-mono ml-2 font-bold">{{ result.backtest.n }}</span></div>
              <div><span class="text-gray-500">Win rate</span> <span class="font-mono ml-2">{{ fmtNum(result.backtest.win_rate * 100, 1) }}%</span></div>
              <div><span class="text-gray-500">Mean net P&L</span> <span class="font-mono ml-2">{{ fmtPct(result.backtest.mean_net_pnl_pct) }}</span></div>
              <div><span class="text-gray-500">Max drawdown</span> <span class="font-mono ml-2">{{ fmtNum(result.backtest.max_drawdown_pct) }}%</span></div>
            </div>
            <div v-if="result.backtest.note" class="mt-3 pt-3 border-t border-gray-200 text-xs italic text-gray-600">
              {{ result.backtest.note }}
            </div>
          </div>
        </div>

        <!-- Spec emitted -->
        <div v-if="result.spec" class="px-6 py-5 border-b border-gray-100">
          <h3 class="text-sm font-bold text-gray-900">Strategy spec emitted</h3>
          <p class="text-xs font-mono text-gray-600 mt-1">{{ result.spec.name }}</p>
          <p class="text-xs text-gray-500 mt-1">Validated against <code class="font-mono">@stratchai/strategy-spec</code>. Consumable by <code class="font-mono">@stratchai/backtest</code> for further validation.</p>
        </div>

        <!-- Actions -->
        <div class="px-6 py-4 flex items-center gap-3 bg-gray-50">
          <button
            v-if="result.spec"
            @click="downloadSpec"
            class="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
          >
            Download spec JSON
          </button>
          <button
            @click="copyCliCommand"
            class="px-4 py-2 rounded-md bg-white border border-gray-300 text-sm font-medium hover:bg-gray-50"
          >
            Copy CLI command
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="border-t border-gray-200 py-6 text-center text-xs text-gray-500">
      Methodology: 21 archetypes audited, 2 walk-forward survivors.
      <a href="https://github.com/bradyhouse/sigma-swing-agent/blob/main/docs/cmc_evidence_table.md" class="text-gray-700 underline hover:text-gray-900">Source</a>.
    </footer>
  </div>
</template>
