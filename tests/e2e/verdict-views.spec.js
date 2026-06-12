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
  test("PASS verdict on TON 2026-05-24 preset", async ({ page }) => {
    await page.goto("/");
    // Click the prominent preset chip; this should fire a guaranteed PASS.
    await page.getByRole("button", { name: /TON · 2026-05-24/ }).click();
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
  });

  test("TON chart region — labels above chart, triangles inside", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /TON · 2026-05-24/ }).click();
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
    await page.getByRole("button", { name: /TON · 2026-05-24/ }).click();
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
