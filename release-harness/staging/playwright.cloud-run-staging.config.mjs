/**
 * Release-harness Playwright config for IAM-protected Cloud Run staging.
 *
 * Resolves @playwright/test from the product tree to avoid duplicate Playwright
 * installations when the harness checkout also carries node_modules.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(harnessDir, '../../../product');
const requireFromProduct = createRequire(path.join(productRoot, 'package.json'));
const { defineConfig } = requireFromProduct('@playwright/test') as typeof import('@playwright/test');

const baseURL =
  String(process.env.PLAYWRIGHT_BASE_URL || process.env.STAGING_URL || '').trim();
const cloudRunIdToken = String(process.env.CLOUD_RUN_ID_TOKEN || '').trim();

if (!baseURL) {
  throw new Error('PLAYWRIGHT_BASE_URL is required for Cloud Run staging proof');
}
if (!cloudRunIdToken) {
  throw new Error('CLOUD_RUN_ID_TOKEN is required for Cloud Run staging proof');
}

const stagingSpecs = [
  'staging-smoke.spec.ts',
  'staging-core-flows.spec.ts',
  'staging-enskilt-avlopp.spec.ts',
  'staging-c-anmalan-mass.spec.ts',
  'staging-lokaliseringsutredning.spec.ts',
];

export default defineConfig({
  testDir: path.join(productRoot, 'tests/e2e'),
  testMatch: stagingSpecs,
  timeout: 180_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    extraHTTPHeaders: {
      'X-Serverless-Authorization': `Bearer ${cloudRunIdToken}`,
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
