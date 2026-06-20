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
  test("PASS verdict on form defaults (ETH 2025-09-28)", async ({ page }) => {
    await page.goto("/");
    // Form defaults to ETH / 2025-09-28 — first-click demo. No preset
    // click needed; just hit Evaluate. (TON was the default until
    // 2026-06-18 when CMC rebranded Toncoin → Gram and broke the
    // symbol=TON lookup; ETH is canonical / non-rebrand-prone.)
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

    await page.screenshot({ path: "tests/e2e/screenshots/pass-eth-full.png", fullPage: true });

    // CMC integration must be visible — TradingView-equivalent demo-theater
    // value for the "Best CMC Data Use" prize angle. If these vanish, judges
    // see only the load-bearing thesis and miss the data-source showcase.
    await expect(page.getByText("CMC live")).toBeVisible();
    await expect(page.getByText(/Rank #\d+/)).toBeVisible();
    // Token-info enrichment: logo (img) + at least one CMC tag chip
    const logo = page.locator("img[alt$=' logo']").first();
    await expect(logo).toBeVisible();
  });

  test("ETH chart region — entry/exit prices in chart legend bar", async ({ page }) => {
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
      path: "tests/e2e/screenshots/pass-eth-chart.png",
      clip: { x: 0, y: cropY, width: 1440, height: 480 },
    });

    // Entry + exit prices live in the chart legend bar above the canvas
    // (in-chart chips were removed — they crowded the triangles). Legend
    // pill text is "— <date> @ <price>" for each side. ETH 2025-09-28 is
    // the form's default; entry $4145.33 → PROFIT_FLOOR exit $4688.96 on
    // 2025-10-06 is the canonical PASS-on-defaults demo.
    await expect(page.locator("text=/2025-09-28 @ \\$4145\\.33/").first()).toBeVisible();
    await expect(page.locator("text=/2025-10-06 @ \\$4688\\.96/").first()).toBeVisible();

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
  // ETH. Together with the ETH test above we cover both archetypes and
  // both ends of the price range — mid-value $-prices (BCH ~$600) and
  // high-value $-prices (ETH ~$4145).
  test("BCH chart — MFI-triggered archetype, distinct price range", async ({ page }) => {
    await page.goto("/");
    // BCH isn't a preset chip — the recent BCH PASSes (Jan 2026) had losing
    // forward-look outcomes, so the chips show only PROFIT_FLOOR winners
    // (BTC + SOL @ 2025-09-26). BCH remains a valid manual entry for
    // archetype coverage (MFI-triggered + SL forward-look).
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

    // Legend bar carries the entry + exit price citations now that the
    // in-chart chips are removed. BCH's exit hit the stop-loss — verify
    // the (SL) suffix is in the legend pill.
    await expect(page.locator("text=/\\(SL\\)/").first()).toBeVisible();
  });

  test("REJECT verdict on bare BTC — rejection-as-feature framing", async ({ page }) => {
    await page.goto("/");
    // Form defaults are ETH / 2025-09-28. To get BARE BTC live eval, we
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

    // Single mode default: 2025-09-28 (the ETH PASS demo)
    await expect(dateInput).toHaveValue("2025-09-28");

    // Switch to Watchlist → auto-prefill sets 2025-09-25 (historical 3-PASS demo)
    await page.getByRole("button", { name: /^Watchlist$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-25");

    // Switch BACK to Single → must restore 2025-09-28, NOT inherit 2025-09-25
    // (the canonical bug this fix addresses).
    await page.getByRole("button", { name: /^Single token$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-28");

    // Customize the single-mode date — should persist across a Watchlist
    // round-trip without overwriting the watchlist's own date.
    await dateInput.fill("2025-09-26");
    await expect(dateInput).toHaveValue("2025-09-26");
    await page.getByRole("button", { name: /^Watchlist$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-25");  // watchlist's own date
    await page.getByRole("button", { name: /^Single token$/ }).click();
    await expect(dateInput).toHaveValue("2025-09-26");  // single's customized date
  });

  test("Watchlist mode auto-pre-fills with historical 3-PASS demo on first switch", async ({ page }) => {
    await page.goto("/");
    // Switch to Watchlist mode. The auto-pre-fill should set both the
    // token list AND the date to the historical multi-PASS demo so the
    // first Scan click produces meaningful results — NOT REJECTs from
    // the inherited ETH / 2025-09-28 single-mode defaults bleeding into
    // watchlist mode.
    await page.getByRole("button", { name: /^Watchlist$/ }).click();

    // Date input should now show 2025-09-25
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toHaveValue("2025-09-25");
    // Token list should show the crypto majors
    await expect(page.locator('input[placeholder*="BTC"]')).toHaveValue(/BTC.*ETH.*SOL.*LINK.*ADA.*DOGE/);

    // Run the scan and verify at least 3 PASS results (the original 3-PASS demo)
    await page.getByRole("button", { name: /^Scan$/ }).click();
    await page.waitForTimeout(8000);  // 6 tokens × ~1s each

    // CathodeGrid renders cell badges outside the regular DOM text (cells
    // are rendered via internal component instances, not text nodes
    // Playwright can query). The verdict tally pill above the grid IS in
    // regular DOM though and reads from the same source data — assert
    // that to verify the scan produced 3 PASS results.
    const tallyPass = page.locator(".bg-emerald-100").filter({ hasText: "PASS" });
    await expect(tallyPass).toBeVisible();
    await expect(tallyPass).toContainText("3");

    await page.screenshot({ path: "tests/e2e/screenshots/watchlist-grid.png", fullPage: true });
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

  test("Pin-lens stays pinned through navigation (wheel + drag)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    const canvas = page.locator("canvas.cathode-candle-canvas").first();
    const box = await canvas.boundingBox();

    // Navigation is now ALLOWED while the lens is pinned (the pin only freezes
    // the lens position, not the chart view). Wheel-zoom and drag-pan should
    // work AND the lens must remain pinned through them — the pin blocks only
    // the lens-follow events (mousemove/leave), not mousedown/wheel.
    await canvas.hover({ position: { x: 200, y: 100 } });
    await page.mouse.wheel(0, -200);   // zoom in
    await page.waitForTimeout(300);
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // The lens must still be pinned after navigating — interacting with the
    // chart doesn't accidentally release the pin.
    const pinButton = page.getByRole("button", { name: /Lens pinned|Pin lens/ });
    await expect(pinButton).toContainText("Lens pinned");

    // The canvas DOM element keeps its layout box (only its rendered content
    // changes under navigation, not the element's size/position).
    const after = await canvas.boundingBox();
    if (box && after) {
      expect(after.x).toBeCloseTo(box.x, 0);
      expect(after.width).toBeCloseTo(box.width, 0);
    }

    await page.screenshot({ path: "tests/e2e/screenshots/pin-lens-after-wheel.png", fullPage: true });
  });

  test("Methodology lead-in renders on first visit + collapsible via header link", async ({ page }) => {
    // Important: clear localStorage so this test simulates a first-time visitor.
    // Without the clear, a prior test's localStorage write could mask the
    // default-expanded behavior we want to verify.
    await page.addInitScript(() => { try { localStorage.removeItem("strategyReferee.methodologyExpanded"); } catch {} });
    await page.goto("/");

    // The 4-paragraph context block should be expanded for first-time visitors,
    // BEFORE they encounter any jargon. Each of the 4 columns is labeled.
    await expect(page.getByText("How did we get here?")).toBeVisible();
    await expect(page.getByText("1. The audit")).toBeVisible();
    await expect(page.getByText("2. The survivors")).toBeVisible();
    await expect(page.getByText("3. The other 44")).toBeVisible();
    await expect(page.getByText("4. What PASS means")).toBeVisible();

    // Header link should NOT point to the private sigma-swing-agent repo.
    const sigmaLink = page.locator('a[href*="sigma-swing-agent"]');
    await expect(sigmaLink).toHaveCount(0);
    // The Methodology link should be visible (self-contained replacement)
    await expect(page.getByRole("link", { name: /Methodology/ })).toBeVisible();

    // Collapse via the toggle button in the header nav
    await page.getByRole("button", { name: /Hide context/ }).click();
    await page.waitForTimeout(200);
    await expect(page.getByText("1. The audit")).not.toBeVisible();
    await expect(page.getByRole("button", { name: /How did we get here\?/ })).toBeVisible();
  });

  test("Audit transparency panel — collapsed by default, expandable, rescue candidate visible", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.waitForTimeout(2500);

    // Header should be visible with the rescue candidate counter
    const header = page.getByRole("button", { name: /Audit transparency/ });
    await expect(header).toBeVisible();
    await expect(header).toContainText(/shelved daily-crypto archetypes/);
    await expect(header).toContainText(/rescue candidate/);

    // Click to expand
    await header.click();
    // CathodeGrid renders asynchronously; give it a tick for the 46-row
    // grid to materialize.
    await page.waitForTimeout(1200);

    // Grid wrapper visible (h-[500px] container)
    const gridWrapper = page.locator('.h-\\[500px\\]').first();
    await expect(gridWrapper).toBeVisible();

    // CathodeGrid renders cell content via canvas / shadow DOM that
    // Playwright's text locators can't reach directly. The pagination
    // footer IS in regular DOM though — assert that to verify the grid
    // received all 46 rows of audit data. The rescue candidate is
    // verified visually via the saved screenshot.
    const gridText = await gridWrapper.textContent();
    expect(gridText).toContain("46 rows");

    await page.screenshot({ path: "tests/e2e/screenshots/audit-transparency-expanded.png", fullPage: true });
  });

  test("Pin-lens survives toolbar hover", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    const pinButton = page.getByRole("button", { name: /Lens pinned|Pin lens/ });
    await pinButton.waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    // The lens auto-pins on result — now centered on the TRADE MIDPOINT (was
    // the entry, which pushed the exit marker off the top edge). Button should
    // read "Lens pinned" after the auto-pin sequence settles.
    await expect(pinButton).toContainText("Lens pinned");

    // Hover over the Display button (the historical bug: this triggered
    // mouseleave on the canvas, which cleared the cathode lens). The pin
    // button should remain "Lens pinned" through the hover.
    await page.getByRole("button", { name: /⚙ Display/ }).hover();
    await page.waitForTimeout(500);
    await expect(pinButton).toContainText("Lens pinned");

    await page.screenshot({ path: "tests/e2e/screenshots/pin-lens-toolbar-hover.png", fullPage: true });
  });

  test("Expanded view — pin lens toggle mirrors inline + cycles", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    // Open the fullscreen modal. Inline lens is auto-pinned, so the modal
    // mirrors it: its own Pin button reads "Lens pinned".
    await page.getByRole("button", { name: /⛶ Expand/ }).click();
    await page.waitForTimeout(2800);
    const modal = page.locator(".fixed.inset-0.z-50");
    const modalPin = modal.getByRole("button", { name: /Lens pinned|Pin lens/ });
    await expect(modalPin).toContainText("Lens pinned");

    // Toggle off → on, confirming the modal has independent pin control.
    await modalPin.click();
    await expect(modalPin).toContainText("Pin lens");
    await modalPin.click();
    await expect(modalPin).toContainText("Lens pinned");

    // ESC closes the modal.
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  });

  test("Chart toolbar — Display, arrow-key zoom, PNG download (inline + modal)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Evaluate$/ }).click();
    await page.getByRole("button", { name: /Lens pinned|Pin lens/ }).first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(2500);

    const canvas = page.locator("canvas").first();

    // Display menu opens from the inline toolbar.
    await page.getByRole("button", { name: /⚙ Display/ }).first().click();
    await expect(page.getByText("WebGL pipeline")).toBeVisible();
    await page.mouse.click(5, 5);  // dismiss

    // Arrow-key zoom: click the chart to focus, ArrowUp should zoom (chart
    // pixels change). Pan (←→) is a no-op at default zoom because the whole
    // window fits — zoom first, which always has an effect.
    await canvas.click({ position: { x: 200, y: 100 } });
    const before = await canvas.screenshot();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(400);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);  // chart changed → arrows work

    // PNG download from the inline toolbar produces a non-trivial file.
    const dl = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("button", { name: /⬇ PNG/ }).first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^strategy-referee_.*\.png$/);
    const fs = await import("node:fs");
    const p = await download.path();
    expect(fs.statSync(p).size).toBeGreaterThan(5000);

    // Modal exposes Display + PNG too.
    await page.getByRole("button", { name: /⛶ Expand/ }).click();
    await page.waitForTimeout(2500);
    const modal = page.locator(".fixed.inset-0.z-50");
    await expect(modal.getByRole("button", { name: /⚙ Display/ })).toBeVisible();
    await expect(modal.getByRole("button", { name: /⬇ PNG/ })).toBeVisible();
  });
});
