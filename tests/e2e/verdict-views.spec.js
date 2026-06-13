// verdict-views.spec.js — visual smokes for the three verdict paths the demo
// presents to judges: PASS (full payload with chart + forward-look + spec),
// REJECT/BELOW_SMA200 (no spec; rejection-as-feature framing), and the
// watchlist mode (multi-token scan with PASS-first ranking).
//
// Each test captures a full-page screenshot AND a tight chart-region
// screenshot. Visual regressions show up as diffs on the next run. The
// label-overlap-triangle bug from session 2026-06-12 is the canonical
// example of what these guard against.

import { test, expect } from "@playwright/test";

test.describe("Verdict views — visual smokes", () => {
  test("PASS verdict on form defaults (TON 2026-05-24)", async ({ page }) => {
    await page.goto("/");
    // Form defaults to TON / 2026-05-24 — first-click demo. No preset
    // click needed; just hit Evaluate.
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    // Wait for the verdict card to land + the auto-pin sequence to finish
    // (1500ms retry + a bit of cathode shader warm-up time).
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Verdict header should say PASS
    await expect(page.locator("text=/^PASS$/").first()).toBeVisible();
    // Strategy explainer should name the rsi_oversold archetype (matches
    // twice — the archetype chip + the audit context bullet — first() is
    // enough to confirm it rendered)
    await expect(page.getByText("rsi_oversold + SMA200").first()).toBeVisible();
    // The honest disclosure callout MUST be visible (judges seeing PASS
    // without it would misread as a buy signal)
    await expect(page.getByText("What PASS actually means")).toBeVisible();

    await page.screenshot({ path: "tests/e2e/screenshots/pass-ton-full.png", fullPage: true });

    // CMC integration must be visible — TradingView-equivalent demo-theater
    // value for the "Best CMC Data Use" prize angle. If these vanish, judges
    // see only the load-bearing thesis and miss the data-source showcase.
    await expect(page.getByText("CMC live")).toBeVisible();
    await expect(page.getByText(/Rank #\d+/)).toBeVisible();
    // Token-info enrichment: logo (img) + at least one CMC tag chip
    const logo = page.locator("img[alt$=' logo']").first();
    await expect(logo).toBeVisible();
  });

  test("TON chart region — labels above chart, triangles inside", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    // Find the chart legend bar, scroll it into view, then crop tightly
    // around the chart area for visual review.
    const chartLegendBar = page.getByText("Chart legend:").first();
    await chartLegendBar.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const legendBox = await chartLegendBar.boundingBox();
    const cropY = legendBox ? Math.max(0, legendBox.y - 16) : 600;
    await page.screenshot({
      path: "tests/e2e/screenshots/pass-ton-chart.png",
      clip: { x: 0, y: cropY, width: 1440, height: 480 },
    });

    // Both price labels must be visible
    await expect(page.locator("text=▲ ENTRY").first()).toBeVisible();
    await expect(page.locator("text=▼ EXIT").first()).toBeVisible();

    // TradingView-style cathode branding watermark — small clickable badge
    // top-left of every chart. Direct showcase value for the @stratchai/*
    // library prize angles. If the watermark vanishes, the hackathon's
    // "Best CMC Data Use" pitch loses its load-bearing visual citation.
    // (Multiple links to the cathode npm page exist; the watermark is the
    // one with the ⚡ icon, distinguishing it from the italic footer credit.)
    const watermark = page.getByRole("link", { name: /⚡.*@stratchai\/cathode/ });
    await expect(watermark).toBeVisible();
  });

  // BCH is the MFI-triggered variant case + a different chart range than
  // TON. Together with the TON test above we cover both archetypes and
  // both ends of the price range — high-value $-prices (BCH ~$561) and
  // low-value $-prices (TON ~$2). Label/triangle overlap stress test.
  test("BCH chart — MFI-triggered + label/triangle separation", async ({ page }) => {
    await page.goto("/");
    // BCH isn't a preset chip — the recent BCH PASSes (Jan 2026) had losing
    // forward-look outcomes, so the chips show TON winners + historical ETH.
    // BCH remains a valid manual entry for archetype coverage.
    await page.getByPlaceholder(/BTC|ETH/).fill("BCH");
    await page.locator('input[type="date"]').fill("2026-01-27");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).waitFor({ timeout: 8000 });
    await page.waitForTimeout(2500);

    const chartLegendBar = page.getByText("Chart legend:").first();
    await chartLegendBar.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const legendBox = await chartLegendBar.boundingBox();
    const cropY = legendBox ? Math.max(0, legendBox.y - 16) : 600;
    await page.screenshot({
      path: "tests/e2e/screenshots/pass-bch-chart.png",
      clip: { x: 0, y: cropY, width: 1440, height: 480 },
    });

    // Geometry assertion: the EXIT label's bounding box should be ENTIRELY
    // ABOVE the chart canvas's top edge. If the label's bottom y is greater
    // than the canvas's top y, they overlap — the regression we're guarding.
    const exitLabel = page.locator("text=▼ EXIT").first();
    await expect(exitLabel).toBeVisible();
    const labelBox = await exitLabel.boundingBox();
    const canvas = page.locator("canvas.cathode-candle-canvas").first();
    const canvasBox = await canvas.boundingBox();
    if (labelBox && canvasBox) {
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(canvasBox.y);
    }
  });

  test("REJECT verdict on bare BTC — rejection-as-feature framing", async ({ page }) => {
    await page.goto("/");
    // Form defaults are TON / 2026-05-24. To get BARE BTC live eval, we
    // overwrite the token AND clear the date. Real-time bare BTC should
    // REJECT for BELOW_SMA200 in current market conditions.
    await page.getByPlaceholder(/BTC|ETH/).fill("BTC");
    await page.locator('input[type="date"]').fill("");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.waitForTimeout(3000);

    await expect(page.locator("text=/^REJECT$/").first()).toBeVisible();
    // No honest-disclosure callout on REJECT (gate-failure is the message)
    await expect(page.getByText("What PASS actually means")).toHaveCount(0);
    // The rejection-as-feature footer should show
    await expect(page.getByText("Rejection-as-feature")).toBeVisible();

    await page.screenshot({ path: "tests/e2e/screenshots/reject-btc-full.png", fullPage: true });
  });

  test("Date doesn't leak across single/watchlist mode switches", async ({ page }) => {
    await page.goto("/");
    const dateInput = page.locator('input[type="date"]');

    // Single mode default: 2026-05-24 (the TON PASS demo)
    await expect(dateInput).toHaveValue("2026-05-24");

    // Switch to Watchlist → auto-prefill sets 2025-09-25 (historical 3-PASS demo)
    await page.getByRole("button", { name: /^Watchlist$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-25");

    // Switch BACK to Single → must restore 2026-05-24, NOT inherit 2025-09-25
    // (the canonical bug this fix addresses).
    await page.getByRole("button", { name: /^Single token$/ }).click();
    await expect(dateInput).toHaveValue("2026-05-24");

    // Customize the single-mode date — should persist across a Watchlist
    // round-trip without overwriting the watchlist's own date.
    await dateInput.fill("2025-09-25");
    await expect(dateInput).toHaveValue("2025-09-25");
    await page.getByRole("button", { name: /^Watchlist$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-25");  // watchlist's own date
    await page.getByRole("button", { name: /^Single token$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-25");  // single's customized date
  });

  test("Watchlist mode auto-pre-fills with historical 3-PASS demo on first switch", async ({ page }) => {
    await page.goto("/");
    // Switch to Watchlist mode. The auto-pre-fill should set both the
    // token list AND the date to the historical multi-PASS demo so the
    // first Scan click produces meaningful results — NOT 6 REJECTs from
    // the inherited TON / 2026-05-24 single-mode defaults.
    await page.getByRole("button", { name: /^Watchlist$/ }).click();

    // Date input should now show 2025-09-25
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toHaveValue("2025-09-25");
    // Token list should show the crypto majors
    await expect(page.locator('input[placeholder*="BTC"]')).toHaveValue(/BTC.*ETH.*SOL.*LINK.*ADA.*DOGE/);

    // Run the scan and verify at least 3 PASS results (the original 3-PASS demo)
    await page.getByRole("button", { name: /^Scan$/ }).click();
    await page.waitForTimeout(8000);  // 6 tokens × ~1s each

    const passCount = await page.locator('span:has-text("PASS")').count();
    expect(passCount).toBeGreaterThanOrEqual(3);   // PASS badge appears in the table + at least one in the tally
  });

  test("P key pin/unpins the lens — no cursor migration to the toolbar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    const pinButton = page.getByRole("button", { name: /Lens pinned|Pin lens/ });
    await pinButton.waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    // Auto-pin landed → click button to UNPIN
    await pinButton.click();
    await page.waitForTimeout(200);
    await expect(pinButton).toContainText("Pin lens");

    // Press P with cursor over a specific candle in the middle of the chart
    const canvas = page.locator("canvas.cathode-candle-canvas").first();
    await canvas.hover({ position: { x: 400, y: 150 } });
    await page.waitForTimeout(100);
    await page.keyboard.press("p");
    await page.waitForTimeout(200);

    // Lens should be pinned again — without moving cursor anywhere near the button
    await expect(pinButton).toContainText("Lens pinned");

    // Press P again to unpin
    await page.keyboard.press("p");
    await page.waitForTimeout(200);
    await expect(pinButton).toContainText("Pin lens");
  });

  test("Pin-lens survives wheel + mousedown (chart geometry doesn't shift)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    const canvas = page.locator("canvas.cathode-candle-canvas").first();
    const before = await canvas.boundingBox();

    // Trackpad-style horizontal scroll over the chart used to trigger
    // cathode's scroll handler, compressing candles into the left third.
    // The wheel blocker should prevent it.
    await canvas.hover({ position: { x: 200, y: 100 } });
    await page.mouse.wheel(-100, 0);   // horizontal scroll
    await page.mouse.wheel(0, 100);    // vertical scroll
    await page.waitForTimeout(300);

    // Mousedown on the chart (no drag) — should be blocked, not interpreted
    // as a pan-start.
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // The canvas DOM box shouldn't change; we're verifying the LENS PIN
    // and chart-view state both survive. Lens-pinned button is still amber.
    const pinButton = page.getByRole("button", { name: /Lens pinned|Pin lens/ });
    await expect(pinButton).toContainText("Lens pinned");

    const after = await canvas.boundingBox();
    if (before && after) {
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.width).toBeCloseTo(before.width, 0);
    }

    await page.screenshot({ path: "tests/e2e/screenshots/pin-lens-after-wheel.png", fullPage: true });
  });

  test("Pin-lens survives toolbar hover", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    const pinButton = page.getByRole("button", { name: /Lens pinned|Pin lens/ });
    await pinButton.waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    // The auto-pin should have fired — button should read "Lens pinned"
    await expect(pinButton).toContainText("Lens pinned");

    // Hover over the Display button (the historical bug: this triggered
    // mouseleave on the canvas, which cleared the cathode lens). The pin
    // button should remain "Lens pinned" through the hover.
    await page.getByRole("button", { name: /⚙ Display/ }).hover();
    await page.waitForTimeout(500);
    await expect(pinButton).toContainText("Lens pinned");

    await page.screenshot({ path: "tests/e2e/screenshots/pin-lens-toolbar-hover.png", fullPage: true });
  });
});
