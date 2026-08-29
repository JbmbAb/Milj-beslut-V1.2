#!/usr/bin/env node
/**
 * Release-harness only: prove Cloud Run IAM boundary before product E2E.
 * Never logs token values.
 */
import { execFileSync } from 'node:child_process';

function trim(value) {
  return String(value ?? '').trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const audience = trim(process.env.CLOUD_RUN_IAM_AUDIENCE || process.env.PLAYWRIGHT_BASE_URL || process.env.STAGING_URL);
if (!audience) {
  fail('CLOUD_RUN_IAM_AUDIENCE or PLAYWRIGHT_BASE_URL is required for IAM preflight');
}

let token = trim(process.env.CLOUD_RUN_ID_TOKEN);
if (!token) {
  try {
    token = trim(
      execFileSync('gcloud', ['auth', 'print-identity-token', `--audiences=${audience}`], {
        encoding: 'utf8',
      }),
    );
  } catch {
    fail('Failed to mint Cloud Run ID token via gcloud');
  }
}

if (!token) {
  fail('Cloud Run ID token is empty');
}

async function probe(path, headers, label) {
  const url = new URL(path, audience).toString();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  });
  console.log(`IAM preflight ${label} ${path}: HTTP ${response.status}`);
  if (response.status === 403) {
    fail(`IAM preflight failed for ${label} ${path} (HTTP 403)`);
  }
  if (!response.ok && path !== '/ready') {
    fail(`IAM preflight failed for ${label} ${path} (HTTP ${response.status})`);
  }
}

const paths = ['/health', '/ready', '/api/csrf-token'];
for (const path of paths) {
  await probe(path, { Authorization: `Bearer ${token}` }, 'Authorization');
}

await probe(
  '/api/csrf-token',
  { 'X-Serverless-Authorization': `Bearer ${token}` },
  'X-Serverless-Authorization',
);

console.log('IAM_PREFLIGHT=PROVEN');
console.log(`CLOUD_RUN_IAM_AUDIENCE=${audience}`);
