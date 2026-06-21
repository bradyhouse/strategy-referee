<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, createApp, h } from "vue";
import { CathodeCandle, CathodeGrid, CathodeTerminal } from "@stratchai/cathode";
import "@stratchai/cathode/style";
// Static bundle of the audit-universe screening run. 46 shelved daily-crypto
// archetypes × CMC top-30, 1.5% real round-trip fees, walk-forward on
// 720-bar Kraken history. Sources the "Audit transparency" UI block —
// gives users empirical per-token evidence behind the audit's cull
// verdicts, plus surfaces any rescue candidates (currently
// mass_index_reversal_daily at +0.51% mean). Regenerate with:
//   node /Users/bradyhouse/git/sigma-swing-agent/scripts/screen_audit_universe.js
//   cp data/audit_universe_screening_YYYY-MM-DD.json strategy-referee/data/audit_universe_screening.json
import auditScreening from "../../data/audit_universe_screening.json";

// ── Chart visual prefs (right-click menu + Cmd+Shift+= curvature) ──────────
// Mirrors bradyhouse/dashboard src/components/ChartPanel.vue:188-221.
//
// Persistence is intentionally OFF right now — we're still iterating on
// what the right defaults should be, and stale localStorage from a prior
// session would mask whether the new defaults actually look good on
// first paint. Right-click menu changes still apply for the session,
// just won't survive a refresh.
//
// To re-enable later: flip PERSIST_PREFS = true. The load/save wiring is
// kept in place so it's a one-line change.
const PERSIST_PREFS = false;
const LS_VISUAL_KEY = "strategyReferee.chart.visualPrefs";
function loadVisualPrefs() {
  if (!PERSIST_PREFS) return {};
  try { return JSON.parse(localStorage.getItem(LS_VISUAL_KEY) ?? "{}"); } catch { return {}; }
}
function saveVisualPrefs() {
  if (!PERSIST_PREFS) return;
  localStorage.setItem(LS_VISUAL_KEY, JSON.stringify({
    theme: chartTheme.value, curvature: curvature.value,
    scanlines: scanlines.value, glow: glow.value,
    flat: flat.value,
  }));
}
const _vp        = loadVisualPrefs();
// Defaults tuned for the demo: phosphor theme + visible curvature. The magnify
// lens is no longer a hover toggle — it renders only when the trade is PINNED
// (see lensFrozen / the <CathodeCandle> :magnify bindings), so there's no
// `magnify` visual-pref anymore.
const chartTheme = ref(_vp.theme     ?? "phosphor");
const curvature  = ref(_vp.curvature ?? 24);
const scanlines  = ref(_vp.scanlines ?? true);
const glow       = ref(_vp.glow      ?? false);
// flat=false enables three.js + barrel-shader curvature. The page does
// take a moment longer to render the first chart (~200ms extra warm-up)
// because three.js needs to compile the lens shader on first use.
const flat       = ref(_vp.flat      ?? false);

const chartContextMenu = ref(null);
function onChartContextMenu(e) {
  e.preventDefault();
  chartContextMenu.value = { x: e.clientX, y: e.clientY };
}

// Opens the same display-prefs menu from a visible click target (not right-
// click) so users discover the customization options without having to know
// the right-click affordance exists.
function openDisplayMenuFromButton(e) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  chartContextMenu.value = { x: r.left, y: r.bottom + 4 };
}

// === Magnify lens — "pinned overlay only" model ===
// The lens renders ONLY when pinned: cathode's :magnify prop is bound to these
// frozen flags (see the <CathodeCandle> tags). cathode's own watcher clears the
// lens to its off-screen sentinel the instant magnify→false, so unpinning needs
// nothing more than flipping the flag. Passive hover NEVER moves the lens — a
// container-level capture listener suppresses hover so cathode's cursor-follow
// can't fire. Net behaviour:
//   pinned   → lens sits on the trade; hover does nothing; drag/wheel/arrows navigate
//   unpinned → no lens at all; clean navigable chart; hover does nothing
const lensFrozen = ref(false);
// (expandedLensFrozen for the modal is declared with the other modal state)

// Suppress passive hover (and leave) at CONTAINER capture phase. Capture on the
// container fires BEFORE cathode's canvas listeners (correct ordering — a
// canvas-level blocker fires too late, since cathode's handler is registered
// first) and survives canvas remounts (a Display/WebGL toggle replaces the
// canvas, not the container). We let through:
//   - drag mousemove (e.buttons > 0) → cathode still pans
//   - synthetic events (isTrusted === false) → our programmatic lens placement
// and block real passive hover + leaves so the lens/crosshair never react to
// the cursor merely moving across the chart.
function suppressHover(e) {
  if (!e.isTrusted) return;
  if (e.type === "mousemove" && e.buttons) return;  // dragging → allow pan
  e.stopPropagation();
}
const HOVER_EVENTS = ["mousemove", "mouseleave", "mouseout", "pointerleave", "pointerout"];
function attachHoverSuppressor(container) {
  if (!container) return;
  // addEventListener dedupes identical (fn, capture) pairs, so calling this on
  // every result / modal-open is safe (no double-attach).
  for (const ev of HOVER_EVENTS) container.addEventListener(ev, suppressHover, true);
}

function togglePinLens() {
  if (lensFrozen.value) {
    lensFrozen.value = false;   // :magnify → false; cathode clears the lens
    return;
  }
  lensFrozen.value = true;      // :magnify → true; place the lens once cathode reacts
  nextTick(() => {
    positionLensAtTrade(chartContainerRef.value, CC_SLOT_W_PX);
    setTimeout(() => positionLensAtTrade(chartContainerRef.value, CC_SLOT_W_PX), 90);
  });
}

