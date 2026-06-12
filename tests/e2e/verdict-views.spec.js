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
  test("PASS verdict on ETH 2025-09-25 preset", async ({ page }) => {
    await page.goto("/");
    // Click the prominent preset chip; this should fire a guaranteed PASS.
    await page.getByRole("button", { name: /ETH · 2025-09-25/ }).click();
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

    await page.screenshot({ path: "tests/e2e/screenshots/pass-eth-full.png", fullPage: true });
  });

  test("ETH chart region — labels above chart, triangles inside", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /ETH · 2025-09-25/ }).click();
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
      path: "tests/e2e/screenshots/pass-eth-chart.png",
      clip: { x: 0, y: cropY, width: 1440, height: 480 },
    });

    // Both price labels must be visible
    await expect(page.locator("text=▲ ENTRY").first()).toBeVisible();
    await expect(page.locator("text=▼ EXIT").first()).toBeVisible();
  });

  // SOL is the canonical worst case for label-vs-triangle overlap: the exit
  // price ($213.01) sits near the TOP of the visible chart range, so any
  // label drawn inside the chart at the top would crash into the down-
  // triangle. This test guards the 2026-06-12 label-restructure fix.
  test("SOL chart — label/triangle overlap (worst case)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /SOL · 2025-09-25/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    const chartLegendBar = page.getByText("Chart legend:").first();
    await chartLegendBar.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const legendBox = await chartLegendBar.boundingBox();
    const cropY = legendBox ? Math.max(0, legendBox.y - 16) : 600;
    await page.screenshot({
      path: "tests/e2e/screenshots/pass-sol-chart.png",
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
    // Default token is ETH; switch to BTC and submit with blank date for
    // real-time eval. Bare BTC should reject for BELOW_SMA200 in current
    // market conditions.
    await page.getByPlaceholder(/BTC|ETH/).fill("BTC");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.waitForTimeout(3000);

    await expect(page.locator("text=/^REJECT$/").first()).toBeVisible();
    // No honest-disclosure callout on REJECT (gate-failure is the message)
    await expect(page.getByText("What PASS actually means")).toHaveCount(0);
    // The rejection-as-feature footer should show
    await expect(page.getByText("Rejection-as-feature")).toBeVisible();

    await page.screenshot({ path: "tests/e2e/screenshots/reject-btc-full.png", fullPage: true });
  });

  test("Pin-lens survives toolbar hover", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /ETH · 2025-09-25/ }).click();
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
