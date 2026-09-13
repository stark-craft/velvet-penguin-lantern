import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'playwright_profile.spec.js',
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: undefined,
});