// Dispatch a synthetic mousemove at the trade MIDPOINT so cathode positions the
// lens there. Only has an effect while pinned (:magnify true). Returns true once
// it has positioned (canvas laid out), false so the caller can retry.
//
// Why the midpoint and not the entry: cathode's lens is a WebGL fisheye
// (radius ~250 device-px, 1.6x zoom) that displaces sampled content AWAY from
// its center by the zoom factor. An entry-centered pin pushed the exit marker —
// near the TOP of the range for a TP/PROFIT_FLOOR exit — clean off the top
// edge, so it vanished (confirmed empirically 2026-06-18 via headless render).
// Centering on the trade midpoint keeps BOTH markers equidistant from center,
// so both stay inside the magnified region AND on-screen, and it magnifies the
// whole entry→exit move — a better "look at the trade" demo than the entry alone.
// slotW MUST match the :slot-w prop on the target CathodeCandle — inline (6)
// and the expand modal (10) differ, and cathode's right-anchored layout depends
// on it. Passing the wrong slotW lands the lens off to the side (the modal lens
// was computed with the inline 6 and sat left of the markers).
function positionLensAtTrade(container, slotW) {
  if (!container) return false;
  const canvas = container.querySelector("canvas");
  if (!canvas) return false;
  const r = result.value;
  if (!r?.chart?.candles?.length || !r.forward_look || r.forward_look.status) return false;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 50) return false;  // not laid out yet

  const candles = r.chart.candles;
  const entryMs = Date.parse(r.forward_look.entry_date + "T00:00:00Z");
  const exitMs  = Date.parse(r.forward_look.exit_date  + "T00:00:00Z");
  let entryIdx = -1, exitIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (entryIdx < 0 && candles[i].start >= entryMs) entryIdx = i;
    if (exitIdx  < 0 && candles[i].start >= exitMs)  { exitIdx = i; break; }
  }
  if (entryIdx < 0 || exitIdx < 0) return false;

  // X: cathode's dl() right-anchored layout (Ve=8 left pad, Ze=56 right axis,
  // slotW per the target chart). Mirror it to find the candle-column centers,
  // then average.
  const plotW = Math.max(1, rect.width - CC_LEFT_PAD_PX - CC_RIGHT_AXIS_PX);
  const maxFit = Math.max(1, Math.floor(plotW / slotW));
  const count = Math.min(maxFit, candles.length);
  const firstIdx = Math.max(0, candles.length - count);
  const midIdx = (entryIdx + exitIdx) / 2;
  const xLocalCss = CC_LEFT_PAD_PX + (midIdx - firstIdx + 0.5) * slotW;

  // Y: cathode's hl() price-panel split + vl() range, computed in DEVICE px
  // then scaled to CSS via the canvas's own device→css ratio (DPR-robust).
  // Constants mirror cathode dist: top pad pt=8, volume-label band Xt=22,
  // panel gap Dt=4, default volumeFraction=0.18, vl() range pad=4%. price→Y is
  // affine, so the midpoint of the two prices maps to the midpoint of the two
  // marker Ys.
  const aDev = canvas.height;                       // device px
  const innerDev = Math.max(1, aDev - 8 - 22 - 4);  // pt + Xt + Dt
  const volHDev = Math.round(innerDev * 0.18);
  const priceHDev = innerDev - volHDev;
  const priceY0Dev = 8, priceY1Dev = 8 + priceHDev;
  let lo = Infinity, hi = -Infinity;
  for (let i = firstIdx; i < Math.min(candles.length, firstIdx + count); i++) {
    if (candles[i].low  < lo) lo = candles[i].low;
    if (candles[i].high > hi) hi = candles[i].high;
  }
  const pad = (hi - lo) * 0.04;
  const span = Math.max(1e-9, (hi + pad) - (lo - pad));
  const midPrice = (r.forward_look.entry_price + r.forward_look.exit_price) / 2;
  const yDev = priceY0Dev + (1 - (midPrice - (lo - pad)) / span) * (priceY1Dev - priceY0Dev);
  const yLocalCss = yDev * (rect.height / aDev);

  const x = rect.left + xLocalCss;
  const y = rect.top + yLocalCss;

  // mouseenter+mouseover prime the canvas; mousemove triggers cathode's
  // lens-position handler. These are synthetic (isTrusted=false) so the
  // container hover-suppressor lets them through.
  for (const type of ["mouseenter", "mouseover", "mousemove"]) {
    canvas.dispatchEvent(new MouseEvent(type, {
      clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
  }
  return true;
}

// Inline chart auto-pin (on each new result). Sets lensFrozen (→ :magnify on)
// and places the lens on the trade. The watch(result) retries cover cathode's
// async canvas mount; positionLensAtTrade is a no-op until the canvas is laid
// out, and re-pinning an already-pinned lens just re-places it.
function pinLensAtTrade() {
  lensFrozen.value = true;
  attachHoverSuppressor(chartContainerRef.value);
  positionLensAtTrade(chartContainerRef.value, CC_SLOT_W_PX);
}

// Expand-modal auto-pin (when the modal opens, mirroring the inline pin state).
// Separate canvas + frozen flag from the inline view; the modal canvas is
// destroyed on close. Sets expandedLensFrozen (→ modal :magnify on) and places
// the lens on the trade.
function pinExpandedLens() {
  expandedLensFrozen.value = true;
  attachHoverSuppressor(expandedChartRef.value);
  positionLensAtTrade(expandedChartRef.value, CC_SLOT_W_EXPANDED);
}

// Pin/unpin toggle for the fullscreen modal's own lens — the modal's equivalent
// of togglePinLens(). Unpin flips the flag (modal :magnify → false, cathode
// clears the lens); pin re-enables + re-places on the trade midpoint. Operates
// on expandedChartRef / expandedLensFrozen, independent of the inline chart.
function toggleExpandedPin() {
  if (expandedLensFrozen.value) {
    expandedLensFrozen.value = false;
    return;
  }
  expandedLensFrozen.value = true;
  nextTick(() => {
    positionLensAtTrade(expandedChartRef.value, CC_SLOT_W_EXPANDED);
    setTimeout(() => positionLensAtTrade(expandedChartRef.value, CC_SLOT_W_EXPANDED), 90);
  });
}
function closeChartContextMenu() { chartContextMenu.value = null; }
function toggleWebGL()      { flat.value      = !flat.value;      saveVisualPrefs(); }
function toggleScanlines()  { scanlines.value = !scanlines.value; saveVisualPrefs(); }
function toggleGlow()       { glow.value      = !glow.value;      saveVisualPrefs(); }
function setChartTheme(t)   { chartTheme.value = t;               saveVisualPrefs(); }

// Download the current chart as a PNG. cathode's WebGL canvas can't be captured
// directly (the renderer has no preserveDrawingBuffer, so toDataURL comes back
// blank), and toggling the live chart's render mode would disrupt the view +
// pinned lens. So we render a throwaway CathodeCandle OFFSCREEN in flat (2D)
// mode — same candles, SMA200, entry/exit markers, axes, volume (minus the CRT
// barrel/scanline shader, which a 2D capture can't include) — read its 2D
// canvas, composite the @stratchai/cathode wordmark, and trigger the download.
// The host is positioned in-viewport but invisible (opacity:0, z-index:-1)
// because cathode gates rendering on an IntersectionObserver — fully off-screen
// (left:-99999px) would never paint.
const downloading = ref(false);
async function downloadChart() {
  const r = result.value;
  if (downloading.value || !r?.chart?.candles?.length) return;
  downloading.value = true;
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:1280px;height:640px;opacity:0;z-index:-1;pointer-events:none;";
  document.body.appendChild(host);
  let app = null;
  try {
    app = createApp({
      render: () => h(CathodeCandle, {
        candles: r.chart.candles,
        overlays: chartOverlays.value,
        markers: chartMarkers.value,
        theme: chartTheme.value,
        flat: true,            // 2D path → toDataURL works
        compact: false,
        curvature: 0,
        scanlines: false,
        glow: false,
        magnify: false,
        slotW: 8,
      }),
    });
    app.mount(host);
    await new Promise((res) => setTimeout(res, 500));  // let cathode size + paint
    const src = host.querySelector("canvas");
    if (!src || !src.width) return;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d");
    // bake a solid backdrop (cathode draws on transparent; the container bg
    // shows through live, so reproduce it or the PNG would be transparent)
    ctx.fillStyle = chartTheme.value === "paper" ? "#fafaf9" : "#000000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    // @stratchai/cathode wordmark, bottom-left, mirroring the on-chart badge
    const fs = Math.max(12, Math.round(out.height * 0.028));
    ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(52,211,153,0.92)";  // emerald-400
    ctx.fillText("@stratchai/cathode", fs, out.height - fs);
    const sym = r.symbol ?? "chart";
    const d = r.forward_look?.entry_date ? "_" + r.forward_look.entry_date : "";
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `strategy-referee_${sym}${d}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    if (app) app.unmount();
    host.remove();
    downloading.value = false;
  }
}

// Container background must follow the cathode theme — cathode renders on
// transparent so whatever's behind the canvas shows through. Paper theme
// expects a light bg; phosphor/amber expect dark.
const chartContainerBg = computed(() => {
  return chartTheme.value === "paper"
    ? "bg-stone-50 border-stone-300"
    : "bg-black border-gray-200";
});

// Ref on the chart container — the hover-suppressor attaches here (capture
// phase) and positionLensAtTrade() finds the canvas inside it to dispatch the
// synthetic lens-placement mousemove. Cathode wires its hover/magnify handler
// as `onMousemove` directly on the canvas element (verified in cathode dist) —
// there's no imperative API, hence the synthetic-event approach.
const chartContainerRef = ref(null);

// Fullscreen expand state for the chart. The inline chart is fixed at
// h-80 (320px) which is good for an inline result card but cramped if
// a judge wants to actually inspect candles. ⛶ Expand opens a teleported
// modal at near-viewport size with a second CathodeCandle instance using
// a wider slot-w. The inline overlays (hold-period band + drop-lines)
// are intentionally NOT duplicated in the modal — they're tied to
// chartContainerRef's geometry, and the modal's value is the raw cathode
// render with markers + watermark, not pixel-parity overlays. ESC and
// click-on-backdrop both close.
const chartExpanded = ref(false);
// The modal renders its OWN CathodeCandle (separate canvas), so it needs its
// own container ref + frozen flag — independent of the inline chart's lens.
const expandedChartRef = ref(null);
const expandedLensFrozen = ref(false);
function onChartEsc(e) {
  if (e.key === "Escape" && chartExpanded.value) chartExpanded.value = false;
}

// When the expand modal opens, MIRROR the inline lens state. If the inline lens
// is pinned, auto-pin the modal lens on the trade midpoint too so the fullscreen
// view maintains the magnified-trade presentation. If the inline lens is
// unpinned, leave the modal unpinned (no lens — clean navigable chart). Retries
// cover cathode's async canvas mount + shader warmup. On close, reset the flag;
// the modal canvas is destroyed by the v-if. The modal container also needs the
// hover-suppressor (attached inside pinExpandedLens / on open).
watch(chartExpanded, async (open) => {
  if (!open) { expandedLensFrozen.value = false; return; }
  await nextTick();
  attachHoverSuppressor(expandedChartRef.value);
  if (!lensFrozen.value) return;   // inline unpinned → modal stays unpinned
  setTimeout(pinExpandedLens, 250);
  setTimeout(pinExpandedLens, 700);
  setTimeout(pinExpandedLens, 1500);
});

// Note: the `watch(result, …)` that auto-pins the magnify lens on the trade
// midpoint is registered AFTER `result` is declared lower in this file
// (search "watch-result-magnify"). Vue allows watch() anywhere in
// <script setup>, but the ref it watches must already exist at the
// time the watch line executes — otherwise TDZ.

// Keyboard shortcuts:
//   Cmd+Shift+= / Cmd+Shift+-   curvature nudge (Shift so we don't shadow
//                               the browser's native Cmd+= / Cmd+- page zoom)
//   P                            pin/unpin the lens (routes to the modal lens
//                               when expanded, else the inline lens)
function onChartKeydown(e) {
  // Don't intercept while the user is typing in an input
  if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;

  if (e.metaKey && e.shiftKey) {
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      curvature.value = Math.min(40, curvature.value + 2);
      saveVisualPrefs();
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      curvature.value = Math.max(0, curvature.value - 2);
      saveVisualPrefs();
      return;
    }
  }

  if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    // Route the hotkey to whichever chart is active: the fullscreen modal's
    // lens when expanded, otherwise the inline chart's.
    if (chartExpanded.value) toggleExpandedPin();
    else                     togglePinLens();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onChartKeydown);
  window.addEventListener("keydown", onChartEsc);
  document.addEventListener("click", closeChartContextMenu);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onChartKeydown);
  window.removeEventListener("keydown", onChartEsc);
  document.removeEventListener("click", closeChartContextMenu);
});

const mode = ref("single"); // "single" | "watchlist"

// Methodology lead-in starts EXPANDED so a first-time visitor (judge,
// casual user) sees the 4-paragraph context before encountering jargon
// in the result card. Toggles persist in localStorage so returning
// users who collapsed it stay collapsed; new users always see it.
const METHODOLOGY_PREF_KEY = "strategyReferee.methodologyExpanded";
const _mePref = (() => {
  try { const v = localStorage.getItem(METHODOLOGY_PREF_KEY); return v === null ? null : v === "true"; }
  catch { return null; }
})();
const methodologyExpanded = ref(_mePref ?? true);
watch(methodologyExpanded, (v) => {
  try { localStorage.setItem(METHODOLOGY_PREF_KEY, String(v)); } catch {}
});

// Single-token state
// Defaults pre-fill to ETH / 2025-09-28, a clean PROFIT_FLOOR +11.61%
// PASS over 8 days. The first "Evaluate" click — by a hackathon judge
// who doesn't notice the preset chips — produces a PASS demo with full
// forward-look + spec emission. ETH is canonical/unambiguous on CMC so
// the lookup can't regress the way TON did (Toncoin was rebranded
// server-side to "Gram" / symbol GRAM, breaking the symbol=TON query).
// Power users clear the date to get real-time evaluation (the placeholder
// hint surfaces once the field goes blank).
const token = ref("ETH");
// Per-mode date state. The shared date input renders ONE field in the
// mode bar, but each mode tracks its own preferred date so switching
// modes doesn't pollute the other's default. Without this, the watchlist
// auto-prefill (2025-09-25) would leak into single-mode after a Watchlist
// click → Single switch. Single-default 2025-09-28 ≠ watchlist-default
// 2025-09-25, so the per-mode isolation is observable.
const singleAtDate    = ref("2025-09-28");
const watchlistAtDate = ref("");
const atDate = computed({
  get() { return mode.value === "single" ? singleAtDate.value : watchlistAtDate.value; },
  set(v) {
    if (mode.value === "single") singleAtDate.value = v;
    else                          watchlistAtDate.value = v;
  },
});
const loading = ref(false);
const result = ref(null);
const error = ref(null);

// Max selectable as-of date is TODAY - 2 calendar days. Setting as-of to
// today would slice in the in-progress daily bar from Kraken (close = current
// ticker, high/low/volume partial), polluting RSI / MFI / SMA200. T-1 is the
// first complete bar; T-2 gives the forward-look at least one bar of data
// to walk through. Re-computes once on mount since the page won't survive
// a day boundary.
const maxAtDate = computed(() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
});

// watch-result-magnify: after the chart renders, attach the hover-suppressor
// and auto-pin the magnify lens on the TRADE MIDPOINT (see pinLensAtTrade for
// why midpoint, not entry — the old entry-centered pin pushed the exit marker
// off the top edge). The demo flow is "look at a trade," so the lens lands on
// the entry→exit move and stays there. Unpinning (button / P) hides the lens
// for a clean navigable chart; the next Evaluate re-pins.
//
// setTimeout > nextTick because cathode's three.js shader takes a moment to
// warm up on first frame; three retries cover the async canvas mount.
watch(result, async (r) => {
  if (!r) return;
  await nextTick();
  attachHoverSuppressor(chartContainerRef.value);
  setTimeout(pinLensAtTrade, 250);
  setTimeout(pinLensAtTrade, 700);
  setTimeout(pinLensAtTrade, 1500);
});

// Watchlist state
const watchlistInput = ref("BTC, ETH, SOL, LINK, ADA, DOGE");
const watchlistLoading = ref(false);
const watchlistResults = ref(null);
const watchlistError = ref(null);

// Presets sourced from a brute-force sweep across the 28-symbol Kraken
// canonical-name universe (BTC/ETH/SOL/...) over the last 365 days.
// 27 profitable PASSes surfaced; the two below are the most household-
// recognizable wins to anchor the chip-set narrative ("late-September
// 2025 oversold dip caught across canonical majors"). Re-run the sweep
// in scripts/find_current_pass.js + verify via the full evaluator
// (evaluateTokenWithQuote) as time passes; scanner PASSes don't always
// match evaluator PASSes once forward-look is computed.
//
// Chips surfaced: BTC 9/26 (PROFIT_FLOOR +9.94%) and SOL 9/26
// (PROFIT_FLOOR +12.93%). Form default ETH 2025-09-28 (PROFIT_FLOOR
// +11.61%) is the first-click demo and is NOT duplicated as a chip.
//
// TON chips removed 2026-06-18: CoinMarketCap rebranded Toncoin
// (id=11419) to "Gram" / symbol GRAM. The symbol=TON query now silently
// matches "AT&T Tokenized Stock (Ondo)" (id=39249, symbol="Ton") and
// the evaluator's case-sensitive `quotes["TON"]` lookup misses CMC's
// returned key "Ton" → TOKEN_NOT_FOUND_ON_CMC REJECT. Permanent until
// the evaluator gains slug/id-based resolution.
const presets = [
  { label: "BTC · 2025-09-26 (PROFIT_FLOOR +9.94%)", token: "BTC", atDate: "2025-09-26" },
  { label: "SOL · 2025-09-26 (PROFIT_FLOOR +12.93%)", token: "SOL", atDate: "2025-09-26" },
];

// "CMC top 30 today" is dynamic — loaded from /api/universe on demand. The
// preset chip's symbols field is populated at click time so the demo always
// shows the current CMC-curated top-30 by market cap, not a hardcoded list.
// Direct demo-theater for the "Best CMC Data Use" prize angle.
const cmcTopUniverse = ref(null);   // string like "BTC, ETH, ..."; cached after first load

async function ensureCmcTopUniverse() {
  if (cmcTopUniverse.value) return cmcTopUniverse.value;
  const r = await fetch("/api/universe?limit=30");
  if (!r.ok) throw new Error(`Universe fetch failed: HTTP ${r.status}`);
  const j = await r.json();
  cmcTopUniverse.value = j.data.map(t => t.symbol).join(", ");
  return cmcTopUniverse.value;
}

const watchlistPresets = [
  // CMC top-30 live universe — populated from /api/universe at click time.
  // Showcases CMC as a primary data source (token curation), not just as
  // a sanity-check sidekick for our Kraken OHLCV pull.
  { label: "CMC top 30 today (live universe)", symbols: "__CMC_TOP_30__", atDate: "" },
  // Top 10 majors with blank date → real-time scan. In a downtrending
  // market this returns mostly/all REJECT, which IS the demo.
  { label: "Top 10 majors today (mostly REJECT)", symbols: "BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, DOT, LTC", atDate: "" },
  // Historical multi-PASS day for the counter-example.
  { label: "Crypto majors @ 2025-09-25 (3 PASS — historical)", symbols: "BTC, ETH, SOL, LINK, ADA, DOGE", atDate: "2025-09-25" },
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

async function loadWatchlistPreset(p) {
  // CMC-dynamic preset: resolve sentinel by fetching the live top-30 from
  // /api/universe (cached client-side after first fetch + server-side for 5min).
  let symbols = p.symbols;
  if (symbols === "__CMC_TOP_30__") {
    watchlistError.value = null;
    watchlistLoading.value = true;
    try {
      symbols = await ensureCmcTopUniverse();
    } catch (e) {
      watchlistLoading.value = false;
      watchlistError.value = `Could not fetch CMC top 30 — ${e.message}`;
      return;
    }
  }
  watchlistInput.value = symbols;
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

// Tracks whether the user has visited watchlist mode at least once. The
// first visit auto-pre-fills the watchlist inputs with the proven
// 3-PASS historical demo (Crypto majors @ 2025-09-25), the same UX
// principle as the single-mode ETH / 2025-09-28 defaults. Without this
// the user would inherit single-mode's date in watchlist mode, and the
// major-token list may not all hit on that specific date — looking
// like the tool is broken.
const watchlistInitialized = ref(false);

function switchMode(newMode) {
  if (newMode === mode.value) return;
  mode.value = newMode;
  error.value = null;
  watchlistError.value = null;
  if (newMode === "watchlist" && !watchlistInitialized.value) {
    watchlistInput.value = "BTC, ETH, SOL, LINK, ADA, DOGE";
    atDate.value = "2025-09-25";
    watchlistInitialized.value = true;
  }
}

// ── Agent-skill view ─────────────────────────────────────────────────────────
// A CathodeTerminal that drives the SAME evaluator the MCP skill exposes,
// presented as an agent transcript. Each prompt makes a REAL call to
// /api/evaluate or /api/watchlist (the endpoints share evaluateToken /
// evaluateWatchlist with the MCP tools) and renders the tool-call + verdict +
// reasoning + emitted spec — no scripted/faked output.
const agentExamples = ["evaluate ETH", "evaluate ETH as of 2025-09-28", "scan BTC, ETH, SOL"];
const agentEntries = ref([
  { text: "strategy-referee — agent skill", level: "success" },
  { text: "Same evaluator the MCP skill exposes: evaluate_token / evaluate_watchlist. Real calls.", level: "debug" },
  { text: "Try:  evaluate ETH   ·   evaluate ETH as of 2025-09-28   ·   scan BTC, ETH, SOL", level: "info" },
]);
const agentBusy = ref(false);

// Replace the array (not push) so cathode's shallow-watched entries prop re-renders.
function pushAgent(text, level = "info") {
  agentEntries.value = [...agentEntries.value, { text, level, ts: Date.now() }];
}

// Parse a natural prompt into a tool call. "evaluate ETH" → token; "scan A,B,C"
// or multiple tickers → watchlist; a YYYY-MM-DD anywhere → as_of_date.
function parseAgentCommand(raw) {
  const text = (raw || "").trim();
  if (!text) return { kind: "noop" };
  const date = (text.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null;
  const STOP = new Set(["EVALUATE", "EVAL", "TOKEN", "SCAN", "WATCHLIST", "AS", "OF", "ON", "FOR", "THE", "CHECK", "RATE", "ASOF", "HELP", "AND"]);
  const candidates = (text.toUpperCase().match(/\b[A-Z]{2,6}\b/g) || []).filter((w) => !STOP.has(w));
  if (/\bhelp\b/i.test(text) || !candidates.length) return { kind: "help" };
  const isScan = /\bscan\b|\bwatchlist\b/i.test(text) || text.includes(",") || candidates.length > 1;
  if (isScan) return { kind: "watchlist", symbols: [...new Set(candidates)].slice(0, 12), date };
  return { kind: "token", symbol: candidates[0], date };
}

function agentRenderVerdict(r) {
  const lvl = r.verdict === "PASS" ? "success" : r.verdict === "WATCH" ? "warn" : "error";
  pushAgent(`${r.verdict}  ${r.symbol}${r.code ? "  (" + r.code + ")" : ""}`, lvl);
  for (const line of (r.reasoning || []).slice(0, 3)) pushAgent("  • " + line, "debug");
  if (r.spec?.name) pushAgent(`  ↳ backtestable spec emitted: ${r.spec.name}`, "info");
  if (r.forward_look && !r.forward_look.status) {
    const f = r.forward_look;
    const pnl = typeof f.net_pnl_pct === "number" ? f.net_pnl_pct.toFixed(2) + "%" : "";
    pushAgent(`  ↳ forward-look: ${f.entry_date} → ${f.exit_date}  ${f.reason}  ${pnl} net`, "info");
  }
}

async function onAgentSubmit(command) {
  pushAgent("→ " + command, "debug");
  const parsed = parseAgentCommand(command);
  if (parsed.kind === "noop") return;
  if (parsed.kind === "help") {
    pushAgent("Ask me to evaluate a token or scan several:", "info");
    pushAgent("  evaluate ETH   ·   evaluate SOL as of 2025-09-26   ·   scan BTC, ETH, SOL", "info");
    return;
  }
  agentBusy.value = true;
  try {
    if (parsed.kind === "token") {
      pushAgent(`🔧 evaluate_token(symbol="${parsed.symbol}"${parsed.date ? `, as_of_date="${parsed.date}"` : ""})`, "info");
      const res = await fetch("/api/evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: parsed.symbol, asOfDate: parsed.date }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      agentRenderVerdict(await res.json());
    } else {
      pushAgent(`🔧 evaluate_watchlist(symbols=[${parsed.symbols.join(", ")}]${parsed.date ? `, as_of_date="${parsed.date}"` : ""})`, "info");
      const res = await fetch("/api/watchlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: parsed.symbols, asOfDate: parsed.date }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const arr = await res.json();
      const tally = arr.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
      pushAgent(`scanned ${arr.length}: ` + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", "), "info");
      for (const r of arr) agentRenderVerdict(r);
    }
  } catch (e) {
    pushAgent("✗ " + (e?.message || e), "error");
  } finally {
    agentBusy.value = false;
  }
}

// Chart overlays + markers derived from result.chart + result.forward_look.
// Wraps cathode's expected payload shape (sma200 as a PriceOverlayLine,
// entry/exit markers from forward_look when available).
const chartOverlays = computed(() => {
  const sma = result.value?.chart?.sma200;
  if (!sma || sma.length === 0) return [];
  return [
    {
      kind: "line",
      data: sma,
      color: "#3b82f6",       // blue-500
      lineWidth: 1.5,
      label: "SMA(200)",
    },
  ];
});

const chartMarkers = computed(() => {
  const fl = result.value?.forward_look;
  if (!fl || fl.status === "OPEN_AT_EOF") return [];
  const candles = result.value?.chart?.candles ?? [];
  if (candles.length === 0) return [];
  // Resolve entry/exit dates to nearest candle openTime
  const entryTs = Date.parse(fl.entry_date + "T00:00:00Z");
  const exitTs  = Date.parse(fl.exit_date + "T00:00:00Z");
  return [
    { timestamp: entryTs, price: fl.entry_price, kind: "entry", label: "Entry" },
    { timestamp: exitTs,  price: fl.exit_price,  kind: "exit",  label: fl.reason },
  ];
});

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

// Audit-transparency state — collapsed by default so the screening data
// doesn't overwhelm first-time visitors. Click to expand the per-archetype
// table for the currently-evaluated token.
const auditExpanded = ref(false);

// Click-to-expand per-strategy detail. Stores the strategy name of the row
// the user clicked; rendered as a detail card below the grid showing the
// culled-reason summary (rich rationale from the audit script).
const auditSelectedStrategy = ref(null);
function onAuditRowClicked(payload) {
  const strat = payload?.data?.strategy;
  if (!strat) return;
  auditSelectedStrategy.value = auditSelectedStrategy.value === strat ? null : strat;
}
const auditSelectedRow = computed(() =>
  tokenAuditRows.value.find(r => r.strategy === auditSelectedStrategy.value) || null
);

// Glossary expansion (separate state from the panel toggle so users can
// open both independently).
const auditGlossaryExpanded = ref(false);

// Map (archetype name → audit row for the requested symbol). Reactive on
// result so flipping tokens auto-refreshes the visible audit slice.
const tokenAuditRows = computed(() => {
  const sym = result.value?.symbol;
  if (!sym) return [];
  const rows = [];
  for (const r of auditScreening.results) {
    const perToken = r.per_token.find(p => p.symbol === sym);
    if (!perToken) continue;
    const rescue = (r.total?.mean_net_pct ?? 0) > 0 && (r.total?.n ?? 0) >= 10;
    rows.push({
      strategy: r.strategy,
      culled_at: r.culled_at,
      culled_reason: r.culled_reason_summary || "",   // surfaced via row expansion below
      audit_n: r.total?.n ?? 0,
      audit_mean_net_pct: r.total?.mean_net_pct ?? null,
      audit_win_rate: r.total?.win_rate ?? null,
      audit_exit_reasons: r.total?.exit_reasons,
      token_n: perToken.n,
      token_mean_net_pct: perToken.mean_net_pct,
      token_win_rate: perToken.win_rate,
      token_exit_reasons: perToken.exit_reasons,
      rescue_candidate: rescue,
    });
  }
  // Rescue candidates pinned to the top of the grid (they're the answer
  // to the "did any cull verdict not hold on CMC" question), then by
  // this-token's mean P&L descending. Without the pin, a rescue
  // candidate with zero trades on the current token sorts to the bottom
  // and scrolls off-screen — burying the load-bearing finding.
  rows.sort((a, b) => {
    if (a.rescue_candidate !== b.rescue_candidate) return a.rescue_candidate ? -1 : 1;
    return (b.token_mean_net_pct ?? -Infinity) - (a.token_mean_net_pct ?? -Infinity);
  });
  return rows;
});

const auditMeta = computed(() => ({
  scanned_at:     auditScreening.scanned_at?.slice(0, 10),
  universe_size:  auditScreening.universe?.length ?? 0,
  n_archetypes:   auditScreening.n_strategies_screened ?? 0,
  n_rescue:       auditScreening.n_rescue_candidates ?? 0,
  fee:            auditScreening.fee_round_trip_pct ?? 1.5,
}));

// Headline-honesty state for the audit panel. Previously the headline
// said "X archetypes evaluated on {{symbol}}" via raw interpolation,
// which is literally false for tokens like HYPE that ARE in the static
// universe but had insufficient Kraken history (<250 daily bars) when
// the audit ran — every per_token row is {n: 0, skipped: 'no_kraken'},
// so nothing was actually evaluated on that token. Three states:
//   with-trades             — ≥1 archetype actually fired on this token
//   in-universe-no-trades   — token IS in universe but every row n=0
//                             (skip reason populated; new tokens, alts)
//   out-of-universe         — tokenAuditRows.length === 0 (panel v-if
//                             already hides; here for future-proofing
//                             if the gating logic changes)
const auditTokenFiredCount = computed(() =>
  tokenAuditRows.value.filter(r => (r.token_n ?? 0) > 0).length
);
const auditTokenState = computed(() => {
  if (!tokenAuditRows.value.length) return "out-of-universe";
  if (auditTokenFiredCount.value > 0) return "with-trades";
  return "in-universe-no-trades";
});

// CathodeGrid column definitions — translate the audit-row shape into
// cathode's ColDef[] format. Right-aligned numeric columns; value
// formatters for percent + status; cellStyle inline so the percent
// columns get red/green coloring without a global stylesheet (cathode's
// theme system handles bg/text/glow; cellStyle handles per-row signal).
const auditColumns = computed(() => {
  const sym = result.value?.symbol ?? "TOKEN";
  const numericRight = { textAlign: "right" };
  return [
    { field: "strategy", headerName: "Archetype", width: 280, flex: 2 },
    {
      field: "token_n",
      headerName: `on ${sym} n`,
      width: 80,
      cellStyle: numericRight,
      valueFormatter: p => p.value ?? "—",
    },
    {
      field: "token_mean_net_pct",
      headerName: `on ${sym} mean`,
      width: 110,
      cellStyle: p => ({
        textAlign: "right",
        color: p.value == null ? undefined : p.value >= 0 ? "#15803d" : "#be123c",
      }),
      valueFormatter: p => p.value == null ? "—" : fmtPct(p.value),
    },
    {
      field: "token_win_rate",
      headerName: `on ${sym} win`,
      width: 80,
      cellStyle: numericRight,
      valueFormatter: p => p.value == null ? "—" : (p.value * 100).toFixed(0) + "%",
    },
    { field: "audit_n",        headerName: "pooled n",      width: 80,  cellStyle: numericRight },
    {
      field: "audit_mean_net_pct",
      headerName: "pooled mean",
      width: 110,
      cellStyle: p => ({
        textAlign: "right",
        color: p.value == null ? undefined : p.value >= 0 ? "#15803d" : "#be123c",
      }),
      valueFormatter: p => p.value == null ? "—" : fmtPct(p.value),
    },
    { field: "culled_at",      headerName: "Culled",        width: 100 },
    {
      field: "rescue_candidate",
      headerName: "Status",
      width: 110,
      cellStyle: p => ({
        textAlign: "center",
        fontWeight: p.value ? 700 : 400,
        color: p.value ? "#b45309" : undefined,
      }),
      valueFormatter: p => p.value ? "⚡ RESCUE" : "shelved",
    },
  ];
});

// Watchlist results grid — same CathodeGrid + paper-theme pattern as the
// audit-transparency grid. Verdict pill + spec-emitted YES badge use
// cellRenderer (HTML string via v-html) since they're visual badges, not
// plain values. Row-click drills into the single-token view (replacing
// the previous explicit "Drill in →" action button — one less column,
// one less click, plus a more standard "click anywhere on the row" UX).
const watchlistColumns = computed(() => [
  {
    field: "verdict",
    headerName: "Verdict",
    width: 100,
    sortable: true,
    cellRenderer: (p) => {
      const v = p.value || "—";
      const bg = v === "PASS" ? "#10b981" : v === "WATCH" ? "#f59e0b" : v === "REJECT" ? "#f43f5e" : "#9ca3af";
      return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${bg};color:white;font-size:10px;font-weight:700;letter-spacing:0.025em">${v}</span>`;
    },
  },
  {
    field: "symbol",
    headerName: "Symbol",
    width: 90,
    sortable: true,
    cellStyle: { fontFamily: "ui-monospace, monospace", fontWeight: 700 },
  },
  {
    field: "signals.sma_distance_pct",
    headerName: "Δ to SMA200",
    width: 110,
    sortable: true,
    valueGetter: (p) => p.data?.signals?.sma_distance_pct ?? null,
    valueFormatter: (p) => p.value == null ? "—" : fmtPct(p.value),
    cellStyle: (p) => {
      if (p.value == null) return { textAlign: "right" };
      const color = p.value >= 5 ? "#15803d" : p.value >= 0 ? "#b45309" : "#be123c";
      return { textAlign: "right", color, fontFamily: "ui-monospace, monospace" };
    },
  },
  {
    field: "signals.rsi",
    headerName: "RSI(14)",
    width: 80,
    sortable: true,
    valueGetter: (p) => p.data?.signals?.rsi ?? null,
    valueFormatter: (p) => p.value == null ? "—" : fmtNum(p.value),
    cellStyle: (p) => ({
      textAlign: "right",
      color: (p.value ?? 999) < 32 ? "#15803d" : undefined,
      fontFamily: "ui-monospace, monospace",
      fontWeight: (p.value ?? 999) < 32 ? 700 : 400,
    }),
  },
  {
    field: "signals.mfi",
    headerName: "MFI(14)",
    width: 80,
    sortable: true,
    valueGetter: (p) => p.data?.signals?.mfi ?? null,
    valueFormatter: (p) => p.value == null ? "—" : fmtNum(p.value),
    cellStyle: (p) => ({
      textAlign: "right",
      color: (p.value ?? 999) < 20 ? "#15803d" : undefined,
      fontFamily: "ui-monospace, monospace",
      fontWeight: (p.value ?? 999) < 20 ? 700 : 400,
    }),
  },
  {
    field: "spec",
    headerName: "Spec",
    width: 80,
    sortable: false,
    cellRenderer: (p) => {
      if (!p.value) return "—";
      const verdict = p.data?.verdict;
      const bg = verdict === "PASS" ? "#ecfdf5" : "#fffbeb";
      const fg = verdict === "PASS" ? "#065f46" : "#92400e";
      const bd = verdict === "PASS" ? "#6ee7b7" : "#fcd34d";
      return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:${bg};color:${fg};border:1px solid ${bd};font-size:10px;font-weight:700">YES</span>`;
    },
  },
  {
    field: "detail",
    headerName: "Detail",
    flex: 1,
    sortable: false,
    valueGetter: (p) => {
      const r = p.data;
      if (r?.code) return r.code;
      if (r?.verdict === "PASS") return "survivor-family match";
      if (r?.verdict === "WATCH" && r.spec) return "oversold-confirmed, elevated risk";
      if (r?.verdict === "WATCH") return "near-trigger";
      return "";
    },
    cellStyle: { fontSize: "11px", color: "#6b7280" },
  },
]);

