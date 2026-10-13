import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser-pwa',
  timeout: 180000,
  expect: { timeout: 45000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5189',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'node scripts/serve-offline-check.mjs', url: 'http://127.0.0.1:5189', reuseExistingServer: false, timeout: 30000 },
  reporter: 'list',
  outputDir: 'outputs/browser-pwa',
});
