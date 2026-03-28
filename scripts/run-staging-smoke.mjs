import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function trim(value) {
  return String(value || '').trim();
}

function applyEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    env[key] = value;
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
}

const npmCommand = 'npm';
const npxCommand = 'npx';
const externalBaseUrl = trim(process.env.PLAYWRIGHT_BASE_URL) || trim(process.env.STAGING_URL);
const env = { ...process.env };

if (!externalBaseUrl) {
  applyEnvFile(path.resolve('.env.test'), env);
  run(npmCommand, ['run', 'db:test:migrate'], env);
  run(npmCommand, ['run', 'db:test:seed'], env);
  env.PLAYWRIGHT_FORCE_FRESH_SERVER = 'true';
  env.PLAYWRIGHT_LOCAL_API_PORT = '9877';
  env.PLAYWRIGHT_LOCAL_UI_PORT = '3900';
  env.PLAYWRIGHT_API_BASE_URL = 'http://127.0.0.1:9877';
}

run(npxCommand, ['playwright', 'test', 'tests/e2e/staging-smoke.spec.ts'], env);
