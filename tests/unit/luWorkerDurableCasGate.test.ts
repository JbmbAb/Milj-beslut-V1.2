// tests/unit/luWorkerDurableCasGate.test.ts
//
// U30-A: the four LU workers persist governed artifacts in the durable Mimers CAS, but they used
// to START without one: each job opened the CAS on its own (fail-closed per job), so a worker
// with no MIMERS_ROOT kept running and turned every job into FAILED. The worker must instead
// refuse to start (exit 1) with the cause, before it begins polling.
//
// Hermetic: the gate is exercised directly with explicit env objects and a temp root. The worker
// entry files are checked as source text only -- they are never executed here, because
// bootstrapWorkerProcess() loads .env.local and the pollers reach the database.

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertLuWorkerDurableCas } from '../../server/workers/bootstrap';
import { resetMimersCasCacheForTests } from '../../packages/mps-runtime/src/repository/createKernelArtifactRepository';

const LU_WORKERS = [
  { file: 'server/workers/lu-project-context-bootstrap-worker.ts', name: 'lu-bootstrap-worker', start: 'startLuProjectContextBootstrapWorker(' },
  { file: 'server/workers/lu-viewer-capability-worker.ts', name: 'lu-viewer-capability-worker', start: 'startViewerCapabilityProvisioningWorker(' },
  { file: 'server/workers/lu-execution-identity-v3-worker.ts', name: 'lu-identity-v3-worker', start: 'startLocalizationIdentityProvisioningWorker(' },
  { file: 'server/workers/lu-geometry-supersession-worker.ts', name: 'lu-geometry-supersession-worker', start: 'startGeometrySupersessionProvisioningWorker(' },
] as const;

describe('assertLuWorkerDurableCas (U30-A worker start gate)', () => {
  let root: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    root = mkdtempSync(path.join(tmpdir(), 'lu-worker-cas-'));
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses to start without MIMERS_ROOT, naming the worker and the cause', async () => {
    await expect(
      assertLuWorkerDurableCas('lu-bootstrap-worker', { NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/^lu-bootstrap-worker: durable Mimers CAS is not ready -- refusing to start\. MIMERS_ROOT_REQUIRED: /);
  });

  it('refuses to start on LU_MPS_CAS=memory outside test', async () => {
    await expect(
      assertLuWorkerDurableCas('lu-viewer-capability-worker', {
        NODE_ENV: 'production',
        MIMERS_ROOT: root,
        LU_MPS_CAS: 'memory',
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/LU_MPS_CAS_MEMORY_OUTSIDE_TEST/);
  });

  it('refuses to start when the durable CAS cannot initialize', async () => {
    const blocker = path.join(root, 'not-a-directory');
    const fs = await import('node:fs');
    fs.writeFileSync(blocker, 'block');
    await expect(
      assertLuWorkerDurableCas('lu-identity-v3-worker', {
        NODE_ENV: 'development',
        MIMERS_ROOT: blocker,
        MIMERS_DURABILITY_MODE: 'none',
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/^lu-identity-v3-worker: durable Mimers CAS is not ready -- refusing to start\./);
  });

  it('passes and initializes the CAS under an explicit MIMERS_ROOT', async () => {
    await expect(
      assertLuWorkerDurableCas('lu-geometry-supersession-worker', {
        NODE_ENV: 'development',
        MIMERS_ROOT: root,
        MIMERS_DURABILITY_MODE: 'none',
      } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
    expect(existsSync(path.join(root, 'cas', 'objects'))).toBe(true);
  });
});

describe('the four LU worker entrypoints gate on the durable CAS before polling (source check)', () => {
  it.each(LU_WORKERS)('$file', ({ file, name, start }) => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    const gateCall = `await assertLuWorkerDurableCas('${name}')`;
    const gateIndex = source.indexOf(gateCall);
    const startIndex = source.indexOf(start);

    expect(gateIndex, `${file} must call ${gateCall}`).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(-1);
    expect(gateIndex, 'gate must run before the poller starts').toBeLessThan(startIndex);
    // A rejected gate must end the process with exit 1, not an unhandled rejection or a running poller.
    expect(source).toMatch(/main\(\)\.catch\(\(error: unknown\) => \{[\s\S]*?process\.exit\(1\);[\s\S]*?\}\);/);
  });
});
