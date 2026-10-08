import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * W-U402 (U40-2, point 5) -- the explicit safety guard of docker-compose.prod.yml (owner decision Round 20, alternative C).
 *
 * The file is "primär prod" (docs/ops/local-prod-setup.md): it pointed the app at the shared main PostGIS
 * (miljobeslut-postgres) with credentials in clear text and started the in-process workers, among them the GDPR job that
 * archives/deletes projects in that database (U40-A-DOCKER-VERIFICATION F3; owner decision 7: never run it against the
 * shared/live DB). The guard, and nothing more:
 *  (a) DATABASE_URL must be given explicitly -- a required interpolation (`${MILJOBESLUT_PROD_DATABASE_URL:?…}`), no
 *      default, no database URL in the file;
 *  (b) in-process workers and GDPR maintenance are OFF in this configuration;
 *  (c) a mandatory, explicit acknowledgement: missing or empty -> compose refuses to render (`${…:?…}`); present with any
 *      value other than the exact one -> the app process refuses in server/loadEnvFirst.ts, its first import, before any
 *      module that can reach the database is evaluated.
 * Consequence (registered follow-up, not solved here): local prod does not run GDPR maintenance through this file.
 *
 * Hermetic: the YAML is read and parsed, never run; the runtime check runs the REAL loadEnvFirst in child processes with
 * an environment built from scratch and an empty temporary cwd. No container, no database, no network.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const ACK_MODULE = pathToFileURL(path.join(REPO_ROOT, 'server/modules/runtime-env/prodComposeAcknowledgement.ts')).href;
const loadAckModule = (): Promise<typeof import('../../server/modules/runtime-env/prodComposeAcknowledgement')> =>
  import(/* @vite-ignore */ ACK_MODULE);

const COMPOSE_TEXT = read('docker-compose.prod.yml');
type Service = { environment?: unknown; env_file?: unknown };
const compose = parse(COMPOSE_TEXT) as { services: Record<string, Service> };
const appEnvironment = () => compose.services.app.environment as Record<string, unknown>;

const REQUIRED = (name: string) => new RegExp(`^\\$\\{${name}:\\?[^}]+\\}$`);

describe('docker-compose.prod.yml carries the explicit guard (a)-(c)', () => {
  it('the app environment is a mapping, so its values override env_file (.env.production)', () => {
    const env = appEnvironment();
    expect(env).toBeTypeOf('object');
    expect(Array.isArray(env)).toBe(false);
  });

  it('(a) DATABASE_URL is a required interpolation of MILJOBESLUT_PROD_DATABASE_URL -- no default, no database in the file', () => {
    const value = appEnvironment().DATABASE_URL;
    expect(value).toBeTypeOf('string');
    expect(value).toMatch(REQUIRED('MILJOBESLUT_PROD_DATABASE_URL'));
    expect(value).not.toMatch(/:-/);
  });

  it('(a) no clear-text database URL anywhere in the file', () => {
    expect(COMPOSE_TEXT).not.toMatch(/postgres(?:ql)?:\/\/[^\s'"$]*@/i);
    expect(COMPOSE_TEXT).not.toContain('miljobeslut:miljobeslut@');
  });

  it('(b) in-process workers and GDPR maintenance are off (exactly the string "false")', () => {
    expect(appEnvironment().START_WORKERS_IN_PROCESS).toBe('false');
    expect(appEnvironment().GDPR_CRON_IN_PROCESS).toBe('false');
  });

  it('(b) no other service takes a database URL or starts workers', () => {
    for (const [name, service] of Object.entries(compose.services)) {
      if (name === 'app') continue;
      const env = (service.environment ?? {}) as Record<string, unknown>;
      expect(Object.keys(env), name).not.toContain('DATABASE_URL');
      expect(env.START_WORKERS_IN_PROCESS, name).not.toBe('true');
    }
  });

  it('(c) the acknowledgement is a required interpolation (missing/empty -> compose refuses) whose message names the exact value', async () => {
    const { PROD_COMPOSE_ACK_ENV, PROD_COMPOSE_ACK_VALUE } = await loadAckModule();
    const value = appEnvironment()[PROD_COMPOSE_ACK_ENV];
    expect(value).toBeTypeOf('string');
    expect(value).toMatch(REQUIRED(PROD_COMPOSE_ACK_ENV));
    expect(value).not.toMatch(/:-/);
    expect(value as string).toContain(PROD_COMPOSE_ACK_VALUE);
  });
});

let emptyCwd: string;
beforeAll(() => {
  emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'u402-compose-ack-cwd-'));
});
afterAll(() => {
  fs.rmSync(emptyCwd, { recursive: true, force: true });
});

function bareChildEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

function startLoadEnvFirst(ack: string | undefined): { loaded: boolean; status: number | null; stderr: string } {
  const childCode = [`await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});`, "process.stdout.write('U402_LOADED\\n');", 'process.exit(0);'].join('\n');
  const extra: Record<string, string> = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u402-dead:x@127.0.0.1:1/u402_dead_db' };
  if (ack !== undefined) extra.MILJOBESLUT_PROD_COMPOSE_ACK = ack;
  const result = spawnSync(process.execPath, ['--import', TSX_LOADER_URL, '--input-type=module', '-e', childCode], {
    cwd: emptyCwd,
    env: bareChildEnv(extra),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    loaded: (result.stdout ?? '').split(/\r?\n/).includes('U402_LOADED'),
    status: result.status,
    stderr: String(result.stderr ?? ''),
  };
}

describe('(c) a wrong acknowledgement refuses the app process in loadEnvFirst, its first import', () => {
  it('absent (a process not started by this compose file): unchanged, it loads', () => {
    expect(startLoadEnvFirst(undefined).loaded).toBe(true);
  });

  it('the exact value: it loads', async () => {
    const { PROD_COMPOSE_ACK_VALUE } = await loadAckModule();
    const r = startLoadEnvFirst(PROD_COMPOSE_ACK_VALUE);
    expect(r.loaded, r.stderr.slice(0, 1500)).toBe(true);
  });

  it.each([['true'], ['1'], ['yes'], [''], ['   '], ['u402-wrong-ack-value']])(
    'a wrong value (%j) -> REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT, exit != 0, the value never echoed',
    (wrong) => {
      const r = startLoadEnvFirst(wrong);
      expect(r.loaded).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT: /);
      expect(r.stderr).not.toContain('u402-wrong-ack-value');
    },
  );

  it.each([['padded', ' x '], ['upper case', 'UPPER'], ['trailing space', 'x ']])(
    'a near-miss of the exact value (%s) -> refuses (exact, case-sensitive, nothing trimmed)',
    async (_label, form) => {
      const { PROD_COMPOSE_ACK_VALUE } = await loadAckModule();
      const near = form === ' x ' ? ` ${PROD_COMPOSE_ACK_VALUE} ` : form === 'UPPER' ? PROD_COMPOSE_ACK_VALUE.toUpperCase() : `${PROD_COMPOSE_ACK_VALUE} `;
      const r = startLoadEnvFirst(near);
      expect(r.loaded).toBe(false);
      expect(r.stderr).toMatch(/REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT: /);
    },
  );

  it('source pin: the app entry imports loadEnvFirst first, and loadEnvFirst checks before it reads any env file', () => {
    const index = read('server/index.ts');
    expect(index.split('\n')[0]).toBe("import './loadEnvFirst';");
    const first = read('server/loadEnvFirst.ts');
    const check = first.indexOf('assertProdComposeAcknowledgement(process.env);');
    expect(check, 'loadEnvFirst calls the acknowledgement check').toBeGreaterThan(-1);
    expect(check).toBeLessThan(first.indexOf('loadEnvFile();'));
  });
});
