/**
 * The six terminal-state contract fixtures (frozen design section 1 + section 3; BOOTSTRAP section 6,
 * as amended by plan D1, D5, D6, D8, D9, D10, D15, T3, T11).
 *
 * DECLARATION (T3): fixtures 1-2 drive the pure state machine in mode BOOTSTRAP_RED_ONLY; fixtures
 * 3-6 drive it in mode FULL_PATTERN_PROOF on SYNTHETIC artifacts only, as contract tests of the
 * machine's stop semantics. No agent is invoked, no real diff exists, no Dockerfile is changed, no
 * docker daemon is used, no WRITER runs against the target. FULL_PATTERN_PROOF as a unit is NOT
 * exercised or claimed here (plan D2); only the machine's transitions are.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CasBackedArtifactRepository, MemoryByteStorageBackend } from '@miljobeslut/mps-runtime';
import { describe, expect, it } from 'vitest';
import type { DecisionGateArtifact, PatternVerificationArtifact } from '../src/artifacts';
import { InMemoryAuthorityResolver } from '../src/authority';
import { executeRedProbe, type RedProbeExecutionResult } from '../src/docker/red-probe';
import { verificationFromRedProbeResults } from '../src/docker/verification-from-probes';
import { isPatternProofError } from '../src/errors';
import type { EvidenceLocator } from '../src/evidence';
import { digestOf } from '../src/identity';
import { PatternProofArtifactStore } from '../src/persistence';
import { replayForReproducibility } from '../src/replay';
import {
  applyCandidate,
  applyDecisionGate,
  applyDependencyGraph,
  applyDiscovery,
  applyProofPackage,
  applyRedSynthesis,
  applyVerification,
  AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH,
  startPatternProofRun,
  VERIFY_PHASE_LABEL,
  type PatternProofRunState,
} from '../src/state-machine';
import { validatePatternVerificationArtifact } from '../src/validators';
import {
  FIXTURE_CANDIDATE_SHA,
  FIXTURE_VERIFIER_KEY_ID,
  validCandidate,
  validDiscovery,
  validGate,
  validGraph,
  validManifest,
  validRedPlan,
} from './fixtures/artifacts';
import { buildFixtureProofPackage, FIXTURE_MODE_ENV } from './fixtures/regenerate-proof-package';
import {
  buildVerificationFromRunner,
  buildVerificationFromStageProbes,
  diffResolverReturning,
  driveThroughRedSynthesis,
  driveToVerify,
  happyPathResolver,
  hasNoUndefinedKeys,
  isDeepFrozen,
  probeStages,
  seededResolver,
  SyntheticStageProbeOracle,
  UnavailableVerifierProbeRunner,
  type StageProbeOracle,
  type VerifierProbeRunner,
} from './fixtures/state';

/** Every fixture asserts this: the produced state is frozen, undefined-free, and history records the stop. */
function expectTerminalContract(state: PatternProofRunState, terminal: string, via: string): void {
  expect(state.terminal?.state).toBe(terminal);
  expect(isDeepFrozen(state)).toBe(true);
  expect(hasNoUndefinedKeys(state)).toBe(true);
  expect(digestOf(state)).toMatch(/^sha256:/);
  const last = state.history[state.history.length - 1];
  expect(last).toEqual({ from: last.from, to: terminal, via });
  expect(state.phase).not.toBe('ADVERSARIAL_PROBES');
  expect(state.stoppedByMode).toBeUndefined();
}

const ISOLATION_EVIDENCE: readonly EvidenceLocator[] = [
  { kind: 'signed_attestation', ref: `sha256:${'ab'.repeat(32)}`, note: 'verifier-input-bundle' },
  { kind: 'runtime_result', ref: `verifier-context:sha256:${'cd'.repeat(32)}` },
];

