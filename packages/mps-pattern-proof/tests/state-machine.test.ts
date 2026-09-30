import { describe, expect, it } from 'vitest';
import { InMemoryAuthorityResolver } from '../src/authority';
import { isPatternProofError } from '../src/errors';
import { digestOf } from '../src/identity';
import {
  applyCandidate,
  applyDecisionGate,
  applyDependencyGraph,
  applyDiscovery,
  applyProofPackage,
  applyRedSynthesis,
  applyVerification,
  assertPhase,
  driveBootstrapSequence,
  establishedLocatorKeys,
  PATTERN_PROOF_PHASES,
  PATTERN_PROOF_TERMINAL_STATES,
  startPatternProofRun,
  summarizeRunState,
  VERIFY_PHASE_LABEL,
  type PatternProofRunState,
} from '../src/state-machine';
import { validateDependencyGraphArtifact, validateDiscoveryArtifact } from '../src/validators';
import { locatorKey } from '../src/evidence';
import {
  FIXTURE_BASE_SHA,
  FIXTURE_CANDIDATE_SHA,
  validCandidate,
  validDiscovery,
  validGate,
  validGraph,
  validManifest,
  validProofPackage,
  validRedPlan,
  validVerification,
} from './fixtures/artifacts';
import {
  boundComparison,
  diffResolverReturning,
  driveThroughRedSynthesis,
  driveToAssembleEvidence,
  happyPathResolver,
  hasNoUndefinedKeys,
  isDeepFrozen,
  seededResolver,
} from './fixtures/state';

/** Runs the whole FULL_PATTERN_PROOF happy path and returns every intermediate state in order. */
async function happyPath(): Promise<readonly PatternProofRunState[]> {
  const resolver = happyPathResolver();
  const states: PatternProofRunState[] = [];
  let state = startPatternProofRun({ runId: 'ppe-happy', mode: 'FULL_PATTERN_PROOF' });
  states.push(state);
  state = applyDiscovery(state, validDiscovery());
  states.push(state);
  state = applyDependencyGraph(state, validGraph());
  states.push(state);
  state = applyDecisionGate(state, validGate());
  states.push(state);
  state = await applyRedSynthesis(state, validRedPlan(), resolver);
  states.push(state);
  state = await applyCandidate(state, validCandidate(), {
    diffResolver: diffResolverReturning(['Dockerfile']),
    resolver,
  });
  states.push(state);
  state = await applyVerification(state, validVerification(), resolver);
  states.push(state);
  state = applyProofPackage(state, validProofPackage(), boundComparison(validProofPackage()));
  states.push(state);
  return states;
}

