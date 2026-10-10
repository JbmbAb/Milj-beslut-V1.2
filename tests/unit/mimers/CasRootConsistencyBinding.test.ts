import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MimersIntegration,
  resetMimersCasCacheForTests,
} from '../../../packages/mps-runtime/src/mimers/MimersIntegration';
import { resolveMimersBackendFromEnv } from '../../../server/mimers/resolveMimersBackendFromEnv';

describe('CAS_ROOT consistency: MimersIntegration + persistent backend', () => {
  let parent: string;
  let casRoot: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    parent = mkdtempSync(path.join(tmpdir(), 'cas-coherent-'));
    casRoot = path.join(parent, 'cas');
    mkdirSync(casRoot);
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(parent, { recursive: true, force: true });
  });

  it('E: persistent backend and MimersIntegration agree on same CAS physical root', async () => {
    const env = {
      NODE_ENV: 'development',
      CAS_ROOT: casRoot,
      MIMERS_DURABILITY_MODE: 'none',
      MIMERS_REQUIRED: '1',
    } as NodeJS.ProcessEnv;

    const integration = await MimersIntegration.create({ env, forceMimers: true });
    expect(integration.isMimersBacked).toBe(true);
    expect(MimersIntegration.getCachedCasRootForTests()).toBe(path.resolve(casRoot));

    const backend = await resolveMimersBackendFromEnv({ env });
    expect(backend).not.toBeNull();
    expect(path.resolve(backend!.rootDir, 'cas')).toBe(path.resolve(casRoot));
  });

  it('missing CAS_ROOT: both fail closed without MIMERS_ROOT fallback', async () => {
    const mimers = path.join(parent, 'mimers');
    mkdirSync(mimers);
    const env = {
      NODE_ENV: 'development',
      MIMERS_ROOT: mimers,
      MIMERS_REQUIRED: '1',
      MIMERS_DURABILITY_MODE: 'none',
    } as NodeJS.ProcessEnv;

    await expect(MimersIntegration.create({ env, forceMimers: true })).rejects.toThrow(/CAS_ROOT/);
    await expect(resolveMimersBackendFromEnv({ env })).rejects.toThrow(/CAS_ROOT/);
  });
});
