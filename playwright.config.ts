import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config (research.md #8): Chromium context for offline-launch
 * emulation (SC-003) and multi-context runs for the concurrent-sync race
 * (FR-058, SC-008). E2e specs live in tests/e2e/.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Builds and serves the production output (service worker enabled), so
    // offline/PWA behavior (SC-003) is actually exercised — `ng serve`'s dev
    // mode never registers the service worker. `-s` (single-page-app mode)
    // rewrites unknown deep-link routes back to index.html, matching
    // Angular's HTML5 pushState routing.
    command: 'npm run build -- --configuration production && npx serve -s dist/quiz-app/browser -p 4200',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
