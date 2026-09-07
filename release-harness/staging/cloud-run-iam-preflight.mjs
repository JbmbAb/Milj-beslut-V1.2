#!/usr/bin/env node
/**
 * Release-harness only: prove Cloud Run IAM via X-Serverless-Authorization.
 * Never logs token values. No gcloud calls — token must be minted by workflow WIF.
 */
function trim(value) {
  return String(value ?? '').trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const audience = trim(process.env.CLOUD_RUN_IAM_AUDIENCE || process.env.PLAYWRIGHT_BASE_URL || process.env.STAGING_URL);
const token = trim(process.env.CLOUD_RUN_ID_TOKEN);

if (!audience) {
  fail('CLOUD_RUN_IAM_AUDIENCE or PLAYWRIGHT_BASE_URL is required for IAM preflight');
}
if (!token) {
  fail('CLOUD_RUN_ID_TOKEN is required for IAM preflight (mint via workflow WIF id_token)');
}

const url = new URL('/api/csrf-token', audience).toString();
const response = await fetch(url, {
  headers: {
    Accept: 'application/json',
    'X-Serverless-Authorization': `Bearer ${token}`,
  },
});

console.log(`IAM preflight X-Serverless-Authorization /api/csrf-token: HTTP ${response.status}`);

if (response.status === 403) {
  fail('IAM preflight failed: HTTP 403 at Cloud Run IAM boundary');
}
if (!response.ok) {
  fail(`IAM preflight failed: HTTP ${response.status}`);
}

console.log('IAM_PREFLIGHT=PROVEN');
console.log(`CLOUD_RUN_IAM_AUDIENCE=${audience}`);
console.log('CLOUD_RUN_IAM_HEADER=X-Serverless-Authorization');
