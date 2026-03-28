import fs from 'node:fs';
import path from 'node:path';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

if (!process.env.JWT_ACCESS_SECRET) process.env.JWT_ACCESS_SECRET = 'test-access-secret';
if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
if (!process.env.LANTMATERIET_BASE_URL) process.env.LANTMATERIET_BASE_URL = 'https://example.invalid';
if (!process.env.LANTMATERIET_OPEN_MODE) process.env.LANTMATERIET_OPEN_MODE = 'true';
if (!process.env.ADMIN_CONSOLE_USERNAME) process.env.ADMIN_CONSOLE_USERNAME = 'admin';
if (!process.env.ADMIN_CONSOLE_PASSWORD) process.env.ADMIN_CONSOLE_PASSWORD = 'admin-test-password';
if (!process.env.ADMIN_ORG_NAME) process.env.ADMIN_ORG_NAME = 'Miljobeslut Test Org';
if (!process.env.ADMIN_ORG_NUMBER) process.env.ADMIN_ORG_NUMBER = '999999-0001';
if (!process.env.DATABASE_URL)
  process.env.DATABASE_URL = 'postgresql://miljobeslut:password@localhost:5432/miljobeslut_test';
if (!process.env.SLU_API_BASE_URL) process.env.SLU_API_BASE_URL = 'https://example.invalid';
if (!process.env.SLU_API_KEY) process.env.SLU_API_KEY = 'test-slu-key';
if (!process.env.SEARCH_WORKER_ENABLED) process.env.SEARCH_WORKER_ENABLED = 'false';

// Ensure Testing Library cleans up between tests (prevents role queries from seeing stale DOM).
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}

// Vitest v8 coverage writes temp chunks to `coverage/.tmp/*` but doesn't always create the folder on Windows.
try {
  fs.mkdirSync(path.join(process.cwd(), 'coverage', '.tmp'), { recursive: true });
} catch {
  // ignore
}
