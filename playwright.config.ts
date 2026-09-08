import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: { channel: 'msedge' },
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
  outputDir: 'outputs/browser',
});
