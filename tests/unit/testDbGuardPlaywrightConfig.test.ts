// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TEST-DB-GUARD (OD-K0-5), requirement 4: local Playwright E2E needs the same explicit opt-in.
 * Evaluates the real playwright.config.ts in its own process (cwd = an empty temp dir, so no env
 * file is read; environment built from scratch). Nothing is started and nothing connects: the
 * config is only loaded.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

let cwd: string;

beforeAll(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg-playwright-config-'));
});

afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function loadConfigInChild(extra: Record<string, string>): { ok: boolean; text: string } {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const childCode = [
    `try { await import(${JSON.stringify(CONFIG_URL)}); process.stdout.write('WTDG_RESULT OK'); }`,
    "catch (e) { process.stdout.write('WTDG_RESULT ERR ' + String(e && e.message)); }",
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER_URL, '--input-type=module', '-e', childCode],
    {
      cwd,
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 90_000,
    },
  );
  const out = String(result.stdout ?? '');
  const at = out.indexOf('WTDG_RESULT ');
  if (at < 0) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
  const text = out.slice(at + 'WTDG_RESULT '.length);
  return { ok: text.startsWith('OK'), text };
}

describe('TEST-DB-GUARD: playwright.config.ts (local E2E)', () => {
  it('refuses the live database', () => {
    const r = loadConfigInChild({ PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/miljobeslut' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/TEST-DB-GUARD.*playwright\.config\.ts/);
  });

  it('refuses its own former default (localhost:5432, the live port here) without an opt-in', () => {
    const r = loadConfigInChild({});
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/TEST-DB-GUARD/);
  });

  it('loads with an opted-in *_test database on a non-live port', () => {
    const r = loadConfigInChild({
      PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/wtdg_e2e_test',
      MIMER_TEST_DB_ALLOW: 'wtdg_e2e_test',
    });
    expect(r).toEqual({ ok: true, text: 'OK' });
  });

  it('does not apply to an external target (staging smoke sets PLAYWRIGHT_BASE_URL)', () => {
    const r = loadConfigInChild({ PLAYWRIGHT_BASE_URL: 'https://wtdg-external.invalid' });
    expect(r).toEqual({ ok: true, text: 'OK' });
  });
});
