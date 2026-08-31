#!/usr/bin/env node
/**
 * LEGACY_GCP — Cloud Run IAM Playwright setup only. Not used for dedicated-server staging (PNRC I2).
 * Release-harness only: inject Cloud Run IAM on Playwright APIRequestContext
 * without colliding with application Authorization headers.
 */
import { request as playwrightRequest } from '@playwright/test';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const token = String(process.env.CLOUD_RUN_ID_TOKEN || '').trim();
const audience = String(
  process.env.CLOUD_RUN_IAM_AUDIENCE || process.env.PLAYWRIGHT_BASE_URL || process.env.STAGING_URL || '',
).trim();

if (!token) {
  fail('CLOUD_RUN_ID_TOKEN is required for Playwright Cloud Run IAM injection');
}
if (!audience) {
  fail('CLOUD_RUN_IAM_AUDIENCE or PLAYWRIGHT_BASE_URL is required for Playwright Cloud Run IAM injection');
}

const cloudRunIamHeader = {
  'X-Serverless-Authorization': `Bearer ${token}`,
};

const originalNewContext = playwrightRequest.newContext.bind(playwrightRequest);

playwrightRequest.newContext = async (options = {}) => {
  return originalNewContext({
    ...options,
    extraHTTPHeaders: {
      ...(options.extraHTTPHeaders ?? {}),
      ...cloudRunIamHeader,
    },
  });
};

export default async function globalSetup() {
  const api = await playwrightRequest.newContext({
    baseURL: audience,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });

  try {
    const response = await api.get('/api/csrf-token');
    console.log(`Playwright IAM injection probe /api/csrf-token: HTTP ${response.status()}`);
    if (response.status() === 403) {
      fail('Playwright IAM injection probe failed (HTTP 403 at Cloud Run IAM boundary)');
    }
    if (!response.ok()) {
      fail(`Playwright IAM injection probe failed (HTTP ${response.status()})`);
    }
    console.log('PLAYWRIGHT_IAM_INJECTION_PROBE=PROVEN');
  } finally {
    await api.dispose();
  }
}