describe('state machine: the frozen enums', () => {
  it('has exactly the frozen phases, the frozen six terminal states and the two modes', () => {
    expect(PATTERN_PROOF_PHASES).toEqual([
      'DISCOVER',
      'BUILD_GRAPH',
      'DECISION_GATE',
      'RED_SYNTHESIS',
      'WRITER',
      'VERIFY',
      'ADVERSARIAL_PROBES',
      'ASSEMBLE_EVIDENCE',
      'DONE',
    ]);
    expect(PATTERN_PROOF_TERMINAL_STATES).toEqual([
      'HUMAN_DECISION_REQUIRED',
      'MISSING_AUTHORITY',
      'SCOPE_VIOLATION',
      'FALSIFIED',
      'NOT_PROVEN',
      'NON_REPRODUCIBLE',
    ]);
    expect(VERIFY_PHASE_LABEL).toBe('VERIFY+ADVERSARIAL_PROBES');
  });

  it('startPatternProofRun validates runId and mode', () => {
    expect(() => startPatternProofRun({ runId: '', mode: 'FULL_PATTERN_PROOF' })).toThrow(
      /PPE_SCHEMA_INVALID/,
    );
    expect(() =>
      startPatternProofRun({ runId: 'x', mode: 'WRITER_GREEN' as unknown as 'FULL_PATTERN_PROOF' }),
    ).toThrow(/PPE_SCHEMA_INVALID/);
    const state = startPatternProofRun({ runId: 'x', mode: 'BOOTSTRAP_RED_ONLY' });
    expect(state).toEqual({
      runId: 'x',
      mode: 'BOOTSTRAP_RED_ONLY',
      phase: 'DISCOVER',
      artifacts: {},
      history: [],
    });
    expect(isDeepFrozen(state)).toBe(true);
  });

  it('F4: startPatternProofRun records an optional 40-hex baseSha and rejects any other form', () => {
    const bound = startPatternProofRun({ runId: 'x', mode: 'FULL_PATTERN_PROOF', baseSha: FIXTURE_BASE_SHA });
    expect(bound.baseSha).toBe(FIXTURE_BASE_SHA);
    expect(Object.keys(bound)).toContain('baseSha');
    expect(hasNoUndefinedKeys(bound)).toBe(true);
    expect(summarizeRunState(bound).baseSha).toBe(FIXTURE_BASE_SHA);
    for (const baseSha of ['HEAD', 'main', FIXTURE_BASE_SHA.toUpperCase(), 'a'.repeat(39), '']) {
      expect(() => startPatternProofRun({ runId: 'x', mode: 'FULL_PATTERN_PROOF', baseSha })).toThrow(
        /PPE_SCHEMA_INVALID/,
      );
    }
    // the baseSha travels through every successor state
    const next = applyDiscovery(bound, validDiscovery());
    expect(next.baseSha).toBe(FIXTURE_BASE_SHA);
    expect(summarizeRunState(next)).toMatchObject({ baseSha: FIXTURE_BASE_SHA, phase: 'BUILD_GRAPH' });
  });
});

describe('state machine: FULL_PATTERN_PROOF happy path DISCOVER -> DONE on synthetic artifacts', () => {
  it('walks every phase in order, stores each admitted artifact and ends at DONE without a terminal', async () => {
    const states = await happyPath();
    expect(states.map((state) => state.phase)).toEqual([
      'DISCOVER',
      'BUILD_GRAPH',
      'DECISION_GATE',
      'RED_SYNTHESIS',
      'WRITER',
      'VERIFY',
      'ASSEMBLE_EVIDENCE',
      'DONE',
    ]);
    const done = states[states.length - 1];
    expect(done.terminal).toBeUndefined();
    expect(done.stoppedByMode).toBeUndefined();
    expect(Object.keys(done.artifacts).sort()).toEqual(
      [
        'candidate',
        'decisionGate',
        'dependencyGraph',
        'discovery',
        'proofPackage',
        'redPlan',
        'verification',
      ].sort(),
    );
    expect(done.artifacts.discovery).toEqual(validDiscovery());
    expect(done.artifacts.proofPackage).toEqual(validProofPackage());
  });

  it('records the history without timestamps and never rests at ADVERSARIAL_PROBES (D15)', async () => {
    const states = await happyPath();
    const done = states[states.length - 1];
    expect(done.history).toEqual([
      { from: 'DISCOVER', to: 'BUILD_GRAPH', via: 'applyDiscovery' },
      { from: 'BUILD_GRAPH', to: 'DECISION_GATE', via: 'applyDependencyGraph' },
      { from: 'DECISION_GATE', to: 'RED_SYNTHESIS', via: 'applyDecisionGate' },
      { from: 'RED_SYNTHESIS', to: 'WRITER', via: 'applyRedSynthesis' },
      { from: 'WRITER', to: 'VERIFY', via: 'applyCandidate' },
      { from: 'VERIFY', to: 'ASSEMBLE_EVIDENCE', via: 'applyVerification' },
      { from: 'ASSEMBLE_EVIDENCE', to: 'DONE', via: 'applyProofPackage' },
    ]);
    for (const transition of done.history) expect('at' in transition).toBe(false);
    expect(states.some((state) => state.phase === 'ADVERSARIAL_PROBES')).toBe(false);
    expect(done.history.some((t) => t.from === 'ADVERSARIAL_PROBES' || t.to === 'ADVERSARIAL_PROBES')).toBe(
      false,
    );
  });

  it('every returned state is deep-frozen, undefined-free, digestable and the input state is untouched', async () => {
    const states = await happyPath();
    states.forEach((state, index) => {
      expect(isDeepFrozen(state)).toBe(true);
      expect(hasNoUndefinedKeys(state)).toBe(true);
      expect(digestOf(state)).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(state.history).toHaveLength(index);
      expect(Object.isFrozen(state.history)).toBe(true);
    });
    // determinism: the same inputs produce a byte-identical state
    const again = await happyPath();
    expect(digestOf(again[again.length - 1])).toBe(digestOf(states[states.length - 1]));
  });

  it('summarizeRunState is a small JSON-serializable, digestable view', async () => {
    const states = await happyPath();
    const summary = summarizeRunState(states[states.length - 1]);
    expect(summary).toEqual({
      runId: 'ppe-happy',
      mode: 'FULL_PATTERN_PROOF',
      phase: 'DONE',
      storedArtifacts: [
        'discovery',
        'dependency-graph',
        'decision-gate',
        'red-plan',
        'candidate',
        'pattern-verification',
        'proof-package',
      ],
    });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    expect(digestOf(summary)).toMatch(/^sha256:/);
    expect(isDeepFrozen(summary)).toBe(true);
    expect(summarizeRunState(states[0])).toEqual({
      runId: 'ppe-happy',
      mode: 'FULL_PATTERN_PROOF',
      phase: 'DISCOVER',
      storedArtifacts: [],
    });
  });
});