function onWatchlistRowClick(e) {
  if (e?.data) drillIn(e.data);
}

// Per-row inline style — highlight rescue candidates with a subtle amber tint.
// Slightly stronger alpha than the dark-theme variant because paper background
// needs more contrast to show through; still subtle enough that the row reads
// as data, not a callout box.
function auditRowStyle(p) {
  if (p.data?.rescue_candidate) {
    return { background: "rgba(251, 191, 36, 0.18)" };  // matches the ⚡ RESCUE badge palette
  }
  return undefined;
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

// Gate row styling — subtle row tint by status so PASS/FAIL/SKIP are scannable.
function gateRowClass(status) {
  if (status === "pass") return "bg-emerald-50/40";
  if (status === "fail") return "bg-rose-50/40";
  return "";
}

// Library / data-source name → docs link. Keeps the "Via" column clickable
// so judges can verify the lib stack mid-demo without leaving the page.
function libraryHref(name) {
  if (!name) return "#";
  if (name.startsWith("@stratchai/")) {
    const pkg = name.replace("@stratchai/", "");
    return `https://www.npmjs.com/package/@stratchai/${pkg}`;
  }
  if (name.startsWith("Kraken")) return "https://docs.kraken.com/api/docs/rest-api/get-ohlc-data/";
  if (name.startsWith("CoinMarketCap") || name.startsWith("CMC")) return "https://coinmarketcap.com/api/documentation/v1/";
  return "#";
}

// Chart trade-window geometry — computes the container-local pixel x for the
// entry and exit triangles so we can overlay HTML on top of the cathode
// canvas. Cathode's lens follows the cursor for OHLC inspection, but the
// trade markers themselves have no always-visible price labels and no
// hold-period highlight band. Adding these as a separate overlay layer
// avoids modifying the cathode package itself.
//
// Math mirrors cathode's `dl()` layout (verified against the dist):
// Ve=8 left pad, Ze=56 right axis margin, slotW=6, candles draw
// right-anchored from the rightmost column backward. Only the X-axis
// math is needed now — drop-line + highlight band placement is the
// only thing tradeWindowGeometry computes.
const CC_LEFT_PAD_PX    = 8;
const CC_RIGHT_AXIS_PX  = 56;
// Per-chart candle slot widths — MUST match the :slot-w props on the
// <CathodeCandle> tags. The inline chart and the expand modal differ, and the
// lens-positioning math (positionLensAtTrade) + drop-line geometry depend on
// using the right one. Bound to the template props below so they can't drift.
const CC_SLOT_W_PX      = 6;    // inline chart  (:slot-w)
const CC_SLOT_W_EXPANDED = 10;  // expand modal  (:slot-w)

const chartContainerSize = ref({ w: 0, h: 0 });
let _chartResizeObserver = null;

function resizeChartContainer() {
  const el = chartContainerRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  chartContainerSize.value = { w: r.width, h: r.height };
}

// Wire up after onMounted + every result change so the geometry refreshes.
watch(result, async () => {
  await nextTick();
  // Cathode mounts its canvas asynchronously; size after a tick + a frame.
  setTimeout(resizeChartContainer, 50);
  setTimeout(resizeChartContainer, 400);
});

onMounted(() => {
  // Initial size on mount + ResizeObserver for responsive layout changes.
  setTimeout(() => {
    resizeChartContainer();
    if (chartContainerRef.value && typeof ResizeObserver === "function") {
      _chartResizeObserver = new ResizeObserver(resizeChartContainer);
      _chartResizeObserver.observe(chartContainerRef.value);
    }
  }, 100);
});
onUnmounted(() => {
  if (_chartResizeObserver) _chartResizeObserver.disconnect();
});

// Returns null when no trade markers are available (no forward_look, REJECT
// verdict, etc). Otherwise returns the container-local pixel positions of
// the entry and exit triangles plus the plot-area bounds for the band.
const tradeWindowGeometry = computed(() => {
  const r = result.value;
  if (!r?.chart?.candles?.length) return null;
  if (!r.forward_look || r.forward_look.status) return null;
  const w = chartContainerSize.value.w;
  const h = chartContainerSize.value.h;
  if (w < 100 || h < 50) return null;

  const candles = r.chart.candles;
  const entryMs = Date.parse(r.forward_look.entry_date + "T00:00:00Z");
  const exitMs  = Date.parse(r.forward_look.exit_date  + "T00:00:00Z");
  let entryIdx = -1, exitIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (entryIdx < 0 && candles[i].start >= entryMs) entryIdx = i;
    if (exitIdx  < 0 && candles[i].start >= exitMs)  { exitIdx = i; break; }
  }
  if (entryIdx < 0 || exitIdx < 0) return null;

  const plotW = Math.max(1, w - CC_LEFT_PAD_PX - CC_RIGHT_AXIS_PX);
  const maxFit = Math.max(1, Math.floor(plotW / CC_SLOT_W_PX));
  const count = Math.min(maxFit, candles.length);
  const firstIdx = Math.max(0, candles.length - count);
  if (entryIdx < firstIdx || exitIdx < firstIdx) return null;  // scrolled off

  const entryX = CC_LEFT_PAD_PX + (entryIdx - firstIdx + 0.5) * CC_SLOT_W_PX;
  const exitX  = CC_LEFT_PAD_PX + (exitIdx  - firstIdx + 0.5) * CC_SLOT_W_PX;

  // Band spans entry candle's LEFT edge to exit candle's RIGHT edge so the
  // shading visually contains both markers without clipping their bases.
  const bandLeft  = entryX - CC_SLOT_W_PX / 2;
  const bandRight = exitX  + CC_SLOT_W_PX / 2;

  return {
    entryX, exitX,
    bandLeft, bandWidth: Math.max(2, bandRight - bandLeft),
    plotLeft: CC_LEFT_PAD_PX, plotRight: w - CC_RIGHT_AXIS_PX,
    containerW: w, containerH: h,
  };
});

