import { describe, expect, it } from 'vitest';
import { digestOf } from '../src/identity';
import { RED_REASON_CODE } from '../src/docker/classify';
import { FROZEN_RED_PROBES, redProbeForStage } from '../src/docker/red-plan-probes';
import { executeRedProbe, type RedProbeExecutionResult } from '../src/docker/red-probe';
import { REPO_ROOT } from './fixtures/dockerfiles';
import { FROZEN_TARGET_RED_PLAN } from './fixtures/frozen-target-artifacts';

/**
 * Live end-to-end RED probes (plan section 1: opt-in). They run `npm ci` for real (warm cache: ~30-40s
 * per stage) and are skipped unless PPE_RUN_LIVE_PROBES=1. The docker executor is exercised by the
 * CLI in the unit's audit evidence, not here.
 */
const LIVE = process.env.PPE_RUN_LIVE_PROBES === '1';
const itLive = LIVE ? it : it.skip;
const LIVE_TIMEOUT_MS = 900_000;

function assertCanonical(result: RedProbeExecutionResult): void {
  // deep-frozen and canonicalizable (no undefined-valued keys, no Date, no class instances)
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.prefix)).toBe(true);
  expect(Object.isFrozen(result.evidence)).toBe(true);
  expect(digestOf(result)).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.stringify(result)).not.toContain('undefined');
}

describe('frozen RED probes (BOOTSTRAP section 5.4, verbatim)', () => {
  it('equal the frozen target RedPlanArtifact probes, keyed by stage', () => {
    expect(FROZEN_RED_PROBES['production-base']).toEqual(FROZEN_TARGET_RED_PLAN.probes[0]);
    expect(FROZEN_RED_PROBES.builder).toEqual(FROZEN_TARGET_RED_PLAN.probes[1]);
    expect(redProbeForStage('builder').id).toBe('red-builder-npm-ci-postinstall');
    expect(redProbeForStage('production-base').id).toBe('red-production-base-npm-ci-postinstall');
    expect(() => redProbeForStage('web')).toThrow(/PPE_STAGE_NOT_FOUND/);
    expect(Object.isFrozen(FROZEN_RED_PROBES.builder.authorityEvidence)).toBe(true);
  });
});

describe('executeRedProbe (offline): explicit docker executor without a reachable daemon', () => {
  it('is BLOCKED with reasonCode DOCKER_UNAVAILABLE and a canonicalizable result', async () => {
    const result = await executeRedProbe({
      repoRoot: REPO_ROOT,
      stageName: 'production-base',
      executor: 'docker',
      dockerHost: 'unix:///nonexistent/ppe-no-such-daemon.sock',
      timeoutMs: 60_000,
    });
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('DOCKER_UNAVAILABLE');
    expect(result.executorRequested).toBe('docker');
    expect(result.executorUsed).toBe('none');
    expect(result.fidelity).toBe('docker-stage-prefix');
    expect(result.blockedReason).toBeTruthy();
    expect(result.probeId).toBe('red-production-base-npm-ci-postinstall');
    expect(result.prefix).toMatchObject({
      lineage: ['base', 'production-base'],
      contextSources: ['package*.json'],
      installCommand: 'npm ci --omit=dev --legacy-peer-deps',
      installLine: 37,
      baseImage: 'node:22-alpine',
    });
    expect(result.evidence[0]).toMatchObject({ kind: 'runtime_result' });
    expect(result.evidence[0].ref).toMatch(
      /^ppe-red-probe:red-production-base-npm-ci-postinstall:.+:BLOCKED$/,
    );
    expect(
      result.evidence.some((locator) => locator.kind === 'file_line' && locator.ref === 'Dockerfile:37'),
    ).toBe(true);
    assertCanonical(result);
  }, 120_000);
});

describe('executeRedProbe (LIVE, host executor; set PPE_RUN_LIVE_PROBES=1 to run)', () => {
  for (const stage of ['production-base', 'builder'] as const) {
    itLive(
      `${stage}: RED confirmed today (FAIL, ${RED_REASON_CODE}, fidelity host-npm)`,
      async () => {
        const result = await executeRedProbe({
          repoRoot: REPO_ROOT,
          stageName: stage,
          executor: 'host',
          timeoutMs: LIVE_TIMEOUT_MS - 60_000,
        });
        expect(result.classification).toBe('FAIL');
        expect(result.reasonCode).toBe(RED_REASON_CODE);
        expect(result.fidelity).toBe('host-npm');
        expect(result.executorUsed).toBe('host');
        expect(result.installStepStarted).toBe(true);
        expect(result.exitStatus).toBe(1);
        expect(result.matched.some((line) => line.includes("Cannot find module '"))).toBe(true);
        expect(result.matched.some((line) => line.includes("code: 'MODULE_NOT_FOUND'"))).toBe(true);
        expect(result.probeId).toBe(FROZEN_RED_PROBES[stage].id);
        expect(result.contextFiles).toEqual(
          stage === 'builder'
            ? ['package-lock.json', 'package.json', 'tsconfig.json']
            : ['package-lock.json', 'package.json'],
        );
        assertCanonical(result);
      },
      LIVE_TIMEOUT_MS,
    );
  }
});
