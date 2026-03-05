import { defineConfig } from '@playwright/test';

const serverEnv = {
  NODE_ENV: 'test',
  PORT: '8787',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://riskguard:password@localhost:5432/riskguard_test',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'test-access-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'test-refresh-secret',
  LANTMATERIET_OPEN_MODE: process.env.LANTMATERIET_OPEN_MODE || 'true',
  LANTMATERIET_BASE_URL: process.env.LANTMATERIET_BASE_URL || 'https://example.invalid',
  ADMIN_CONSOLE_USERNAME: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
  ADMIN_CONSOLE_PASSWORD: process.env.ADMIN_CONSOLE_PASSWORD || 'admin-test-password',
  ADMIN_ORG_NAME: process.env.ADMIN_ORG_NAME || 'Miljobeslut Test Org',
  ADMIN_ORG_NUMBER: process.env.ADMIN_ORG_NUMBER || '999999-0001',
  SLU_API_BASE_URL: process.env.SLU_API_BASE_URL || 'https://example.invalid',
  SLU_API_KEY: process.env.SLU_API_KEY || 'test-slu-key',
  SEARCH_WORKER_ENABLED: 'false',
} as const;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:server',
      port: 8787,
      timeout: 120000,
      reuseExistingServer: !process.env.CI,
      env: serverEnv,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 3000',
      port: 3000,
      timeout: 120000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...serverEnv,
        VITE_API_BASE_URL: 'http://127.0.0.1:8787',
      },
    },
  ],
});