/** A verifier-owned probe result of the given classification, shaped exactly as executeRedProbe returns it. */
function probeResult(
  stageName: 'builder' | 'production-base',
  classification: RedProbeExecutionResult['classification'],
  reasonCode: string,
): RedProbeExecutionResult {
  const probeId = `red-${stageName}-npm-ci-postinstall`;
  return {
    probeId,
    stageName,
    assertedBehavior: `The ${stageName} stage must execute its declared npm install step without failing on absent lifecycle-script dependencies.`,
    authorityEvidence: { kind: 'file_line', ref: 'docker-compose.staging.yml:6-8' },
    classification,
    reasonCode,
    matched: [],
    fidelity: 'host-npm',
    executorRequested: 'host',
    executorUsed: 'host',
    prefix: {
      lineage: ['base', stageName],
      contextSources: ['package*.json'],
      installCommand: 'npm ci --legacy-peer-deps',
      installLine: stageName === 'builder' ? 20 : 37,
      baseImage: 'node:22-alpine',
    },
    toolchainIdentity: 'node v22.22.2; npm 10.9.7; linux x64',
    evidence: [
      { kind: 'runtime_result', ref: `ppe-red-probe:${probeId}:2026-09-30T00:00:00.000Z:${classification}` },
    ],
    startedAt: '2026-09-30T00:00:00.000Z',
    elapsedMs: 1,
    outputExcerpt: '',
    exitStatus: classification === 'PASS' ? 0 : 1,
    timedOut: false,
    installStepStarted: true,
    contextFiles: ['package-lock.json', 'package.json'],
  };
}

// ---------------------------------------------------------------------------------------------
// 1. HUMAN_DECISION_REQUIRED (synthetic contract fixture, not the Docker target)
// ---------------------------------------------------------------------------------------------