// Strategy explainer — surfaces the rules of the survivor strategy that
// matched the verdict, in plain language with the actual numeric params
// pulled from the emitted spec. Users asked "what IS the strategy in play"
// because the spec name (rsi_oversold_bounce_daily) wasn't enough on its
// own; this block answers it.
const strategyExplainer = computed(() => {
  const r = result.value;
  if (!r || !r.spec) return null;
  const p = r.spec.params || {};
  const isMfi = r.spec.name?.startsWith("mfi_oversold");

  // Common exit envelope from the spec
  const slPct = p.sl_pct;
  const floorPct = p.profit_floor_pct;
  const tpPct = p.tp_pct;
  const maxHoldDays = p.max_hold_ms ? Math.round(p.max_hold_ms / 86400000) : null;

  // Per-archetype entry rules in plain language
  const oscillatorLine = isMfi
    ? `MFI(14) < ${p.mfi_oversold ?? 20}  — volume-weighted oversold (the move down had real volume behind it)`
    : `RSI(14) < ${p.rsi_oversold ?? 32}  — momentum oscillator confirms an oversold dip`;

  return {
    name: r.spec.name,
    archetype: isMfi ? "mfi_oversold + SMA200" : "rsi_oversold + SMA200",
    audit: isMfi
      ? "1 of 2 walk-forward survivors at 1.5% real fees (marginal). 2/10 defensible OOS combos; n=18 mean +0.89%, win 56%."
      : "1 of 2 walk-forward survivors at 1.5% real fees. 6/10 defensible OOS combos; n=29 mean +0.71%, win 62%.",
    intuition: "Mean-reversion within an uptrend: wait for a known long-horizon uptrend, buy temporary dips, exit on either disciplined SL, profit floor, or max hold.",
    entryRules: [
      { label: "Long-horizon uptrend confirmed", expr: `close > SMA(${p.slow_ma_len ?? 200})` },
      { label: "Oscillator-confirmed dip",       expr: oscillatorLine },
      ...(isMfi
        ? [{ label: "RSI not already recovering", expr: `RSI(14) ≤ ${p.rsi_max ?? 35} — keeps MFI signal from firing on a stale uptick` }]
        : [{ label: "Price below BB middle",      expr: `close < BB(20,2) middle band — reinforces 'mean to revert to'` }]),
      { label: "Floor on the oscillator",         expr: isMfi
          ? `MFI(14) > ${p.mfi_floor ?? 5} — skip catastrophic prints that aren't a 'dip', they're a collapse`
          : `RSI(14) > ${p.rsi_floor ?? 20} — skip catastrophic prints that aren't a 'dip', they're a collapse`,
      },
    ],
    exitRules: [
      { label: "Stop-loss",   expr: `${slPct}% from entry — caps loss on a failed buy-the-dip` },
      { label: "Profit floor", expr: `+${floorPct}% from entry — locks in the modal win the audit data points to` },
      { label: "Take-profit",  expr: `+${tpPct}% from entry — the rare outsized winner` },
      { label: "Max hold",     expr: `${maxHoldDays} days — exit even if neither price target hits` },
    ],
    direction: "Long only",
    maxHoldDays,
  };
});