describe('state machine: assertPhase and transition guards', () => {
  it('throws PPE_PHASE_VIOLATION on out-of-order calls and leaves the input state unchanged', async () => {
    const fresh = startPatternProofRun({ runId: 'guard', mode: 'FULL_PATTERN_PROOF' });
    expect(() => applyDependencyGraph(fresh, validGraph())).toThrow(/PPE_PHASE_VIOLATION/);
    expect(() => applyDecisionGate(fresh, validGate())).toThrow(/PPE_PHASE_VIOLATION/);
    await expect(applyRedSynthesis(fresh, validRedPlan(), happyPathResolver())).rejects.toThrow(
      /PPE_PHASE_VIOLATION/,
    );
    await expect(
      applyCandidate(fresh, validCandidate(), {
        diffResolver: diffResolverReturning(['Dockerfile']),
        resolver: happyPathResolver(),
      }),
    ).rejects.toThrow(/PPE_PHASE_VIOLATION/);
    await expect(applyVerification(fresh, validVerification(), happyPathResolver())).rejects.toThrow(
      /PPE_PHASE_VIOLATION/,
    );
    expect(() => applyProofPackage(fresh, validProofPackage(), boundComparison(validProofPackage()))).toThrow(
      /PPE_PHASE_VIOLATION/,
    );
    const afterDiscovery = applyDiscovery(fresh, validDiscovery());
    expect(() => applyDiscovery(afterDiscovery, validDiscovery())).toThrow(/PPE_PHASE_VIOLATION/);
    expect(() => assertPhase(afterDiscovery, 'DISCOVER')).toThrow(/PPE_PHASE_VIOLATION/);
    expect(() => assertPhase(afterDiscovery, 'BUILD_GRAPH')).not.toThrow();
    expect(fresh.history).toEqual([]);
    expect(fresh.phase).toBe('DISCOVER');
  });

  it('DONE accepts no further input (phase violation) and an invalid artifact never advances the run', async () => {
    const states = await happyPath();
    const done = states[states.length - 1];
    expect(() => applyDiscovery(done, validDiscovery())).toThrow(/PPE_PHASE_VIOLATION/);
    const fresh = startPatternProofRun({ runId: 'invalid', mode: 'FULL_PATTERN_PROOF' });
    expect(() => applyDiscovery(fresh, { findings: [] })).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() =>
      applyDiscovery(fresh, { findings: [{ category: 'x', description: 'y', evidence: [] }] }),
    ).toThrow(/PPE_EVIDENCE_REQUIRED/);
  });

  it('an unresolvable candidate.diffRef is a candidate-integrity fault, not a verdict', async () => {
    const state = await driveThroughRedSynthesis('FULL_PATTERN_PROOF');
    const resolverWithoutDiff = new InMemoryAuthorityResolver(() => false);
    await expect(
      applyCandidate(state, validCandidate(), {
        diffResolver: diffResolverReturning(['Dockerfile']),
        resolver: resolverWithoutDiff,
      }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT'));
  });

  it('F4: a candidate built on another base than the run was started for is inadmissible (PPE_CANDIDATE_SHA_INVALID)', async () => {
    let state = startPatternProofRun({
      runId: 'bound',
      mode: 'FULL_PATTERN_PROOF',
      baseSha: FIXTURE_BASE_SHA,
    });
    state = applyDiscovery(state, validDiscovery());
    state = applyDependencyGraph(state, validGraph());
    state = applyDecisionGate(state, validGate());
    state = await applyRedSynthesis(state, validRedPlan(), happyPathResolver());
    expect(state.phase).toBe('WRITER');
    const otherBase = 'f'.repeat(40);
    const foreign = {
      ...validCandidate(),
      baseSha: otherBase,
      diffRef: { kind: 'git_object' as const, ref: `${otherBase}..${FIXTURE_CANDIDATE_SHA}` },
    };
    const resolver = seededResolver(validDiscovery(), validGraph(), validRedPlan(), foreign);
    await expect(
      applyCandidate(state, foreign, { diffResolver: diffResolverReturning(['Dockerfile']), resolver }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_CANDIDATE_SHA_INVALID'));
    // the same candidate is admitted by a run started for ITS base, and by a run without a recorded base
    const admitted = await applyCandidate(state, validCandidate(), {
      diffResolver: diffResolverReturning(['Dockerfile']),
      resolver: happyPathResolver(),
    });
    expect(admitted.phase).toBe('VERIFY');
    expect(admitted.baseSha).toBe(FIXTURE_BASE_SHA);
  });

  it('F4: candidate.diffRef must be the git_object baseSha..candidateSha (or the candidate object) AND resolve', async () => {
    const state = await driveThroughRedSynthesis('FULL_PATTERN_PROOF');
    const deps = (candidate: unknown) => ({
      diffResolver: diffResolverReturning(['Dockerfile']),
      resolver: seededResolver(validDiscovery(), validGraph(), validRedPlan(), candidate),
    });
    // a runtime_result the discovery established is not this candidate's diff, even though it resolves
    const runtimeDiff = {
      ...validCandidate(),
      diffRef: {
        kind: 'runtime_result' as const,
        ref: 'local npm-ci reproduction, 2026-09-30, exit 1, MODULE_NOT_FOUND',
      },
    };
    await expect(applyCandidate(state, runtimeDiff, deps(runtimeDiff))).rejects.toSatisfy((error) =>
      isPatternProofError(error, 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT'),
    );
    // a git_object naming another object (a resolvable one) is not this candidate's diff either
    const otherObject = {
      ...validCandidate(),
      diffRef: { kind: 'git_object' as const, ref: 'a'.repeat(40) },
    };
    await expect(applyCandidate(state, otherObject, deps(otherObject))).rejects.toSatisfy((error) =>
      isPatternProofError(error, 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT'),
    );
    const reversed = {
      ...validCandidate(),
      diffRef: { kind: 'git_object' as const, ref: `${FIXTURE_CANDIDATE_SHA}..${FIXTURE_BASE_SHA}` },
    };
    await expect(applyCandidate(state, reversed, deps(reversed))).rejects.toSatisfy((error) =>
      isPatternProofError(error, 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT'),
    );
    // both admissible forms are accepted when they resolve
    const bareObject = {
      ...validCandidate(),
      diffRef: { kind: 'git_object' as const, ref: FIXTURE_CANDIDATE_SHA },
    };
    expect((await applyCandidate(state, bareObject, deps(bareObject))).phase).toBe('VERIFY');
    expect((await applyCandidate(state, validCandidate(), deps(validCandidate()))).phase).toBe('VERIFY');
    // the admissible form that does NOT resolve is still a candidate-integrity fault
    await expect(
      applyCandidate(state, bareObject, {
        diffResolver: diffResolverReturning(['Dockerfile']),
        resolver: seededResolver(validDiscovery(), validGraph(), validRedPlan(), validCandidate()),
      }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT'));
  });

  it('applyRedSynthesis consults the locators discovery and graph actually established (section 8)', () => {
    const keys = establishedLocatorKeys(
      validateDiscoveryArtifact(validDiscovery()),
      validateDependencyGraphArtifact(validGraph()),
    );
    expect(keys.has(locatorKey({ kind: 'file_line', ref: 'docker-compose.staging.yml:6-8' }))).toBe(true);
    expect(keys.has(locatorKey({ kind: 'file_line', ref: 'Dockerfile:37' }))).toBe(true);
    expect(keys.has(locatorKey({ kind: 'file_line', ref: 'services/mapLayerSelection.ts:1' }))).toBe(false);
  });
});

describe('state machine: applyProofPackage binds the package to the admitted candidate and RedPlan (F4)', () => {
  const OTHER_SHA = 'f'.repeat(40);

  async function expectUnbound(pkg: unknown): Promise<void> {
    const state = await driveToAssembleEvidence();
    let caught: unknown;
    try {
      applyProofPackage(state, pkg, boundComparison(pkg as never));
    } catch (error) {
      caught = error;
    }
    expect(isPatternProofError(caught, 'PPE_PROOF_PACKAGE_UNBOUND'), String(caught)).toBe(true);
    expect(state.phase).toBe('ASSEMBLE_EVIDENCE');
    expect(state.artifacts.proofPackage).toBeUndefined();
  }

  it('a package naming another candidateSha, with a comparison bound to THAT package, never reaches DONE', async () => {
    await expectUnbound({
      ...validProofPackage(),
      candidateSha: OTHER_SHA,
      inputManifest: { ...validManifest(), candidateShaOrDiff: OTHER_SHA },
    });
  });

  it('a package naming another baseSha is unbound', async () => {
    await expectUnbound({
      ...validProofPackage(),
      baseSha: OTHER_SHA,
      inputManifest: { ...validManifest(), baseSha: OTHER_SHA },
    });
  });

  it('a manifest whose baseSha or candidateShaOrDiff is not the admitted candidate is unbound', async () => {
    await expectUnbound({
      ...validProofPackage(),
      inputManifest: { ...validManifest(), baseSha: OTHER_SHA },
    });
    await expectUnbound({
      ...validProofPackage(),
      inputManifest: { ...validManifest(), candidateShaOrDiff: OTHER_SHA },
    });
    await expectUnbound({
      ...validProofPackage(),
      inputManifest: { ...validManifest(), candidateShaOrDiff: `${OTHER_SHA}..${FIXTURE_CANDIDATE_SHA}` },
    });
    await expectUnbound({
      ...validProofPackage(),
      inputManifest: {
        ...validManifest(),
        candidateShaOrDiff: `${FIXTURE_CANDIDATE_SHA}..${FIXTURE_BASE_SHA}`,
      },
    });
  });

  it('probeIdentities must be a NON-EMPTY subset of the stored RedPlan probe ids', async () => {
    await expectUnbound({ ...validProofPackage(), probeIdentities: [] });
    await expectUnbound({ ...validProofPackage(), probeIdentities: ['not-a-red-plan-probe'] });
    await expectUnbound({
      ...validProofPackage(),
      probeIdentities: [...validProofPackage().probeIdentities, 'red-invented-later'],
    });
  });

  it('a bound package (both diff forms, any non-empty probe subset) reaches DONE', async () => {
    for (const pkg of [
      validProofPackage(),
      {
        ...validProofPackage(),
        inputManifest: {
          ...validManifest(),
          candidateShaOrDiff: `${FIXTURE_BASE_SHA}..${FIXTURE_CANDIDATE_SHA}`,
        },
      },
      { ...validProofPackage(), probeIdentities: [validProofPackage().probeIdentities[1]] },
    ]) {
      const done = applyProofPackage(await driveToAssembleEvidence(), pkg, boundComparison(pkg));
      expect(done.phase).toBe('DONE');
      expect(done.artifacts.proofPackage?.candidateSha).toBe(done.artifacts.candidate?.candidateSha);
      expect(done.artifacts.proofPackage?.baseSha).toBe(done.artifacts.candidate?.baseSha);
    }
  });
});

describe('state machine: BOOTSTRAP_RED_ONLY stops at RED_SYNTHESIS (D8, T3)', () => {
  it('sets stoppedByMode, stores the RedPlan, never enters WRITER, and every later transition is PPE_RUN_STOPPED', async () => {
    const stopped = await driveThroughRedSynthesis('BOOTSTRAP_RED_ONLY');
    expect(stopped.phase).toBe('RED_SYNTHESIS');
    expect(stopped.stoppedByMode).toEqual({ atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' });
    expect(stopped.terminal).toBeUndefined();
    expect(stopped.artifacts.redPlan).toEqual(validRedPlan());
    expect(stopped.artifacts.candidate).toBeUndefined();
    expect(stopped.history[stopped.history.length - 1]).toEqual({
      from: 'RED_SYNTHESIS',
      to: 'RED_SYNTHESIS',
      via: 'applyRedSynthesis:stoppedByMode',
    });
    expect(stopped.history.some((t) => t.to === 'WRITER')).toBe(false);
    expect(isDeepFrozen(stopped)).toBe(true);

    await expect(
      applyCandidate(stopped, validCandidate(), {
        diffResolver: diffResolverReturning(['Dockerfile']),
        resolver: happyPathResolver(),
      }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_RUN_STOPPED'));
    await expect(applyRedSynthesis(stopped, validRedPlan(), happyPathResolver())).rejects.toSatisfy((error) =>
      isPatternProofError(error, 'PPE_RUN_STOPPED'),
    );
    expect(() => assertPhase(stopped, 'RED_SYNTHESIS')).toThrow(/PPE_RUN_STOPPED/);
    expect(summarizeRunState(stopped)).toEqual({
      runId: 'ppe-fixture-BOOTSTRAP_RED_ONLY',
      mode: 'BOOTSTRAP_RED_ONLY',
      phase: 'RED_SYNTHESIS',
      stoppedByMode: { atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' },
      storedArtifacts: ['discovery', 'dependency-graph', 'decision-gate', 'red-plan'],
    });
  });

  it('driveBootstrapSequence stops wherever the machine stops', async () => {
    const sequence = {
      runId: 'drive',
      discovery: validDiscovery(),
      dependencyGraph: validGraph(),
      decisionGate: validGate(),
      proposedProbes: validRedPlan(),
    };
    const bootstrap = await driveBootstrapSequence(
      { ...sequence, mode: 'BOOTSTRAP_RED_ONLY' },
      happyPathResolver(),
    );
    expect(bootstrap.stoppedByMode?.atPhase).toBe('RED_SYNTHESIS');
    expect(bootstrap.artifacts.redPlan).toBeDefined();

    const full = await driveBootstrapSequence(
      { ...sequence, mode: 'FULL_PATTERN_PROOF' },
      happyPathResolver(),
    );
    expect(full.phase).toBe('WRITER');
    expect(full.stoppedByMode).toBeUndefined();

    const gated = await driveBootstrapSequence(
      {
        ...sequence,
        mode: 'BOOTSTRAP_RED_ONLY',
        decisionGate: {
          items: [
            {
              item: 'owner-level choice',
              classification: 'HUMAN_DECISION_REQUIRED',
              blockingReason: 'owner decides',
            },
          ],
        },
      },
      happyPathResolver(),
    );
    expect(gated.terminal?.state).toBe('HUMAN_DECISION_REQUIRED');
    expect(gated.artifacts.redPlan).toBeUndefined();

    const unauthorized = await driveBootstrapSequence(
      { ...sequence, mode: 'BOOTSTRAP_RED_ONLY' },
      new InMemoryAuthorityResolver(() => false),
    );
    expect(unauthorized.terminal?.state).toBe('MISSING_AUTHORITY');
  });
});
