import { defineConfig, devices } from '@playwright/test';

const operational = process.env.PLAYWRIGHT_OPERATIONAL === 'true';
const reportName = operational ? 'operational' : 'fast';

export default defineConfig({
  testDir: operational ? './tests/operational-e2e' : './tests/e2e',
  fullyParallel: !operational,
  workers: operational ? 1 : 2,
  retries: operational ? 0 : process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: `playwright-report/${reportName}` }]]
    : 'list',
  outputDir: `test-results/${reportName}`,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: operational ? 'off' : 'on-first-retry',
  },
  ...(operational
    ? {}
    : {
        webServer: {
          command: 'corepack pnpm build && corepack pnpm exec vite preview',
          url: 'http://127.0.0.1:4173',
          reuseExistingServer: !process.env.CI,
        },
      }),
  projects: operational
    ? [{ name: 'operational-chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }]
    : [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
        { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chromium' } },
      ],
});
