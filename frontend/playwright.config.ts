import { defineConfig } from '@playwright/test';

// 2026 consensus: chromium on every run (¾ of traffic), trace on first retry,
// screenshots only on failure, forbid .only in CI, serial workers because all
// specs share one stack + one database (shard when the suite passes ~5 min).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8095',
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { channel: undefined } }],
});
