import fs from 'node:fs';
import path from 'node:path';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Lazy-loaded routes (React.lazy) can exceed the default 1000 ms under parallel Vitest workers.
configure({ asyncUtilTimeout: 10_000 });

import dotenv from 'dotenv';

// Automatically load .env.test if it exists to align local test database target (e.g. port 5433)
const envTestPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envTestPath)) {
  const envTestConfig = dotenv.parse(fs.readFileSync(envTestPath, 'utf-8'));
  for (const k in envTestConfig) {
    if (process.env[k] === undefined) {
      process.env[k] = envTestConfig[k];
    }
  }
}

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('connection_limit')) {
  const separator = process.env.DATABASE_URL.includes('?') ? '&' : '?';
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${separator}connection_limit=3`;
}

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

if (!process.env.DISABLE_DB_RATE_LIMIT) process.env.DISABLE_DB_RATE_LIMIT = 'true';

if (!process.env.JWT_ACCESS_SECRET) process.env.JWT_ACCESS_SECRET = 'test-access-secret';
if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
if (!process.env.LANTMATERIET_BASE_URL) process.env.LANTMATERIET_BASE_URL = 'https://example.invalid';
if (!process.env.LANTMATERIET_OPEN_MODE) process.env.LANTMATERIET_OPEN_MODE = 'true';
if (!process.env.ADMIN_CONSOLE_USERNAME) process.env.ADMIN_CONSOLE_USERNAME = 'admin';
if (!process.env.ADMIN_CONSOLE_PASSWORD) process.env.ADMIN_CONSOLE_PASSWORD = 'admin';
if (!process.env.ADMIN_ORG_NAME) process.env.ADMIN_ORG_NAME = 'Miljöbeslut Test Org';
if (!process.env.ADMIN_ORG_NUMBER) process.env.ADMIN_ORG_NUMBER = '999999-0001';
// Keep default aligned with `.env.test.example` / CI unit job so rate-limit and Prisma
// helpers behave consistently when no local `.env.test` is present.
if (!process.env.DATABASE_URL)
  process.env.DATABASE_URL =
    'postgresql://miljobeslut:password@localhost:5432/miljobeslut_test?sslmode=disable';
if (!process.env.SLU_API_BASE_URL) process.env.SLU_API_BASE_URL = 'https://example.invalid';
if (!process.env.SLU_API_KEY) process.env.SLU_API_KEY = 'test-slu-key';
if (!process.env.SEARCH_WORKER_ENABLED) process.env.SEARCH_WORKER_ENABLED = 'false';
if (!process.env.GEMINI_DB_API_KEY) process.env.GEMINI_DB_API_KEY = 'test-gemini-db-api-key';

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
