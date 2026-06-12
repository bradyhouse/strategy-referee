// playwright.config.js — visual + functional smoke tests for the demo UI.
//
// Why this exists: every UI change to the verdict card (verdict tree, gate
// panel, strategy explainer, chart overlays, price labels, pin-lens toggle)
// has shipped without visual verification — judging by the user. Several
// regressions (overlapping labels, lens disappearing on mouseleave) would
// have been caught with a single screenshot. This config + the e2e tests
// in tests/e2e/ close that gap before the hackathon submission.
//
// Run modes:
//   npx playwright test                — headless run, fails on mismatch
//   npx playwright test --headed       — see the browser
//   npx playwright test --update-snapshots  — accept current rendering as correct
//
// The webServer block boots the bundled `node server.js` (built dist + API)
// so the tests hit the same path as production. Dev mode (vite + dev:api)
// would also work but introduces HMR noise into the screenshots.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,         // Single browser; tests share the running server
  retries: 0,                   // Fail loudly on first miss; this is for me, not for CI
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node server.js",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
