import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isExplicitTestProcess } from '../../server/modules/release/processClassification';
import * as workerBootstrap from '../../server/workers/bootstrap';

/**
 * W-U402 (U40-2, point 3) -- the process start-up gate for MPS_LU_BOOTSTRAP_ADMIT (U30R6 §9 K6/K7; owner decision
 * Round 2 row 12 / A-R5-2: "startspärr för hela servern i U40-2 … även i workers egna ingångar").
 *
 * The verify route already answers 503 BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST when the flag is present outside an explicit
 * test process (PLUMB-S), but the process itself started and served. Now the web process and the four LU workers refuse
 * to START with the flag present (any value, also "" -- owner A-R5-5) unless the process is an explicit test process
 * (NODE_ENV exactly 'test' AND APP_ENV exactly 'test' or 'ci' -- the K0 model, U42's isExplicitTestProcess). The rule
 * is mps-lu's own package-root export `assertBootstrapAdmitFlagOnlyInExplicitTestProcess(env, 'process_startup')` --
 * one rule, never a duplicate that can drift (U30-R6).
 *
 * Hermetic: the worker gate is exercised with explicit env objects; the entry files and server/index.ts are checked as
 * source text only (they load env files and reach the database when executed).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

type Gate = (workerName: string, env?: NodeJS.ProcessEnv) => Promise<void>;
const gate = (): Gate => (workerBootstrap as unknown as { assertLuWorkerBootstrapAdmitFlag: Gate }).assertLuWorkerBootstrapAdmitFlag;

const FLAG_VALUE = 'u402-flag-value-never-echoed';

const LU_WORKERS = [
  { file: 'server/workers/lu-project-context-bootstrap-worker.ts', name: 'lu-bootstrap-worker', start: 'startLuProjectContextBootstrapWorker(' },
  { file: 'server/workers/lu-viewer-capability-worker.ts', name: 'lu-viewer-capability-worker', start: 'startViewerCapabilityProvisioningWorker(' },
  { file: 'server/workers/lu-execution-identity-v3-worker.ts', name: 'lu-identity-v3-worker', start: 'startLocalizationIdentityProvisioningWorker(' },
  { file: 'server/workers/lu-geometry-supersession-worker.ts', name: 'lu-geometry-supersession-worker', start: 'startGeometrySupersessionProvisioningWorker(' },
] as const;

describe('LU worker start-up gate: MPS_LU_BOOTSTRAP_ADMIT only in an explicit test process', () => {
  it.each([
    ['production', { NODE_ENV: 'production', APP_ENV: 'production' }],
    ['explicit development (development/development) -- development is not test', { NODE_ENV: 'development', APP_ENV: 'development' }],
    ['the worktree runtime (NODE_ENV=development, APP_ENV unset)', { NODE_ENV: 'development' }],
    ['NODE_ENV=test without APP_ENV', { NODE_ENV: 'test' }],
    ['NODE_ENV=test with an empty APP_ENV', { NODE_ENV: 'test', APP_ENV: '' }],
    ['NODE_ENV=test with APP_ENV=Test (case-sensitive)', { NODE_ENV: 'test', APP_ENV: 'Test' }],
    ['APP_ENV=test without NODE_ENV', { APP_ENV: 'test' }],
    ['nothing set', {}],
  ])('flag present, %s -> refuses to start (BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST, gate process start-up)', async (_label, base) => {
    const env = { ...base, MPS_LU_BOOTSTRAP_ADMIT: FLAG_VALUE } as NodeJS.ProcessEnv;
    let caught: unknown;
    try {
      await gate()('lu-bootstrap-worker', env);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST');
    expect((caught as Error).message).toMatch(
      /^lu-bootstrap-worker: .*refusing to start\. BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST: .*process start-up refuses to run/,
    );
    expect((caught as Error).message, 'no environment value is echoed').not.toContain(FLAG_VALUE);
  });

  it.each([['1'], [''], ['0'], ['false']])('an empty or "off-looking" flag value (%j) counts as set (owner A-R5-5)', async (value) => {
    await expect(
      gate()('lu-viewer-capability-worker', { NODE_ENV: 'production', MPS_LU_BOOTSTRAP_ADMIT: value } as NodeJS.ProcessEnv),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST' });
  });

  it.each([
    ['NODE_ENV=test, APP_ENV=test', { NODE_ENV: 'test', APP_ENV: 'test' }],
    ['NODE_ENV=test, APP_ENV=ci', { NODE_ENV: 'test', APP_ENV: 'ci' }],
  ])('flag present in an explicit test process (%s) -> starts', async (_label, base) => {
    await expect(
      gate()('lu-identity-v3-worker', { ...base, MPS_LU_BOOTSTRAP_ADMIT: '1' } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['development', { NODE_ENV: 'development' }],
    ['nothing set', {}],
  ])('flag absent (%s) -> starts', async (_label, env) => {
    await expect(gate()('lu-geometry-supersession-worker', env as NodeJS.ProcessEnv)).resolves.toBeUndefined();
  });

  it('agrees with the K0 explicit-test model (U42 isExplicitTestProcess) on a table of environments', async () => {
    const nodeEnvs = [undefined, 'test', 'development', 'production', 'Test', ''];
    const appEnvs = [undefined, 'test', 'ci', 'development', 'production', 'CI', ''];
    for (const NODE_ENV of nodeEnvs) {
      for (const APP_ENV of appEnvs) {
        const env: Record<string, string> = { MPS_LU_BOOTSTRAP_ADMIT: '1' };
        if (NODE_ENV !== undefined) env.NODE_ENV = NODE_ENV;
        if (APP_ENV !== undefined) env.APP_ENV = APP_ENV;
        let refused = false;
        try {
          await gate()('lu-bootstrap-worker', env as NodeJS.ProcessEnv);
        } catch {
          refused = true;
        }
        expect(refused, JSON.stringify(env)).toBe(!isExplicitTestProcess(env));
      }
    }
  });
});

describe('the four LU worker entrypoints run the flag gate first (source check)', () => {
  it.each(LU_WORKERS)('$file', ({ file, name, start }) => {
    const src = read(file);
    const call = `await assertLuWorkerBootstrapAdmitFlag('${name}')`;
    const gateIndex = src.indexOf(call);
    expect(gateIndex, `${file} must call ${call}`).toBeGreaterThan(-1);
    expect(gateIndex, 'after the env files are loaded').toBeGreaterThan(src.indexOf('bootstrapWorkerProcess();'));
    expect(gateIndex, 'before the CAS gate').toBeLessThan(src.indexOf('await assertLuWorkerDurableCas('));
    expect(gateIndex, 'before the poller starts').toBeLessThan(src.indexOf(start));
    const mainBody = src.slice(src.indexOf('async function main(): Promise<void> {'));
    expect(mainBody.indexOf(call), 'the first await in main()').toBe(mainBody.indexOf('await '));
    expect(src).toMatch(/main\(\)\.catch\(\(error: unknown\) => \{[\s\S]*?process\.exit\(1\);[\s\S]*?\}\);/);
  });

  it('the worker gate uses the package-root export (one rule, no duplicate)', () => {
    const src = read('server/workers/bootstrap.ts');
    expect(src).toMatch(/await import\('@miljobeslut\/mps-lu'\)/);
    expect(src).toContain("assertBootstrapAdmitFlagOnlyInExplicitTestProcess(env, 'process_startup')");
    expect(src, 'no own reading of the flag').not.toMatch(/env\.MPS_LU_BOOTSTRAP_ADMIT|process\.env\.MPS_LU_BOOTSTRAP_ADMIT/);
  });
});

describe('the web process runs the flag gate before anything starts (server/index.ts, source check)', () => {
  it('imported from the package root and called with the process_startup gate, first in the non-test block', () => {
    const src = read('server/index.ts');
    expect(src).toContain("import { assertBootstrapAdmitFlagOnlyInExplicitTestProcess } from '@miljobeslut/mps-lu';");
    const block = src.indexOf("if (process.env.NODE_ENV !== 'test') {");
    const call = src.indexOf("assertBootstrapAdmitFlagOnlyInExplicitTestProcess(process.env, 'process_startup')");
    expect(block).toBeGreaterThan(0);
    expect(call, 'the gate is called in the block that starts the server').toBeGreaterThan(block);
    for (const later of [
      "assertExecutionAttestationSecretAtStartup(process.env, 'web')",
      'initializeWebSocketServer(server)',
      'startInProcessWorkers()',
      'async function verifyDatabaseSanity',
      'server.listen(',
    ]) {
      const at = src.indexOf(later);
      expect(at, later).toBeGreaterThan(0);
      expect(call, `before ${later}`).toBeLessThan(at);
    }
    expect(src, 'a refusal stops the process').toMatch(
      /assertBootstrapAdmitFlagOnlyInExplicitTestProcess\(process\.env, 'process_startup'\);[\s\S]*?catch[\s\S]*?process\.exit\(1\)/,
    );
    expect(src, 'no own reading of the flag').not.toMatch(/process\.env\.MPS_LU_BOOTSTRAP_ADMIT/);
  });
});
