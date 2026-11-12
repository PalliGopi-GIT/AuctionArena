import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: './tests/e2e/setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: [['list'], ['json', { outputFile: `${process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-E2E'}/results.json` }]],
  use: {
    baseURL: 'http://127.0.0.1:5273',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
