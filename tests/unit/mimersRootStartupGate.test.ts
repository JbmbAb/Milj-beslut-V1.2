import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertMimersCasReady,
  resetMimersCasCacheForTests,
} from '../../packages/mps-runtime/src/repository/createKernelArtifactRepository';

/**
 * W-U402 (U40-2, point 4) -- a missing or invalid MIMERS_ROOT is a documented refusal at START (spec U40-U50B §1.7 RR-4).
 *
 * CHARACTERIZATION, not a fix: the refusal already exists (U30-A: no `.data/mimers` fallback; M1a-F1: absolute path with
 * a volume, existing directory; `MIMERS_ROOT_REQUIRED`), in the web process (`server/index.ts`: `assertMimersCasReady`
 * after the database check, before the release gate and `listen`) and in the four LU workers
 * (`assertLuWorkerDurableCas`, pinned by tests/unit/luWorkerDurableCasGate.test.ts). What was missing is a pin of the
 * WEB wiring: the existing order pin (releaseApiAndHealth.test.ts) compares `indexOf('assertMimersCasReady(process.env)')`
 * with the release gate and passes vacuously (-1) if the call is removed. This file pins the call itself and exercises
 * the web's exact gate function with a product environment (explicit env objects, no VITEST, no MIMERS_REQUIRED).
 *
 * Root creation is not part of this: the durable root is created by the deployment/operator, never by a starting
 * process (DurableMimersRoot.ts; M1A-CLOSE §3). Hermetic: temporary directories only (TMP is on D: in this lane's
 * runner); no real root is named, read or created.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const PRODUCT_ENV = { NODE_ENV: 'production', APP_ENV: 'production', MIMERS_DURABILITY_MODE: 'none' } as const;

let scratch: string;

beforeEach(() => {
  resetMimersCasCacheForTests();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'u402-mimers-root-'));
});

afterEach(() => {
  resetMimersCasCacheForTests();
  fs.rmSync(scratch, { recursive: true, force: true });
});

async function refusalOf(env: Record<string, string>): Promise<Error> {
  try {
    await assertMimersCasReady(env as NodeJS.ProcessEnv);
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the start-up gate to refuse');
}

describe('the web process start-up gate refuses a missing or invalid MIMERS_ROOT (product environment)', () => {
  it.each([
    ['absent', {}],
    ['empty', { MIMERS_ROOT: '' }],
    ['blank', { MIMERS_ROOT: '   ' }],
  ])('MIMERS_ROOT %s -> MIMERS_ROOT_REQUIRED (no fallback directory)', async (_label, extra) => {
    const error = await refusalOf({ ...PRODUCT_ENV, ...extra });
    expect((error as { code?: string }).code).toBe('MIMERS_ROOT_REQUIRED');
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: /);
  });

  it('the same with MIMERS_REQUIRED=true (the composition sets it)', async () => {
    const error = await refusalOf({ ...PRODUCT_ENV, MIMERS_REQUIRED: 'true' });
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: /);
  });

  it('a relative root -> MIMERS_ROOT_REQUIRED (would resolve against the working directory)', async () => {
    const error = await refusalOf({ ...PRODUCT_ENV, MIMERS_ROOT: 'mimers-relative' });
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: .*not an absolute path/);
  });

  it('a root that does not exist -> MIMERS_ROOT_REQUIRED, and nothing is created', async () => {
    const missing = path.join(scratch, 'does-not-exist');
    const error = await refusalOf({ ...PRODUCT_ENV, MIMERS_ROOT: missing });
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: .*does not exist/);
    expect(fs.existsSync(missing), 'a starting process never creates the root').toBe(false);
  });

  it('a root that is a file -> MIMERS_ROOT_REQUIRED', async () => {
    const file = path.join(scratch, 'a-file');
    fs.writeFileSync(file, 'not a directory');
    const error = await refusalOf({ ...PRODUCT_ENV, MIMERS_ROOT: file });
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: .*not a directory/);
  });

  it.skipIf(process.platform !== 'win32')('a rooted root without a drive letter (Windows) -> MIMERS_ROOT_REQUIRED', async () => {
    const error = await refusalOf({ ...PRODUCT_ENV, MIMERS_ROOT: '\\u402-driveless-cas' });
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: .*names no drive letter/);
  });

  it('an existing absolute root -> starts; only the CAS store inside it is initialized', async () => {
    await expect(assertMimersCasReady({ ...PRODUCT_ENV, MIMERS_ROOT: scratch } as NodeJS.ProcessEnv)).resolves.toBeUndefined();
    expect(fs.readdirSync(scratch)).toEqual(['cas']);
  });
});

describe('server/index.ts wires the gate into the web start-up chain (source check)', () => {
  it('awaits assertMimersCasReady(process.env) after the database check, before the release gate and listen; a refusal exits 1', () => {
    const src = read('server/index.ts');
    const dbCheck = src.indexOf('verifyDatabaseSanity()\n');
    const casGate = src.indexOf('await assertMimersCasReady(process.env);');
    const releaseGate = src.indexOf("assertProductReleaseIdentityAtStartup({ role: 'web'");
    const listen = src.indexOf('server.listen(');
    expect(dbCheck, 'the start-up chain begins with the database check').toBeGreaterThan(0);
    expect(casGate, 'server/index.ts awaits the CAS gate').toBeGreaterThan(dbCheck);
    expect(casGate).toBeLessThan(releaseGate);
    expect(casGate).toBeLessThan(listen);
    expect(src).toContain("'../packages/mps-runtime/src/repository/createKernelArtifactRepository.js'");
    expect(src.slice(casGate)).toMatch(/\.catch\(\(err\) => \{[\s\S]*?process\.exit\(1\);/);
  });
});