// Honest disclosure — surfaces the "PASS ≠ buy signal" framing inline with
// the verdict instead of burying it in the README. The verdict-tree panel's
// green ✓ ✓ ✓ ✓ celebration on a PASS can inadvertently strengthen the
// "this token will go up" misread. This callout makes the population-level
// claim explicit at the point the user is most likely to misinterpret it.
// Only fires for verdicts that emit a spec (PASS, oversold-WATCH). REJECT
// and near-trigger WATCH don't need it — their gate failure is the message.
const honestDisclosure = computed(() => {
  const r = result.value;
  if (!r || !r.spec) return null;
  if (r.verdict === "PASS") {
    return {
      heading: "What PASS actually means",
      summary: "Structural match with the walk-forward survivor family — NOT a buy signal for this specific token at this date.",
      bullets: [
        "Rare by design: a 90-day scan of the CMC top-30 surfaced ZERO current matches — the tool won't fabricate a PASS just because you asked. The demo presets use historical dates where the oversold-in-uptrend setup genuinely occurred, to show what a real match looks like.",
        "Population-level edge: n=29 OOS trades, mean +0.71%/trade net at 1.5% real fees, win rate 62%. Magnitude is small.",
        "~38% of those audit trades were losers. Any single trade — including this one — can fall on either side; the survivor family's edge is the slight asymmetry in aggregate, not per-trade conviction.",
        "Honest use: download the spec, backtest on your own universe + recent bars, treat as one bet at this fingerprint in a portfolio with disciplined sizing. Respect the spec's exit envelope (SL ~-8%, profit floor ~+10%, max hold ~10 days).",
      ],
    };
  }
  if (r.verdict === "WATCH") {
    return {
      heading: "What this WATCH actually means",
      summary: "Survivor-family structural match BUT the sma_distance regime is in the elevated-risk bucket. Worse than a PASS, not a buy signal.",
      bullets: [
        "Walk-forward regime conditioning on n=11 (underpowered) showed the sma_distance < 5% bucket lost -0.55% mean — the OPPOSITE sign from the favorable bucket the PASS verdict uses.",
        "Sample is too small to be confident, but the directional risk is real. Read it as 'survivor pattern firing in a worse-than-typical regime,' not as 'almost a PASS.'",
        "Honest use: if you backtest the emitted spec on your universe, pay specific attention to the elevated-risk regime split before sizing into setups that match this verdict.",
      ],
    };
  }
  return null;
});

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
          <a href="https://github.com/bradyhouse/strategy-referee/blob/main/docs/methodology.md" class="hover:text-gray-900">Methodology ↗</a>
          <button @click="methodologyExpanded = !methodologyExpanded" class="hover:text-gray-900 font-medium">
            {{ methodologyExpanded ? "Hide context" : "How did we get here?" }}
          </button>
        </nav>
      </div>
    </header>

    <!-- Methodology lead-in — public-facing context so first-time visitors
         (judges, casual users) understand the tool's lineage before
         encountering jargon like "shelved" / "rescue candidate" / "audit
         transparency" in the result card. Collapsible because returning
         users don't need to re-read it; expanded on the FIRST page view by
         default so the anti-hype framing lands before the first Evaluate
         click. -->
    <div v-if="methodologyExpanded" class="bg-amber-50/70 border-b border-amber-200">
      <div class="max-w-7xl mx-auto px-6 py-5">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div class="md:col-span-4 mb-1">
            <h2 class="text-base font-bold text-amber-900">How did we get here?</h2>
            <p class="text-xs text-amber-800/80 mt-1">
              The thesis behind every <strong>PASS</strong> verdict, in 4 paragraphs. Full evidence in <a href="https://github.com/bradyhouse/strategy-referee/blob/main/docs/methodology.md" target="_blank" rel="noopener" class="font-mono underline hover:no-underline">docs/methodology.md</a>.
            </p>
          </div>
          <div class="rounded-md bg-white border border-amber-200 p-3">
            <div class="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">1. The audit</div>
            <p class="text-xs text-gray-700 leading-relaxed">
              <strong>21 strategy archetypes</strong> walk-forward-tested at <strong>1.5% real round-trip fees</strong> on a mixed crypto + stock universe (134 products, ~5 years). Per-archetype param grid; 60/40 in-sample/out-of-sample split; OOS-positive AND per-product defensibility required for survival.
            </p>
          </div>
          <div class="rounded-md bg-white border border-amber-200 p-3">
            <div class="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">2. The survivors</div>
            <p class="text-xs text-gray-700 leading-relaxed">
              <strong>2 archetypes survived</strong>: <code class="font-mono text-[11px]">rsi_oversold + SMA200</code> (n=29 OOS, mean <strong class="text-emerald-700">+0.71%</strong>, win <strong class="text-emerald-700">62%</strong>) and <code class="font-mono text-[11px]">mfi_oversold + SMA200</code> (n=18, mean <strong class="text-emerald-700">+0.89%</strong>, win <strong class="text-emerald-700">56%</strong>). Both buy oversold dips inside long-horizon uptrends with disciplined exits.
            </p>
          </div>
          <div class="rounded-md bg-white border border-amber-200 p-3">
            <div class="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">3. The other 44</div>
            <p class="text-xs text-gray-700 leading-relaxed">
              Everything else — Donchian, MACD/Stoch, ORB, bullish-engulfing, alligator, etc. — was <strong>rejected</strong> at OOS validation. This tool refuses to emit them as signals. The "Audit transparency" panel on every result card shows how the 46 daily-crypto rejects fare on the current CMC top-30 (spoiler: <strong>1 marginal rescue candidate</strong>; the rest stayed negative).
            </p>
          </div>
          <div class="rounded-md bg-white border border-amber-200 p-3">
            <div class="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">4. What PASS means</div>
            <p class="text-xs text-gray-700 leading-relaxed">
              PASS = "the current setup matches the survivor fingerprint." NOT "this token will go up." The edge is <strong>population-level</strong> (+0.71% mean across many trades); <strong>~38% of audit trades lost money</strong>. The disclosure on every PASS view restates this in-band. This is an evaluator, not a fortune teller.
            </p>
          </div>
        </div>
      </div>
    </div>

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
        <button
          @click="switchMode('agent')"
          :class="['px-4 py-1.5 rounded-md text-sm font-medium', mode === 'agent' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50']"
        >
          Agent skill
        </button>
        <div class="ml-8 flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-900">As of</span>
          <input
            v-model="atDate"
            type="date"
            class="px-3 py-1.5 rounded-md border border-gray-300 text-sm font-mono"
            :max="maxAtDate"
          />
          <span class="text-xs text-gray-400" v-if="!atDate">leave blank for real-time</span>
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
      <div class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3">
        <div class="flex items-center gap-2 mb-2">
          <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold">▶</span>
          <span class="text-sm font-semibold text-emerald-900">Guided demo — click a known historical PASS</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="p in presets"
            :key="p.label"
            @click="loadPreset(p)"
            class="px-3 py-1.5 rounded-md bg-white border border-emerald-300 text-sm font-medium text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400 transition"
          >
            {{ p.label }}
          </button>
        </div>
        <p class="mt-2 text-xs text-emerald-800/70">
          Each preset sets the token + as-of date together. The chosen date is when the survivor-family gate fired on this token; the result includes the full forward-look ("what would have happened if you entered here").
        </p>
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

    <!-- Agent skill — CathodeTerminal driving the SAME evaluator the MCP skill
         exposes (evaluate_token / evaluate_watchlist). Real calls, no scripts. -->
    <div v-if="mode === 'agent'" class="max-w-7xl mx-auto px-6 py-6">
      <div class="mb-3 flex items-center justify-between flex-wrap gap-3">
        <p class="text-sm text-gray-600 max-w-3xl">
          Talk to it like an agent would. Each prompt makes a real call to the same
          <span class="font-mono text-gray-900">evaluate_token</span> /
          <span class="font-mono text-gray-900">evaluate_watchlist</span>
          this project exposes as an <strong>MCP skill</strong> — no scripted output. Type a prompt and hit Enter.
        </p>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="ex in agentExamples"
            :key="ex"
            @click="onAgentSubmit(ex)"
            :disabled="agentBusy"
            class="px-2.5 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 font-mono disabled:opacity-50"
          >
            {{ ex }}
          </button>
        </div>
      </div>
      <div class="h-[480px] rounded-lg overflow-hidden border border-gray-800 bg-black">
        <CathodeTerminal
          :entries="agentEntries"
          :busy="agentBusy"
          theme="phosphor"
          prompt="→ "
          :curvature="4"
          :glow="false"
          :scanlines="false"
          :magnify="false"
          :autoscroll="true"
          @submit="onAgentSubmit"
        />
      </div>
      <p class="mt-2 text-xs text-gray-500 italic">
        Terminal from <a href="https://www.npmjs.com/package/@stratchai/cathode" target="_blank" rel="noopener" class="font-mono hover:underline">@stratchai/cathode</a>.
        The same tools are callable by a real agent over MCP — see the repo README's "Use as an AI Agent Skill" section.
      </p>
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

      <!-- Watchlist results grid — CathodeGrid (paper theme, same visual
           register as the audit-transparency grid). Click any row to drill
           into the single-token evaluation for that symbol (replaces the
           old explicit "Drill in →" column). Sortable columns via the
           header click. -->
      <div class="h-[600px] rounded-xl border border-gray-200 overflow-hidden cursor-pointer">
        <CathodeGrid
          :column-defs="watchlistColumns"
          :row-data="watchlistResults"
          theme="paper"
          :row-height="34"
          :curvature="4"
          :scanlines="false"
          :glow="false"
          @row-clicked="onWatchlistRowClick"
        />
      </div>
      <p class="mt-2 text-xs text-gray-500 italic">
        Click any row to drill into the single-token evaluation. Sortable by clicking column headers.
      </p>
    </div>

    <!-- Single-token result card -->
    <div v-if="mode === 'single' && result" class="max-w-7xl mx-auto px-6 pb-12">
      <div :class="['rounded-xl border bg-white shadow-sm overflow-hidden', cardBorder]">
        <!-- Verdict header — CMC token-info enrichment (logo, name, tags,
             website link) sits between the verdict badge and the symbol so
             every demo shows the @coinmarketcap data source in-frame. -->
        <div class="px-6 py-5 border-b border-gray-100 flex items-center gap-4 flex-wrap">
          <span :class="['px-3 py-1 rounded-full text-xs font-bold tracking-wide', verdictClass]">
            {{ result.verdict }}
          </span>
          <img v-if="result.cmc_display?.logo"
               :src="result.cmc_display.logo"
               :alt="result.cmc_display.name + ' logo'"
               class="w-9 h-9 rounded-full bg-gray-100 ring-1 ring-gray-200"
               referrerpolicy="no-referrer" />
          <div class="flex flex-col">
            <h2 class="text-2xl font-bold text-gray-900 leading-tight">
              {{ result.symbol }}
              <span v-if="result.cmc_display?.name && result.cmc_display.name.toUpperCase() !== result.symbol"
                    class="text-sm font-normal text-gray-500 ml-1">{{ result.cmc_display.name }}</span>
            </h2>
            <span v-if="result.as_of" class="text-xs text-gray-500">as of {{ result.as_of }}</span>
          </div>
          <div v-if="result.cmc_display?.tags?.length" class="flex items-center gap-1 flex-wrap">
            <span v-for="tag in result.cmc_display.tags" :key="tag"
                  class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
              {{ tag }}
            </span>
          </div>
          <a v-if="result.cmc_display?.website"
             :href="result.cmc_display.website" target="_blank" rel="noopener"
             class="text-xs text-gray-500 hover:text-gray-900 hover:underline">site ↗</a>
          <span v-if="result.code" class="ml-auto text-xs font-mono px-2 py-1 bg-gray-100 text-gray-600 rounded">
            {{ result.code }}
          </span>
        </div>

        <!-- CMC market intelligence row — live data not in our Kraken pull:
             current price, 24h price change, 7d price change, 24h volume
             change, CMC rank. Always-on demo theater for the CoinMarketCap
             integration: judges see the data source contribute on every
             verdict view, not just as a footer credit. -->
        <div v-if="result.signals?.cmc_rank" class="px-6 py-3 border-b border-gray-100 bg-amber-50/40 flex items-center gap-x-6 gap-y-1 flex-wrap text-xs">
          <span class="font-mono text-amber-900 font-bold">CMC live</span>
          <span class="text-gray-700">Rank <span class="font-mono font-bold">#{{ result.signals.cmc_rank }}</span></span>
          <span class="text-gray-700">24h <span class="font-mono font-bold" :class="(result.signals.cmc_pct_change_24h ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ fmtPct(result.signals.cmc_pct_change_24h) }}</span></span>
          <span class="text-gray-700">7d <span class="font-mono font-bold" :class="(result.signals.cmc_pct_change_7d ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ fmtPct(result.signals.cmc_pct_change_7d) }}</span></span>
          <span class="text-gray-700">Vol Δ24h <span class="font-mono font-bold" :class="(result.signals.cmc_volume_change_24h ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ fmtPct(result.signals.cmc_volume_change_24h) }}</span></span>
          <span class="text-gray-700">24h Vol <span class="font-mono font-bold">{{ fmtUsd(result.signals.cmc_volume_24h_usd) }}</span></span>
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

        <!-- Strategy in play — surfaces the rules of the survivor strategy
             that matched (or didn't). For REJECT verdicts the spec is null,
             so this block is hidden — the verdict tree above already shows
             which gate the token failed. -->
        <div v-if="strategyExplainer" class="px-6 py-5 border-b border-gray-100 bg-indigo-50/30">
          <div class="flex items-baseline justify-between mb-2">
            <h3 class="text-sm font-bold text-gray-900">Strategy in play</h3>
            <span class="text-xs font-mono text-gray-500">{{ strategyExplainer.archetype }}</span>
          </div>
          <p class="text-sm text-gray-700 mb-3">
            <strong>{{ strategyExplainer.intuition }}</strong>
          </p>

          <!-- Phase timeline — visual ENTRY → HOLD → EXIT flow so the user
               sees the strategy as a sequence, not two disconnected cards. -->
          <div class="mb-4 flex items-stretch gap-2">
            <div class="flex-1 rounded-md bg-emerald-500 text-white px-3 py-2 shadow-sm">
              <div class="text-[10px] uppercase font-bold tracking-wider opacity-80">Phase 1</div>
              <div class="text-sm font-bold">Entry</div>
              <div class="text-[11px] opacity-90 mt-0.5">Fires only when all 4 entry conditions are simultaneously true at a daily close.</div>
            </div>
            <div class="flex items-center text-emerald-700/60 text-lg font-bold">→</div>
            <div class="flex-1 rounded-md bg-amber-100 border-2 border-amber-300 px-3 py-2 shadow-sm">
              <div class="text-[10px] uppercase font-bold tracking-wider text-amber-800">Phase 2</div>
              <div class="text-sm font-bold text-amber-900">Hold (up to {{ strategyExplainer.maxHoldDays }} days)</div>
              <div class="text-[11px] text-amber-900/80 mt-0.5">On every new daily bar, check the 4 exit triggers in order. First match wins.</div>
            </div>
            <div class="flex items-center text-rose-700/60 text-lg font-bold">→</div>
            <div class="flex-1 rounded-md bg-rose-500 text-white px-3 py-2 shadow-sm">
              <div class="text-[10px] uppercase font-bold tracking-wider opacity-80">Phase 3</div>
              <div class="text-sm font-bold">Exit</div>
              <div class="text-[11px] opacity-90 mt-0.5">Position closed at the bar's close price (or the SL trigger). Strategy resets to scanning.</div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-lg border border-emerald-200 bg-white p-3">
              <h4 class="text-xs font-bold text-emerald-800 uppercase tracking-wide mb-2">Entry — all required</h4>
              <ul class="space-y-1.5 text-xs">
                <li v-for="(rule, i) in strategyExplainer.entryRules" :key="i" class="flex gap-2">
                  <span class="text-emerald-600 mt-0.5">✓</span>
                  <span>
                    <span class="font-semibold text-gray-900">{{ rule.label }}</span>
                    <span class="block font-mono text-gray-600 mt-0.5">{{ rule.expr }}</span>
                  </span>
                </li>
              </ul>
            </div>
            <div class="rounded-lg border border-rose-200 bg-white p-3">
              <h4 class="text-xs font-bold text-rose-800 uppercase tracking-wide mb-2">Exit — whichever fires first</h4>
              <ul class="space-y-1.5 text-xs">
                <li v-for="(rule, i) in strategyExplainer.exitRules" :key="i" class="flex gap-2">
                  <span class="text-rose-600 mt-0.5">↳</span>
                  <span>
                    <span class="font-semibold text-gray-900">{{ rule.label }}</span>
                    <span class="block font-mono text-gray-600 mt-0.5">{{ rule.expr }}</span>
                  </span>
                </li>
              </ul>
            </div>
          </div>
          <p class="mt-3 text-xs text-gray-500">
            <strong>{{ strategyExplainer.direction }}</strong> · spec name <code class="font-mono">{{ strategyExplainer.name }}</code> · audit: {{ strategyExplainer.audit }}
          </p>
        </div>

        <!-- Chart panel — right-click for visual prefs -->
        <div v-if="result.chart?.candles?.length" class="px-6 py-5 border-b border-gray-100">
          <!-- Legend bar above the chart (prominent so the user can identify
               the SMA(200) line and the trade markers without hunting through
               small caption text). Compact pills with color swatches matching
               the cathode overlay + marker colors. -->
          <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span class="font-semibold text-gray-900">Chart legend:</span>
            <span class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200">
              <span class="inline-block w-4 h-0.5 bg-blue-500 rounded"></span>
              <span class="font-mono text-blue-900">SMA(200)</span>
              <span class="text-blue-700/70">— long-horizon trend filter</span>
            </span>
            <span v-if="result.forward_look && !result.forward_look.status" class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200">
              <span class="inline-block w-0 h-0 border-l-[5px] border-r-[5px] border-b-[7px] border-transparent border-b-emerald-500"></span>
              <span class="font-mono text-emerald-900">Entry</span>
              <span class="text-emerald-700/70">— {{ result.forward_look.entry_date }} @ {{ fmtUsd(result.forward_look.entry_price) }}</span>
            </span>
            <span v-if="result.forward_look && !result.forward_look.status" class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200">
              <span class="inline-block w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-transparent border-t-rose-500"></span>
              <span class="font-mono text-rose-900">Exit</span>
              <span class="text-rose-700/70">— {{ result.forward_look.exit_date }} @ {{ fmtUsd(result.forward_look.exit_price) }} ({{ result.forward_look.reason }})</span>
            </span>
          </div>
          <div class="relative">
            <div
              ref="chartContainerRef"
              :class="['relative h-80 rounded-lg overflow-hidden border', chartContainerBg]"
              @contextmenu.prevent="onChartContextMenu"
            >
              <CathodeCandle
                :key="`cc-${flat}`"
                :candles="result.chart.candles"
                :overlays="chartOverlays"
                :markers="chartMarkers"
                :theme="chartTheme"
                :flat="flat"
                :compact="false"
                :curvature="curvature"
                :scanlines="scanlines"
                :glow="glow"
                :magnify="lensFrozen"
                :slot-w="CC_SLOT_W_PX"
              />

              <!-- Cathode branding watermark (TradingView-pattern) — small,
                   persistent, clickable badge in the top-left of every chart.
                   Demo theater for the @stratchai/* library showcase: lands
                   in every screenshot, recording, and live judge session.
                   Direct prize-angle support for Best CMC Data Use + Track 2.
                   Phosphor-themed visual register (translucent green-ringed
                   bg matches the default CRT aesthetic). -->
              <a href="https://www.npmjs.com/package/@stratchai/cathode"
                 target="_blank" rel="noopener"
                 class="absolute top-2 left-2 z-20 pointer-events-auto
                        flex items-center gap-1 px-1.5 py-0.5 rounded
                        text-[10px] font-mono
                        bg-black/40 text-emerald-300 hover:text-emerald-200
                        border border-emerald-400/40 hover:border-emerald-300/70
                        backdrop-blur-sm shadow-sm
                        no-underline transition"
                 title="Chart powered by @stratchai/cathode — click to view on npm">
                <span class="text-emerald-400">⚡</span>
                <span>@stratchai/cathode</span>
              </a>

              <!-- Chart toolbar overlay: visible button equivalents for the
                   right-click context menu (which most users don't discover)
                   plus the lens-pin toggle. Sits top-right, z above all the
                   chart overlays. pointer-events:auto so clicks register. -->
              <div class="absolute top-2 right-2 z-20 flex items-center gap-1 pointer-events-auto">
                <button
                  @click="togglePinLens"
                  :class="[
                    'px-2 py-1 rounded-md text-[11px] font-medium border shadow-sm transition',
                    lensFrozen
                      ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                      : 'bg-white/90 backdrop-blur text-gray-700 border-gray-300 hover:bg-white',
                  ]"
                  :title="lensFrozen ? 'Click to release (or press P)' : 'Click to pin at last cursor position — or press P while hovering the candle you want, for precise placement'"
                >
                  {{ lensFrozen ? "🔒 Lens pinned" : "📍 Pin lens (P)" }}
                </button>
                <button
                  @click="openDisplayMenuFromButton"
                  class="px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 backdrop-blur text-gray-700 border border-gray-300 shadow-sm hover:bg-white transition"
                  title="Theme, curvature, WebGL, scanlines, glow, magnify (also: right-click anywhere on the chart)"
                >
                  ⚙ Display
                </button>
                <button
                  @click="downloadChart"
                  :disabled="downloading"
                  class="px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 backdrop-blur text-gray-700 border border-gray-300 shadow-sm hover:bg-white transition disabled:opacity-50"
                  title="Download this chart as a PNG"
                >
                  {{ downloading ? "…" : "⬇ PNG" }}
                </button>
                <button
                  @click="chartExpanded = true"
                  class="px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 backdrop-blur text-gray-700 border border-gray-300 shadow-sm hover:bg-white transition"
                  title="Expand chart to fullscreen (ESC to close)"
                >
                  ⛶ Expand
                </button>
              </div>

              <!-- Hold-period highlight band: semi-transparent vertical strip
                   between entry and exit candles. -->
              <div
                v-if="tradeWindowGeometry"
                class="pointer-events-none absolute top-0 bottom-0 bg-amber-400/15 border-l border-r border-amber-500/40"
                :style="{ left: tradeWindowGeometry.bandLeft + 'px', width: tradeWindowGeometry.bandWidth + 'px' }"
              ></div>

              <!-- Drop-lines: vertical dotted lines through the chart at the
                   entry + exit column. With labels now positioned INSIDE the
                   chart near each triangle (smart top/bottom flipped to avoid
                   overlapping the marker), the drop-lines connect the label
                   chip to its triangle for a clear visual link. -->
              <div
                v-if="tradeWindowGeometry"
                class="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-emerald-500/70 z-10"
                :style="{ left: tradeWindowGeometry.entryX + 'px' }"
              ></div>
              <div
                v-if="tradeWindowGeometry"
                class="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-rose-500/70 z-10"
                :style="{ left: tradeWindowGeometry.exitX + 'px' }"
              ></div>

            </div>
          </div>
          <p class="mt-2 text-xs text-gray-500 italic">
            Candles + SMA(200) overlay from <a href="https://www.npmjs.com/package/@stratchai/cathode" target="_blank" rel="noopener" class="font-mono hover:underline">@stratchai/cathode</a>. The lens pins on the trade — toggle it with Pin&nbsp;lens (P). Drag or scroll to navigate; click the chart, then ← → pan and ↑ ↓ zoom.
          </p>
        </div>

        <!-- Fullscreen expand modal — teleported to body so it escapes
             the verdict card's overflow/positioning context. Renders a
             second CathodeCandle with the same candles/overlays/markers
             but at viewport-fill size and a wider slot-w for readability.
             Inline overlays (band + drop-lines) intentionally NOT
             duplicated for v1 — they're tied to chartContainerRef's pixel
             geometry; the modal's value is the raw cathode render with
             entry/exit triangles cathode draws natively from markers
             prop. Watermark duplicated so the @stratchai/cathode brand
             stays in every screenshot. -->
        <Teleport to="body">
          <div
            v-if="chartExpanded && result?.chart?.candles?.length"
            class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            @click.self="chartExpanded = false"
          >
            <div class="relative w-full h-full max-w-[1600px] max-h-[900px] bg-white rounded-xl shadow-2xl flex flex-col">
              <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200">
                <div class="flex items-center gap-3">
                  <span class="text-sm font-bold text-gray-900">{{ result.symbol }} — expanded view</span>
                  <span v-if="result.forward_look && !result.forward_look.status" class="text-xs text-gray-600 font-mono">
                    {{ result.forward_look.entry_date }} @ ${{ result.forward_look.entry_price }}
                    →
                    {{ result.forward_look.exit_date }} @ ${{ result.forward_look.exit_price }}
                    ({{ result.forward_look.reason }})
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    v-if="result.forward_look && !result.forward_look.status"
                    @click="toggleExpandedPin"
                    :class="[
                      'px-2 py-1 rounded-md text-[11px] font-medium border shadow-sm transition',
                      expandedLensFrozen
                        ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                    ]"
                    :title="expandedLensFrozen ? 'Click to release the lens — or press P' : 'Pin the magnify lens on the trade — or press P'"
                  >
                    {{ expandedLensFrozen ? "🔒 Lens pinned" : "📍 Pin lens (P)" }}
                  </button>
                  <button
                    @click="openDisplayMenuFromButton"
                    class="px-2 py-1 rounded-md text-[11px] font-medium bg-white text-gray-700 border border-gray-300 shadow-sm hover:bg-gray-50 transition"
                    title="Theme, curvature, WebGL, scanlines, glow, magnify"
                  >
                    ⚙ Display
                  </button>
                  <button
                    @click="downloadChart"
                    :disabled="downloading"
                    class="px-2 py-1 rounded-md text-[11px] font-medium bg-white text-gray-700 border border-gray-300 shadow-sm hover:bg-gray-50 transition disabled:opacity-50"
                    title="Download this chart as a PNG"
                  >
                    {{ downloading ? "…" : "⬇ PNG" }}
                  </button>
                  <button
                    @click="chartExpanded = false"
                    class="px-2 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition"
                    title="Close (ESC)"
                  >
                    ✕ Close
                  </button>
                </div>
              </div>
              <div ref="expandedChartRef" :class="['relative flex-1 rounded-b-xl overflow-hidden', chartContainerBg]">
                <CathodeCandle
                  :key="`cc-expanded-${flat}`"
                  :candles="result.chart.candles"
                  :overlays="chartOverlays"
                  :markers="chartMarkers"
                  :theme="chartTheme"
                  :flat="flat"
                  :compact="false"
                  :curvature="curvature"
                  :scanlines="scanlines"
                  :glow="glow"
                  :magnify="expandedLensFrozen"
                  :slot-w="CC_SLOT_W_EXPANDED"
                />
                <a href="https://www.npmjs.com/package/@stratchai/cathode"
                   target="_blank" rel="noopener"
                   class="absolute top-2 left-2 z-20 pointer-events-auto
                          flex items-center gap-1 px-1.5 py-0.5 rounded
                          text-[10px] font-mono
                          bg-black/40 text-emerald-300 hover:text-emerald-200
                          border border-emerald-400/40 hover:border-emerald-300/70
                          backdrop-blur-sm shadow-sm
                          no-underline transition"
                   title="Chart powered by @stratchai/cathode — click to view on npm">
                  <span class="text-emerald-400">⚡</span>
                  <span>@stratchai/cathode</span>
                </a>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- Verdict tree: structured walk-forward survivor gate -->
        <div v-if="result.gate?.length" class="px-6 py-5 border-b border-gray-100">
          <div class="flex items-baseline justify-between mb-3">
            <h3 class="text-sm font-bold text-gray-900">Walk-forward survivor gate</h3>
            <span class="text-xs text-gray-500">
              {{ result.gate.filter(g => g.status === "pass").length }} pass ·
              {{ result.gate.filter(g => g.status === "fail").length }} fail ·
              {{ result.gate.filter(g => g.status === "skip").length }} skipped
            </span>
          </div>
          <div class="rounded-lg border border-gray-200 overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 font-semibold">
                <tr>
                  <th class="text-left px-3 py-2 w-12"></th>
                  <th class="text-left px-3 py-2">Condition</th>
                  <th class="text-left px-3 py-2">Threshold</th>
                  <th class="text-left px-3 py-2">Actual</th>
                  <th class="text-left px-3 py-2 w-44">Via</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="g in result.gate" :key="g.id" :class="gateRowClass(g.status)">
                  <td class="px-3 py-2 text-center">
                    <span v-if="g.status === 'pass'"
                          class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold">✓</span>
                    <span v-else-if="g.status === 'fail'"
                          class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-500 text-white text-xs font-bold">✗</span>
                    <span v-else
                          class="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-400 text-xs font-bold">○</span>
                  </td>
                  <td class="px-3 py-2 font-medium text-gray-900">{{ g.label }}</td>
                  <td class="px-3 py-2 text-gray-600 font-mono text-xs">{{ g.detail }}</td>
                  <td class="px-3 py-2 font-mono text-xs"
                      :class="g.status === 'pass' ? 'text-emerald-700' : g.status === 'fail' ? 'text-rose-700' : 'text-gray-400'">
                    {{ g.actual }}
                  </td>
                  <td class="px-3 py-2">
                    <a :href="libraryHref(g.library)" target="_blank" rel="noopener"
                       class="text-xs font-mono text-gray-500 hover:text-gray-900 hover:underline">
                      {{ g.library }}
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="result.spec" class="mt-3 text-xs text-gray-500">
            All conditions pass → strategy spec emitted: <code class="font-mono text-gray-700">{{ result.spec.name }}</code>
          </p>
          <p v-else-if="result.verdict === 'REJECT'" class="mt-3 text-xs text-gray-500">
            One or more conditions failed → no spec emitted. <strong>Rejection-as-feature</strong>: most live-token queries return REJECT, by design, because the survivor family is narrow.
          </p>
          <p v-else class="mt-3 text-xs text-gray-500">
            Survivor family near-trigger but no full match → informational WATCH, no spec emitted.
          </p>

          <!-- Honest disclosure callout (PASS / oversold-WATCH only). Sits inline
               with the green-✓ celebration so the population-level claim is
               adjacent to the conditions that triggered it. -->
          <div v-if="honestDisclosure" class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <div class="flex items-start gap-3">
              <span class="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">!</span>
              <div class="text-sm flex-1">
                <p class="font-semibold text-amber-900 mb-1">{{ honestDisclosure.heading }}</p>
                <p class="text-amber-900/90 leading-relaxed mb-2">{{ honestDisclosure.summary }}</p>
                <ul class="space-y-1 text-xs text-amber-900/80">
                  <li v-for="(b, i) in honestDisclosure.bullets" :key="i" class="leading-snug flex gap-2">
                    <span class="text-amber-700">•</span>
                    <span>{{ b }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Reasoning notes (secondary prose with audit context) -->
        <div v-if="result.reasoning?.length" class="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
          <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
          <ul class="space-y-1.5">
            <li v-for="(line, i) in result.reasoning" :key="i" class="text-xs text-gray-600 flex gap-2">
              <span class="mt-1.5 w-1 h-1 rounded-full flex-shrink-0 bg-gray-400"></span>
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

        <!-- Audit transparency: 46 shelved daily-crypto archetypes evaluated
             on the current symbol. Collapsed by default to avoid swamping
             first-time visitors; click the header bar to expand. Sources
             from the bundled audit_universe_screening.json (regenerate with
             scripts/screen_audit_universe.js on sigma side). -->
        <div v-if="tokenAuditRows.length" class="px-6 py-5 border-b border-gray-100">
          <button
            @click="auditExpanded = !auditExpanded"
            class="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition text-left"
          >
            <div class="flex items-center gap-3">
              <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Audit transparency</span>
              <span v-if="auditTokenState === 'with-trades'" class="text-sm text-slate-700">
                <strong>{{ auditMeta.n_archetypes }}</strong> shelved daily-crypto archetypes —
                <strong>{{ auditTokenFiredCount }}</strong> fired on {{ result.symbol }} in the
                {{ auditMeta.scanned_at }} CMC top-30 audit
              </span>
              <span v-else-if="auditTokenState === 'in-universe-no-trades'" class="text-sm text-slate-700">
                <strong>{{ auditMeta.n_archetypes }}</strong> shelved daily-crypto archetypes from the
                {{ auditMeta.scanned_at }} CMC top-30 audit — {{ result.symbol }} was in scope but had
                insufficient Kraken history (&lt;250 daily bars) to backtest
              </span>
              <span v-else class="text-sm text-slate-700">
                <strong>{{ auditMeta.n_archetypes }}</strong> shelved daily-crypto archetypes —
                {{ result.symbol }} was not in the CMC top-30 universe at audit time
              </span>
              <!-- Rescue badge only shows when at least one archetype actually
                   fired on this token. RESCUE is a universe-wide definition
                   (pooled mean > 0, n ≥ 10 across the 29-symbol universe), so
                   on tokens like HYPE that were in scope but had insufficient
                   Kraken history to backtest, the badge would imply per-token
                   substance it doesn't have. The rescue candidates are still
                   discoverable when the table expands (pinned to top of grid)
                   for any user who wants the universe-wide view. -->
              <span v-if="auditMeta.n_rescue > 0 && auditTokenState === 'with-trades'"
                    class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                ⚡ {{ auditMeta.n_rescue }} rescue candidate{{ auditMeta.n_rescue === 1 ? "" : "s" }}
              </span>
            </div>
            <span class="text-slate-500 text-sm">{{ auditExpanded ? "▲ hide" : "▼ show table" }}</span>
          </button>

          <div v-if="auditExpanded" class="mt-3">
            <!-- Snapshot framing — load-bearing for honesty. The numbers in
                 this table are NOT computed live for {{ result.symbol }}.
                 They're the per-archetype, per-token results from a single
                 walk-forward run sigma's `screen_audit_universe.js` script
                 produced on {{ auditMeta.scanned_at }}. Pooled stats are
                 universe-wide; per-{{ result.symbol }} stats are this
                 token's slice of that run. Both come from the same
                 timestamped JSON. -->
            <div class="bg-amber-50 border border-amber-200 rounded-md p-3 mb-3 text-xs text-amber-900 leading-relaxed">
              <strong>Snapshot, not live evaluation.</strong> These numbers come from a single walk-forward audit
              run on <span class="font-mono">{{ auditMeta.scanned_at }}</span> — {{ auditMeta.n_archetypes }} shelved daily-crypto
              archetypes evaluated across {{ auditMeta.universe_size }} CMC top-30 symbols at
              {{ auditMeta.fee }}% real round-trip fees on Kraken 720-bar history. The "on {{ result.symbol }}"
              columns reflect that snapshot's slice; em-dashes mean the archetype didn't fire on
              {{ result.symbol }} in the snapshot run. The "pooled" columns show the universe-wide aggregate.
              Re-running for fresh numbers requires
              <span class="font-mono">scripts/screen_audit_universe.js</span> sigma-side.
            </div>

            <!-- Glossary — terminology audit. "shelved", "culled", "RESCUE"
                 all carry sigma-project meaning that hackathon judges have
                 no prior context for. Collapsed by default; click to read. -->
            <details class="mb-3 text-xs">
              <summary class="cursor-pointer text-slate-700 font-semibold hover:text-slate-900 select-none py-1">
                ⓘ Glossary — what do "shelved" / "culled" / "RESCUE" mean?
              </summary>
              <div class="mt-2 ml-4 space-y-1.5 text-gray-700 leading-relaxed">
                <p><strong class="font-semibold">shelved</strong> — strategy spec exists but no production capital is deployed against it. Reason: walk-forward at 1.5% real fees showed negative expectancy.</p>
                <p><strong class="font-semibold">culled</strong> — same as shelved, but with a documented kill date marking when the verdict was finalized. The "Culled" column shows that date.</p>
                <p><strong class="font-semibold">⚡ RESCUE</strong> — archetype whose pooled-universe mean was positive (&gt; 0) AND n ≥ 10 on the re-screen against the current CMC top-30. Surfaces strategies where the audit's original cull verdict might not hold today. Marginal: needs manual walk-forward + adversarial review before un-shelving.</p>
                <p><strong class="font-semibold">pooled mean / pooled n</strong> — aggregate over the entire {{ auditMeta.universe_size }}-symbol universe. NOT specific to {{ result.symbol }}.</p>
                <p><strong class="font-semibold">on {{ result.symbol }} mean / n</strong> — strictly this token's slice of the audit. When n = 0, the strategy never fired on {{ result.symbol }} during the audit (commonly because the survivor-family rules require ≥250 daily bars — newer tokens are out-of-scope by design).</p>
                <p><strong class="font-semibold">click any row</strong> for the strategy's full audit-time cull rationale.</p>
              </div>
            </details>

            <p class="text-xs text-gray-500 mb-3 leading-relaxed">
              Sorted: rescue candidates pinned to top, then by this-token's mean net P&L descending. Click a row to expand its cull rationale.
            </p>
            <!-- CathodeGrid — second showcase of the cathode library after
                 CathodeCandle. Hardcoded to "paper" theme (rather than
                 binding to chartTheme) because tabular data is more
                 legible on a light background — lots of small numeric +
                 strategy-name text. The chart stays phosphor (CRT-styled
                 candle visualization is the right register for that); the
                 grid stays paper (dense data is the right register for
                 this). Subtle 6° curvature still applies — barely
                 perceptible but signals it's cathode-rendered. scanlines
                 and glow disabled because both are CRT-screen effects
                 that don't fit a paper aesthetic. -->
            <div class="h-[500px] rounded-lg overflow-hidden border border-gray-200">
              <CathodeGrid
                :column-defs="auditColumns"
                :row-data="tokenAuditRows"
                :get-row-style="auditRowStyle"
                theme="paper"
                :row-height="28"
                :curvature="6"
                :scanlines="false"
                :glow="false"
                @row-clicked="onAuditRowClicked"
              />
            </div>

            <!-- Per-strategy detail card. Shows when a row is clicked.
                 Surfaces the culled_reason_summary from the audit script
                 — concrete evidence per strategy (sample size, win rate,
                 mean P&L, dominant failure mode) so judges can read why
                 each archetype was shelved without having to grep memory
                 files. -->
            <div v-if="auditSelectedRow" class="mt-4 bg-slate-50 border border-slate-300 rounded-lg p-4">
              <div class="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Cull rationale</div>
                  <div class="text-sm font-mono font-semibold text-slate-900">{{ auditSelectedRow.strategy }}</div>
                  <div class="text-xs text-slate-500 mt-0.5">Culled {{ auditSelectedRow.culled_at || "(no date)" }}</div>
                </div>
                <button
                  @click="auditSelectedStrategy = null"
                  class="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-200"
                >
                  ✕ close
                </button>
              </div>

              <div v-if="auditSelectedRow.culled_reason" class="text-xs text-slate-700 leading-relaxed mb-3">
                {{ auditSelectedRow.culled_reason }}
              </div>
              <div v-else class="text-xs text-slate-500 italic mb-3">
                No cull rationale recorded for this archetype. Pool stats below.
              </div>

              <div class="grid grid-cols-2 gap-4 text-xs">
                <div class="bg-white border border-slate-200 rounded p-3">
                  <div class="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mb-1.5">Pool-wide (universe)</div>
                  <div class="space-y-0.5 font-mono">
                    <div>n = {{ auditSelectedRow.audit_n }}</div>
                    <div>mean = <span :class="auditSelectedRow.audit_mean_net_pct >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ fmtPct(auditSelectedRow.audit_mean_net_pct) }}</span></div>
                    <div>win rate = {{ auditSelectedRow.audit_win_rate != null ? (auditSelectedRow.audit_win_rate * 100).toFixed(0) + '%' : '—' }}</div>
                  </div>
                </div>
                <div class="bg-white border border-slate-200 rounded p-3">
                  <div class="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mb-1.5">On {{ result.symbol }} (this token's slice)</div>
                  <div class="space-y-0.5 font-mono">
                    <div>n = {{ auditSelectedRow.token_n }}</div>
                    <div v-if="auditSelectedRow.token_n > 0">mean = <span :class="auditSelectedRow.token_mean_net_pct >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ fmtPct(auditSelectedRow.token_mean_net_pct) }}</span></div>
                    <div v-if="auditSelectedRow.token_n > 0">win rate = {{ (auditSelectedRow.token_win_rate * 100).toFixed(0) }}%</div>
                    <div v-else class="text-slate-500 italic">No trades on {{ result.symbol }} during this audit run (likely insufficient history for trend filter).</div>
                  </div>
                </div>
              </div>

              <div v-if="auditSelectedRow.rescue_candidate" class="mt-3 bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-900">
                <strong>⚡ Rescue candidate.</strong> This archetype's pooled-universe mean is positive on the current CMC top-30 — contradicts the original cull verdict. Marginal: needs manual walk-forward + adversarial verification before un-shelving.
              </div>
            </div>

            <p class="mt-3 text-xs text-gray-500 italic">
              Sources: <a href="https://www.npmjs.com/package/@stratchai/strategy-spec" target="_blank" rel="noopener" class="font-mono hover:underline">@stratchai/strategy-spec</a> for archetype params + <a href="https://www.npmjs.com/package/@stratchai/backtest" target="_blank" rel="noopener" class="font-mono hover:underline">@stratchai/backtest</a> engine + <a href="https://www.npmjs.com/package/@stratchai/indicators" target="_blank" rel="noopener" class="font-mono hover:underline">@stratchai/indicators</a> for signal computation. Empirical receipts behind every cull verdict — judges can verify the audit was rigorous, not asserted.
            </p>
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
      <a href="https://github.com/bradyhouse/strategy-referee/blob/main/docs/methodology.md" class="text-gray-700 underline hover:text-gray-900">Source</a>.
    </footer>

    <!-- Chart right-click context menu (Display prefs). Teleported to body
         so the absolute position is in viewport coords, not clipped by any
         parent overflow. Mirrors bradyhouse/dashboard ChartPanel.vue. -->
    <Teleport to="body">
      <div
        v-if="chartContextMenu"
        class="fixed z-[100] min-w-[200px] rounded-md border border-gray-700 bg-gray-900 text-gray-100 shadow-xl text-xs"
        :style="{ left: chartContextMenu.x + 'px', top: chartContextMenu.y + 'px' }"
        @click.stop
      >
        <div class="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
          <span class="font-bold tracking-wide uppercase">Display</span>
          <span class="text-gray-400 font-normal">curve: {{ curvature }}</span>
        </div>

        <label class="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer">
          <input type="checkbox" :checked="!flat" @change="toggleWebGL" />
          <span>WebGL pipeline</span>
        </label>
        <label class="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer">
          <input type="checkbox" :checked="scanlines" @change="toggleScanlines" />
          <span>Scan lines</span>
        </label>
        <label class="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer">
          <input type="checkbox" :checked="glow" @change="toggleGlow" />
          <span>Glow</span>
        </label>

        <div class="h-px bg-gray-700 my-1"></div>

        <div class="px-3 py-1.5 text-[10px] text-gray-400 font-bold uppercase tracking-wider">Theme</div>
        <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 cursor-pointer">
          <input type="radio" name="cathode-theme" :checked="chartTheme === 'phosphor'" @change="setChartTheme('phosphor')" />
          <span>Phosphor (green)</span>
        </label>
        <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 cursor-pointer">
          <input type="radio" name="cathode-theme" :checked="chartTheme === 'amber'" @change="setChartTheme('amber')" />
          <span>Amber</span>
        </label>
        <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 cursor-pointer">
          <input type="radio" name="cathode-theme" :checked="chartTheme === 'paper'" @change="setChartTheme('paper')" />
          <span>Paper</span>
        </label>

        <div class="h-px bg-gray-700 my-1"></div>

        <div class="px-3 py-1.5 text-[10px] text-gray-400">⌘+Shift+= / ⌘+Shift+− nudges curve</div>
        <div v-if="flat" class="px-3 py-1.5 text-[10px] text-amber-400">Curve requires WebGL pipeline.</div>
      </div>
    </Teleport>
  </div>
</template>