describe('terminal 1: HUMAN_DECISION_REQUIRED', () => {
  const ownerLevelGate: DecisionGateArtifact = {
    items: [
      {
        item: 'Does a fix require inventing a new approach?',
        classification: 'MECHANICAL',
        derivation: 'Dockerfile.gcp already solves it.',
      },
      {
        item: 'Should C-anmälan show the whole verdict or a simplified projection?',
        classification: 'HUMAN_DECISION_REQUIRED',
        blockingReason: 'ska C-anmälan visa hela verdictet eller en förenklad projektion?',
      },
    ],
  };

  it('halts at DECISION_GATE with the blockingReason copied; WRITER is never reached; later transitions are absorbed', async () => {
    let state = startPatternProofRun({ runId: 'hdr', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, validDiscovery());
    state = applyDependencyGraph(state, validGraph());
    const halted = applyDecisionGate(state, ownerLevelGate);

    expectTerminalContract(halted, 'HUMAN_DECISION_REQUIRED', 'applyDecisionGate');
    // R1 F16: the record cites the blocking item (index 1) -- it is never evidence-free
    expect(halted.terminal).toEqual({
      state: 'HUMAN_DECISION_REQUIRED',
      atPhase: 'DECISION_GATE',
      blockingReason: 'ska C-anmälan visa hela verdictet eller en förenklad projektion?',
      evidence: [
        {
          kind: 'runtime_result',
          ref: 'decision-gate-item:1:HUMAN_DECISION_REQUIRED',
          note: 'Should C-anmälan show the whole verdict or a simplified projection?',
        },
      ],
    });
    expect(halted.terminal?.evidence).not.toEqual([]);
    expect(halted.phase).toBe('DECISION_GATE');
    expect(halted.artifacts.decisionGate).toEqual(ownerLevelGate);
    expect(halted.artifacts.redPlan).toBeUndefined();
    expect(halted.history.some((t) => t.to === 'WRITER' || t.to === 'RED_SYNTHESIS')).toBe(false);
    // terminal states are absorbing (frozen design section 3): PPE_RUN_TERMINAL, not a phase check
    await expect(applyRedSynthesis(halted, validRedPlan(), happyPathResolver())).rejects.toSatisfy((error) =>
      isPatternProofError(error, 'PPE_RUN_TERMINAL'),
    );
    expect(() => applyDecisionGate(halted, validGate())).toThrow(/PPE_RUN_TERMINAL/);
  });

  it('the first non-MECHANICAL item wins; DECISION_GATE can also trigger MISSING_AUTHORITY / SCOPE_VIOLATION (D9)', () => {
    let state = startPatternProofRun({ runId: 'gate-first', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, validDiscovery());
    state = applyDependencyGraph(state, validGraph());
    for (const classification of ['MISSING_AUTHORITY', 'SCOPE_VIOLATION'] as const) {
      const halted = applyDecisionGate(state, {
        items: [
          ...validGate().items,
          { item: 'first stop', classification, blockingReason: `reason: ${classification}` },
          { item: 'second stop', classification: 'HUMAN_DECISION_REQUIRED', blockingReason: 'later' },
        ],
      });
      expectTerminalContract(halted, classification, 'applyDecisionGate');
      expect(halted.terminal?.atPhase).toBe('DECISION_GATE');
      expect(halted.terminal?.blockingReason).toBe(`reason: ${classification}`);
      // F16: the FIRST blocking item (index 2, after the two MECHANICAL fixture items) is the evidence
      expect(halted.terminal?.evidence).toEqual([
        { kind: 'runtime_result', ref: `decision-gate-item:2:${classification}`, note: 'first stop' },
      ]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. MISSING_AUTHORITY (authority resolution fails closed; no RedPlan emitted)
// ---------------------------------------------------------------------------------------------

describe('terminal 2: MISSING_AUTHORITY', () => {
  const inventedAuthority: EvidenceLocator = { kind: 'file_line', ref: 'services/mapLayerSelection.ts:1' };
  const probeCiting = (authorityEvidence: EvidenceLocator) => ({
    probes: [
      {
        id: 'red-map-layer-unavailable',
        assertedBehavior: 'mapLayerSelection exposes an `unavailable` signal for incomplete layers',
        authorityEvidence,
        command: 'assert the signal exists',
      },
    ],
  });

  it('a probe authority absent from discovery AND graph is MISSING_AUTHORITY even if a resolver would resolve it', async () => {
    let state = startPatternProofRun({ runId: 'ma-1', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, validDiscovery());
    state = applyDependencyGraph(state, validGraph());
    state = applyDecisionGate(state, validGate());
    const generousResolver = seededResolver(validDiscovery(), validGraph(), inventedAuthority);
    expect((await generousResolver.resolve(inventedAuthority)).resolved).toBe(true);

    const halted = await applyRedSynthesis(state, probeCiting(inventedAuthority), generousResolver);
    expectTerminalContract(halted, 'MISSING_AUTHORITY', 'applyRedSynthesis');
    expect(halted.terminal).toEqual({
      state: 'MISSING_AUTHORITY',
      atPhase: 'RED_SYNTHESIS',
      reasonCode: AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH,
      evidence: [{ locator: inventedAuthority, reason: AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH }],
    });
    expect(halted.artifacts.redPlan).toBeUndefined();
    expect(halted.phase).toBe('RED_SYNTHESIS');
  });

  it('a probe authority present in the graph but unresolvable by the resolver is MISSING_AUTHORITY with the resolver reason', async () => {
    let state = startPatternProofRun({ runId: 'ma-2', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, validDiscovery());
    state = applyDependencyGraph(state, validGraph());
    state = applyDecisionGate(state, validGate());
    const inGraph: EvidenceLocator = { kind: 'file_line', ref: 'Dockerfile:37' };
    const emptyResolver = new InMemoryAuthorityResolver([]);

    const halted = await applyRedSynthesis(state, probeCiting(inGraph), emptyResolver);
    expectTerminalContract(halted, 'MISSING_AUTHORITY', 'applyRedSynthesis');
    expect(halted.terminal?.evidence).toEqual([{ locator: inGraph, reason: 'NOT_IN_KNOWN_SET' }]);
    expect(halted.terminal?.reasonCode).toBe('NOT_IN_KNOWN_SET');
    expect(halted.artifacts.redPlan).toBeUndefined();
    expect(halted.stoppedByMode).toBeUndefined();
  });

  it('a resolved authority stores the RedPlan (control) and a mixed plan still fails closed', async () => {
    const control = await driveThroughRedSynthesis('BOOTSTRAP_RED_ONLY');
    expect(control.terminal).toBeUndefined();
    expect(control.artifacts.redPlan).toBeDefined();

    let state = startPatternProofRun({ runId: 'ma-3', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, validDiscovery());
    state = applyDependencyGraph(state, validGraph());
    state = applyDecisionGate(state, validGate());
    const mixed = await applyRedSynthesis(
      state,
      { probes: [...validRedPlan().probes, ...probeCiting(inventedAuthority).probes] },
      happyPathResolver(),
    );
    expect(mixed.terminal?.state).toBe('MISSING_AUTHORITY');
    expect(mixed.terminal?.evidence).toHaveLength(1);
    expect(mixed.artifacts.redPlan).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// 3. SCOPE_VIOLATION (FULL_PATTERN_PROOF, synthetic candidate, independently derived diff)
// ---------------------------------------------------------------------------------------------

describe('terminal 3: SCOPE_VIOLATION', () => {
  it('allowedPaths [Dockerfile] with a derived diff [Dockerfile, package.json] halts before VERIFY', async () => {
    const state = await driveThroughRedSynthesis('FULL_PATTERN_PROOF');
    const honestCandidate = {
      ...validCandidate(),
      allowedPathsCompliance: {
        result: 'FAIL' as const,
        allowedPaths: ['Dockerfile'],
        evidence: [{ kind: 'git_object' as const, ref: `${FIXTURE_CANDIDATE_SHA}:package.json` }],
      },
    };
    const halted = await applyCandidate(state, honestCandidate, {
      diffResolver: diffResolverReturning(['Dockerfile', 'package.json']),
      resolver: happyPathResolver(),
    });
    expectTerminalContract(halted, 'SCOPE_VIOLATION', 'applyCandidate');
    expect(halted.terminal).toEqual({
      state: 'SCOPE_VIOLATION',
      atPhase: 'WRITER',
      reasonCode: 'ALLOWED_PATHS_VIOLATED',
      evidence: [
        {
          kind: 'git_object',
          ref: `${FIXTURE_CANDIDATE_SHA}:package.json`,
          note: 'changed path outside allowedPaths (independently derived)',
        },
      ],
    });
    expect(halted.artifacts.candidate).toBeUndefined();
    expect(halted.artifacts.verification).toBeUndefined();
    // no verification is ever applied after the halt
    await expect(
      applyVerification(
        halted,
        buildVerificationFromStageProbes([], ISOLATION_EVIDENCE),
        happyPathResolver(),
      ),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_RUN_TERMINAL'));
  });

  it('claimed PASS while derived FAIL is SCOPE_VIOLATION with reasonCode PPE_CANDIDATE_COMPLIANCE_INCONSISTENT (D10)', async () => {
    const state = await driveThroughRedSynthesis('FULL_PATTERN_PROOF');
    const halted = await applyCandidate(state, validCandidate(), {
      diffResolver: diffResolverReturning(['Dockerfile', 'package.json']),
      resolver: happyPathResolver(),
    });
    expectTerminalContract(halted, 'SCOPE_VIOLATION', 'applyCandidate');
    expect(halted.terminal?.reasonCode).toBe('PPE_CANDIDATE_COMPLIANCE_INCONSISTENT');
    expect(halted.terminal?.evidence.map((item) => ('ref' in item ? item.ref : ''))).toEqual([
      `${FIXTURE_CANDIDATE_SHA}:package.json`,
    ]);
    expect(halted.artifacts.candidate).toBeUndefined();
  });

  it('claimed FAIL while derived PASS is also inconsistent (either direction, D10); a consistent PASS reaches VERIFY', async () => {
    const state = await driveThroughRedSynthesis('FULL_PATTERN_PROOF');
    const pessimistic = {
      ...validCandidate(),
      allowedPathsCompliance: { ...validCandidate().allowedPathsCompliance, result: 'FAIL' as const },
    };
    const halted = await applyCandidate(state, pessimistic, {
      diffResolver: diffResolverReturning(['Dockerfile']),
      resolver: happyPathResolver(),
    });
    expectTerminalContract(halted, 'SCOPE_VIOLATION', 'applyCandidate');
    expect(halted.terminal?.reasonCode).toBe('PPE_CANDIDATE_COMPLIANCE_INCONSISTENT');
    // R1 F16: no offending path exists, so the record cites the derivation itself (never evidence: [])
    expect(halted.terminal?.evidence).toEqual([
      {
        kind: 'runtime_result',
        ref: 'derived-compliance:PASS;claimed:FAIL',
        note: 'independently derived 1 changed path(s), none outside allowedPaths',
      },
    ]);

    const admitted = await applyCandidate(state, validCandidate(), {
      diffResolver: diffResolverReturning(['Dockerfile']),
      resolver: happyPathResolver(),
    });
    expect(admitted.phase).toBe('VERIFY');
    expect(admitted.artifacts.candidate).toEqual(validCandidate());
  });
});

// ---------------------------------------------------------------------------------------------
// 4. FALSIFIED (frozen candidate in the real CAS repository; verifier-owned oracle breaks it)
// ---------------------------------------------------------------------------------------------

describe('terminal 4: FALSIFIED', () => {
  /** The synthetic candidate closes only production-base (adds --ignore-scripts); builder is unchanged. */
  const oracle: StageProbeOracle = new SyntheticStageProbeOracle({
    stages: { builder: { ignoreScripts: false }, 'production-base': { ignoreScripts: true } },
  });
  const STAGES = ['builder', 'production-base'] as const;

  async function frozenCandidateInCas() {
    const store = new PatternProofArtifactStore({
      repository: new CasBackedArtifactRepository(new MemoryByteStorageBackend()),
    });
    const ref = await store.persistArtifact('candidate', validCandidate());
    return { store, ref };
  }

  it('the verifier-owned oracle independently fails the builder stage', async () => {
    const outcomes = await probeStages(oracle, STAGES);
    expect(outcomes.map((o) => [o.stageName, o.result.classification])).toEqual([
      ['builder', 'FAIL'],
      ['production-base', 'PASS'],
    ]);
    const verification = validatePatternVerificationArtifact(
      buildVerificationFromStageProbes(outcomes, ISOLATION_EVIDENCE),
    );
    expect(verification.verdict).toBe('FALSIFIED');
    expect(
      verification.claims.every(
        (c) => c.materialInvariant && c.evidenceGrounds.includes('VERIFIER_OWNED_PROBE'),
      ),
    ).toBe(true);
  });

  it('F14: through src verificationFromRedProbeResults, a FAIL probe result yields FALSIFIED (any FAIL, no BLOCKED)', async () => {
    const results = [
      probeResult('builder', 'FAIL', 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND'),
      probeResult('production-base', 'PASS', 'INSTALL_COMPLETED'),
    ];
    const verification = verificationFromRedProbeResults(results, {
      isolationEvidence: ISOLATION_EVIDENCE,
      verifierAuthority: FIXTURE_VERIFIER_KEY_ID,
    });
    expect(verification.verdict).toBe('FALSIFIED');
    expect(verification.reasonCode).toBeUndefined();
    expect(verification.claims).toHaveLength(2);
    expect(
      verification.claims.every(
        (c) => c.materialInvariant && c.evidenceGrounds.includes('VERIFIER_OWNED_PROBE'),
      ),
    ).toBe(true);
    expect(verification.claims[0].claim).toContain('red-builder-npm-ci-postinstall');
    expect(verification.claims[0].claim).toContain('FAIL LIFECYCLE_SCRIPT_MODULE_NOT_FOUND');
    expect(verification.claims[0].claim).toContain(FIXTURE_VERIFIER_KEY_ID);
    expect(Object.isFrozen(verification)).toBe(true);
    // all PASS -> ACCEPT; the verdict is derived, not fixed
    expect(
      verificationFromRedProbeResults(
        [
          probeResult('builder', 'PASS', 'INSTALL_COMPLETED'),
          probeResult('production-base', 'PASS', 'INSTALL_COMPLETED'),
        ],
        { isolationEvidence: ISOLATION_EVIDENCE, verifierAuthority: FIXTURE_VERIFIER_KEY_ID },
      ).verdict,
    ).toBe('ACCEPT');
    // zero results / an unknown classification / no authority are inadmissible, never a verdict
    expect(() =>
      verificationFromRedProbeResults([], {
        isolationEvidence: ISOLATION_EVIDENCE,
        verifierAuthority: FIXTURE_VERIFIER_KEY_ID,
      }),
    ).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() =>
      verificationFromRedProbeResults([{ ...results[1], classification: 'GREEN' as never }], {
        isolationEvidence: ISOLATION_EVIDENCE,
        verifierAuthority: FIXTURE_VERIFIER_KEY_ID,
      }),
    ).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() =>
      verificationFromRedProbeResults(results, {
        isolationEvidence: ISOLATION_EVIDENCE,
        verifierAuthority: ' ',
      }),
    ).toThrow(/PPE_SCHEMA_INVALID/);
    // and the machine takes the derived FALSIFIED to the terminal state (isolation evidence resolvable, D1)
    const resolver = seededResolver(
      validDiscovery(),
      validGraph(),
      validRedPlan(),
      validCandidate(),
      ISOLATION_EVIDENCE,
    );
    const halted = await applyVerification(await driveToVerify(resolver), verification, resolver);
    expectTerminalContract(halted, 'FALSIFIED', 'applyVerification');
    expect(halted.terminal?.evidence).toEqual(ISOLATION_EVIDENCE);
  });

  it('terminal FALSIFIED at VERIFY+ADVERSARIAL_PROBES; the frozen candidate cannot be edited in place (WORM)', async () => {
    const { store, ref } = await frozenCandidateInCas();
    const frozenCandidate = await store.loadArtifact({ ...ref, kind: 'candidate' });
    const resolver = seededResolver(
      validDiscovery(),
      validGraph(),
      validRedPlan(),
      frozenCandidate,
      ISOLATION_EVIDENCE,
    );
    const atVerify = await driveToVerify(resolver, frozenCandidate);
    expect(atVerify.phase).toBe('VERIFY');

    const verification = buildVerificationFromStageProbes(
      await probeStages(oracle, STAGES),
      ISOLATION_EVIDENCE,
    );
    const halted = await applyVerification(atVerify, verification, resolver);
    expectTerminalContract(halted, 'FALSIFIED', 'applyVerification');
    expect(halted.terminal).toEqual({
      state: 'FALSIFIED',
      atPhase: VERIFY_PHASE_LABEL,
      evidence: ISOLATION_EVIDENCE,
    });
    expect(halted.artifacts.verification?.verdict).toBe('FALSIFIED');
    expect(halted.artifacts.candidate).toEqual(frozenCandidate);
    expect(halted.artifacts.proofPackage).toBeUndefined();

    // frozen design section 6: a falsified candidate is NOT edited in place -- the CAS WORM guard fires
    const modifiedCandidate = {
      ...validCandidate(),
      candidateSha: 'ffffffffffffffffffffffffffffffffffffffff',
    };
    await expect(store.persistUnderId(ref.artifactId, ref.artifactType, modifiedCandidate)).rejects.toThrow(
      /WORM violation/,
    );
    expect(await store.loadArtifact(ref)).toEqual(frozenCandidate);
  });

  it('NEGATIVE (D1): FALSIFIED with unresolvable isolationEvidence is NOT_PROVEN / VERIFICATION_BLOCKED, never FALSIFIED', async () => {
    const atVerify = await driveToVerify();
    const unresolvable: readonly EvidenceLocator[] = [
      { kind: 'runtime_result', ref: 'verifier-context:never-instantiated' },
    ];
    const verification = buildVerificationFromStageProbes(await probeStages(oracle, STAGES), unresolvable);
    expect(verification.verdict).toBe('FALSIFIED');
    const halted = await applyVerification(atVerify, verification, happyPathResolver());
    expectTerminalContract(halted, 'NOT_PROVEN', 'applyVerification');
    expect(halted.terminal).toEqual({
      state: 'NOT_PROVEN',
      atPhase: VERIFY_PHASE_LABEL,
      reasonCode: 'VERIFICATION_BLOCKED',
      evidence: [{ locator: unresolvable[0], reason: 'NOT_IN_KNOWN_SET' }],
    });
    expect(halted.artifacts.verification).toBeUndefined();
  });

  it('NEGATIVE (D1): ACCEPT with unresolvable isolationEvidence is NOT_PROVEN as well, never ASSEMBLE_EVIDENCE', async () => {
    const atVerify = await driveToVerify();
    const accept: PatternVerificationArtifact = {
      claims: [
        { claim: 'both stages pass', evidenceGrounds: ['VERIFIER_OWNED_PROBE'], materialInvariant: true },
      ],
      verdict: 'ACCEPT',
      isolationEvidence: [{ kind: 'signed_attestation', ref: `sha256:${'99'.repeat(32)}` }],
    };
    const halted = await applyVerification(atVerify, accept, happyPathResolver());
    expect(halted.terminal?.state).toBe('NOT_PROVEN');
    expect(halted.terminal?.reasonCode).toBe('VERIFICATION_BLOCKED');
    expect(halted.phase).toBe('VERIFY');
  });
});

// ---------------------------------------------------------------------------------------------
// 5. NOT_PROVEN (a mandatory verifier probe cannot execute at all)
// ---------------------------------------------------------------------------------------------

describe('terminal 5: NOT_PROVEN', () => {
  it('F14: a REAL BLOCKED executeRedProbe result (unreachable docker daemon) -> NOT_PROVEN / VERIFICATION_BLOCKED through src, never ACCEPT or FALSIFIED', async () => {
    const blocked = await executeRedProbe({
      repoRoot: process.cwd(),
      stageName: 'production-base',
      executor: 'docker',
      dockerHost: 'unix:///nonexistent/ppe.sock',
      timeoutMs: 60_000,
    });
    expect(blocked.classification).toBe('BLOCKED');
    expect(blocked.reasonCode).toBe('DOCKER_UNAVAILABLE');
    expect(blocked.executorUsed).toBe('none');

    // one PASS probe beside the BLOCKED one must not rescue the verdict
    const results = [blocked, probeResult('builder', 'PASS', 'INSTALL_COMPLETED')];
    const verification = verificationFromRedProbeResults(results, {
      isolationEvidence: ISOLATION_EVIDENCE,
      verifierAuthority: FIXTURE_VERIFIER_KEY_ID,
    });
    expect(verification.verdict).toBe('NOT_PROVEN');
    expect(verification.verdict).not.toBe('ACCEPT');
    expect(verification.verdict).not.toBe('FALSIFIED');
    expect(verification.reasonCode).toBe('VERIFICATION_BLOCKED');
    expect(verification.claims).toHaveLength(2);
    expect(verification.claims[0]).toMatchObject({
      materialInvariant: false,
      evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
    });
    expect(verification.claims[0].claim).toContain('could not execute: BLOCKED DOCKER_UNAVAILABLE');
    expect(verification.claims[1]).toMatchObject({
      materialInvariant: true,
      evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
    });
    // a BLOCKED beside a FAIL is NOT_PROVEN as well (BLOCKED outranks FAIL)
    expect(
      verificationFromRedProbeResults(
        [probeResult('builder', 'FAIL', 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND'), blocked],
        {
          isolationEvidence: ISOLATION_EVIDENCE,
          verifierAuthority: FIXTURE_VERIFIER_KEY_ID,
        },
      ).verdict,
    ).toBe('NOT_PROVEN');

    const atVerify = await driveToVerify();
    const halted = await applyVerification(atVerify, verification, happyPathResolver());
    expectTerminalContract(halted, 'NOT_PROVEN', 'applyVerification');
    expect(halted.terminal).toEqual({
      state: 'NOT_PROVEN',
      atPhase: VERIFY_PHASE_LABEL,
      reasonCode: 'VERIFICATION_BLOCKED',
      evidence: ISOLATION_EVIDENCE,
    });
    expect(halted.phase).toBe('VERIFY');
    expect(halted.artifacts.verification?.verdict).toBe('NOT_PROVEN');
    expect(halted.artifacts.proofPackage).toBeUndefined();
  }, 120_000);

  it('an unavailable probe runner yields verdict NOT_PROVEN / VERIFICATION_BLOCKED and the machine halts there', async () => {
    const runner: VerifierProbeRunner = new UnavailableVerifierProbeRunner('docker daemon unreachable');
    const availability = await runner.run('red-production-base-npm-ci-postinstall');
    expect(availability).toEqual({ available: false, reason: 'docker daemon unreachable' });

    const verification = validatePatternVerificationArtifact(
      buildVerificationFromRunner('red-production-base-npm-ci-postinstall', availability, []),
    );
    expect(verification.verdict).toBe('NOT_PROVEN');
    expect(verification.verdict).not.toBe('ACCEPT');
    expect(verification.verdict).not.toBe('FALSIFIED');
    expect(verification.reasonCode).toBe('VERIFICATION_BLOCKED');

    const atVerify = await driveToVerify();
    const halted = await applyVerification(atVerify, verification, happyPathResolver());
    expectTerminalContract(halted, 'NOT_PROVEN', 'applyVerification');
    // A NOT_PROVEN record is never evidence-free (R1 F16 follow-up): with an empty isolationEvidence
    // the record names the declared reason as a runtime_result locator.
    expect(halted.terminal).toEqual({
      state: 'NOT_PROVEN',
      atPhase: VERIFY_PHASE_LABEL,
      reasonCode: 'VERIFICATION_BLOCKED',
      evidence: [{ kind: 'runtime_result', ref: 'verification:NOT_PROVEN:VERIFICATION_BLOCKED' }],
    });
    expect(halted.phase).toBe('VERIFY');
    expect(halted.artifacts.verification?.verdict).toBe('NOT_PROVEN');
    expect(halted.artifacts.proofPackage).toBeUndefined();
  });

  it('a NOT_PROVEN artifact carries its own reasonCode through; a missing reasonCode is rejected by the validator', async () => {
    const atVerify = await driveToVerify();
    const halted = await applyVerification(
      atVerify,
      {
        claims: [
          { claim: 'db required', evidenceGrounds: ['INDEPENDENT_CODE_DERIVATION'], materialInvariant: true },
        ],
        verdict: 'NOT_PROVEN',
        reasonCode: 'REQUIRED_DATABASE_UNAVAILABLE',
        isolationEvidence: [],
      },
      happyPathResolver(),
    );
    expect(halted.terminal?.reasonCode).toBe('REQUIRED_DATABASE_UNAVAILABLE');
    await expect(
      applyVerification(
        atVerify,
        {
          claims: [{ claim: 'x', evidenceGrounds: ['WRITER_TEST_REGRESSION'], materialInvariant: false }],
          verdict: 'NOT_PROVEN',
          isolationEvidence: [],
        },
        happyPathResolver(),
      ),
    ).rejects.toThrow(/PPE_REASON_CODE_REQUIRED/);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. NON_REPRODUCIBLE (semantic input closure: an undeclared env input leaks into the result)
// ---------------------------------------------------------------------------------------------

describe('terminal 6: NON_REPRODUCIBLE', () => {
  const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  const fixturePath = fileURLToPath(new URL('./fixtures/regenerate-proof-package.ts', import.meta.url));

  /** Spawns the fixture program once per iteration with PPE_FIXTURE_MODE = modes[iteration] (T11). */
  function regenerateWith(modes: readonly string[]) {
    return async (iteration: number): Promise<unknown> => {
      const result = spawnSync(process.execPath, [tsxCli, fixturePath], {
        env: { ...process.env, [FIXTURE_MODE_ENV]: modes[iteration] },
        encoding: 'utf8',
        timeout: 60000,
      });
      if (result.error !== undefined || result.status !== 0) {
        throw new Error(
          `fixture program failed (status ${String(result.status)}): ${result.error?.message ?? ''}\n${result.stderr}`,
        );
      }
      return JSON.parse(result.stdout);
    };
  }

  async function atAssembleEvidence(): Promise<PatternProofRunState> {
    const resolver = happyPathResolver();
    const atVerify = await driveToVerify(resolver);
    const accepted = await applyVerification(
      atVerify,
      buildVerificationFromStageProbes(
        await probeStages(
          new SyntheticStageProbeOracle({
            stages: { builder: { ignoreScripts: true }, 'production-base': { ignoreScripts: true } },
          }),
          ['builder', 'production-base'],
        ),
        [{ kind: 'signed_attestation', ref: `sha256:${'b2'.repeat(32)}`, note: 'verifier-input-bundle' }],
      ),
      resolver,
    );
    expect(accepted.phase).toBe('ASSEMBLE_EVIDENCE');
    return accepted;
  }

  it('the declared manifest is schema-valid and complete, yet mode A then mode B regenerate different packages -> NON_REPRODUCIBLE', async () => {
    const expectedPackage = buildFixtureProofPackage('A');
    const manifest = validManifest();
    expect(expectedPackage.inputManifest).toEqual(manifest);
    // R1 F15: the leaked input is absent from the DECLARED environment yet present in the RESULT
    expect(Object.keys(manifest.environmentConfig)).not.toContain(FIXTURE_MODE_ENV);
    expect(expectedPackage.provenInvariants).toContain('fixture-mode:A');
    expect(JSON.stringify(manifest)).not.toContain('fixture-mode');

    const comparison = await replayForReproducibility(regenerateWith(['A', 'B']), {
      manifest,
      expectedPackage,
    });
    expect(comparison.reproducible).toBe(false);
    expect(comparison.observedDigests[0]).toBe(comparison.expectedPackageDigest);
    expect(comparison.observedDigests[1]).not.toBe(comparison.expectedPackageDigest);

    const halted = applyProofPackage(await atAssembleEvidence(), expectedPackage, comparison);
    expectTerminalContract(halted, 'NON_REPRODUCIBLE', 'applyProofPackage');
    expect(halted.terminal).toEqual({
      state: 'NON_REPRODUCIBLE',
      atPhase: 'ASSEMBLE_EVIDENCE',
      reasonCode: 'REPLAY_DIGEST_DIVERGED',
      evidence: [
        {
          kind: 'runtime_result',
          ref: `replay-iteration:1:${comparison.observedDigests[1]}`,
          note: `expected ${comparison.expectedPackageDigest}`,
        },
      ],
    });
    expect(halted.artifacts.proofPackage).toBeUndefined();
    expect(halted.phase).toBe('ASSEMBLE_EVIDENCE');
  }, 120000);

  it('CONTROL: the same mode twice regenerates byte-identical packages -> DONE', async () => {
    const expectedPackage = buildFixtureProofPackage('A');
    const comparison = await replayForReproducibility(regenerateWith(['A', 'A']), {
      manifest: validManifest(),
      expectedPackage,
    });
    expect(comparison.reproducible).toBe(true);
    expect(comparison.observedDigests).toEqual([
      comparison.expectedPackageDigest,
      comparison.expectedPackageDigest,
    ]);

    const done = applyProofPackage(await atAssembleEvidence(), expectedPackage, comparison);
    expect(done.phase).toBe('DONE');
    expect(done.terminal).toBeUndefined();
    expect(done.artifacts.proofPackage).toEqual(expectedPackage);
    expect(isDeepFrozen(done)).toBe(true);
    expect(done.history[done.history.length - 1]).toEqual({
      from: 'ASSEMBLE_EVIDENCE',
      to: 'DONE',
      via: 'applyProofPackage',
    });
  }, 120000);
});
