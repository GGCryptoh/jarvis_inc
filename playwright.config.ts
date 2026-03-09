import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://jarvis.local',
    headless: true,
    screenshot: 'only-on-failure',
  },
});
