/**
 * Release-harness only: prove Playwright IAM injection before product E2E.
 */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export default async function globalSetup(): Promise<void> {
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

  const response = await fetch(new URL('/api/csrf-token', audience).toString(), {
    headers: {
      Accept: 'application/json',
      'X-Serverless-Authorization': `Bearer ${token}`,
    },
  });

  console.log(`Playwright IAM injection probe /api/csrf-token: HTTP ${response.status}`);
  if (response.status === 403) {
    fail('Playwright IAM injection probe failed (HTTP 403 at Cloud Run IAM boundary)');
  }
  if (!response.ok) {
    fail(`Playwright IAM injection probe failed (HTTP ${response.status})`);
  }

  console.log('PLAYWRIGHT_IAM_INJECTION_PROBE=PROVEN');
}
