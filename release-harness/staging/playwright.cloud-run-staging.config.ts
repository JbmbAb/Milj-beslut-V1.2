/**
 * Release-harness Playwright config for IAM-protected Cloud Run staging.
 *
 * Product tests run from the immutable product tree. Infrastructure IAM is
 * satisfied by the authenticated gcloud Cloud Run proxy (see workflow). This
 * config only pins external-target behaviour and records harness metadata.
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(harnessDir, '../../../product');
const baseURL =
  String(process.env.PLAYWRIGHT_BASE_URL || process.env.STAGING_URL || '').trim();

if (!baseURL) {
  throw new Error('PLAYWRIGHT_BASE_URL is required for Cloud Run staging proof');
}

export default defineConfig({
  testDir: path.join(productRoot, 'tests/e2e'),
  timeout: 180_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
