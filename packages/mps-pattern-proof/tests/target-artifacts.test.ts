/**
 * D7: the frozen target artifacts (BOOTSTRAP sections 5.1-5.4, transcribed verbatim in
 * tests/fixtures/frozen-target-artifacts.ts) fed through the validators and the pure state machine in
 * mode BOOTSTRAP_RED_ONLY, with a RepositoryAuthorityResolver rooted at THIS checkout and a
 * runtime_result ledger seeded with exactly the reproduction refs the frozen section 5 JSON cites.
 *
 * This proves the engine stops at RED_SYNTHESIS with the frozen RedPlanArtifact stored -- and
 * nothing more: no WRITER, no Dockerfile change, no PROVEN claim.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RepositoryAuthorityResolver, resolveAll } from '../src/authority';
import type { EvidenceLocator } from '../src/evidence';
import {
  applyDecisionGate,
  applyDependencyGraph,
  applyDiscovery,
  applyRedSynthesis,
  AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH,
  driveBootstrapSequence,
  startPatternProofRun,
  summarizeRunState,
} from '../src/state-machine';
import {
  validateDecisionGateArtifact,
  validateDependencyGraphArtifact,
  validateDiscoveryArtifact,
  validateRedPlanArtifact,
} from '../src/validators';
import {
  FROZEN_TARGET_DECISION_GATE,
  FROZEN_TARGET_DEPENDENCY_GRAPH,
  FROZEN_TARGET_DISCOVERY,
  FROZEN_TARGET_RED_PLAN,
} from './fixtures/frozen-target-artifacts';
import { allLocatorsOf, hasNoUndefinedKeys, isDeepFrozen } from './fixtures/state';

const REPO_ROOT = process.cwd();

/** The runtime_result refs the frozen section 5 JSON cites (three in 5.1, one in 5.2). */
const RUNTIME_LEDGER: readonly string[] = allLocatorsOf(
  FROZEN_TARGET_DISCOVERY,
  FROZEN_TARGET_DEPENDENCY_GRAPH,
)
  .filter((locator) => locator.kind === 'runtime_result')
  .map((locator) => locator.ref);

function targetResolver(): RepositoryAuthorityResolver {
  return new RepositoryAuthorityResolver({ repoRoot: REPO_ROOT, runtimeLedger: RUNTIME_LEDGER });
}

describe('frozen target artifacts (section 5) pass the validators verbatim', () => {
  it('DiscoveryArtifact, DependencyGraphArtifact, DecisionGateArtifact and RedPlanArtifact validate unchanged', () => {
    expect(validateDiscoveryArtifact(FROZEN_TARGET_DISCOVERY)).toEqual(FROZEN_TARGET_DISCOVERY);
    expect(validateDependencyGraphArtifact(FROZEN_TARGET_DEPENDENCY_GRAPH)).toEqual(
      FROZEN_TARGET_DEPENDENCY_GRAPH,
    );
    expect(validateDecisionGateArtifact(FROZEN_TARGET_DECISION_GATE)).toEqual(FROZEN_TARGET_DECISION_GATE);
    expect(validateRedPlanArtifact(FROZEN_TARGET_RED_PLAN)).toEqual(FROZEN_TARGET_RED_PLAN);
    expect(FROZEN_TARGET_DISCOVERY.findings).toHaveLength(5);
    expect(FROZEN_TARGET_DEPENDENCY_GRAPH.nodes).toHaveLength(8);
    expect(FROZEN_TARGET_DEPENDENCY_GRAPH.edges).toHaveLength(6);
    expect(FROZEN_TARGET_DECISION_GATE.items.every((item) => item.classification === 'MECHANICAL')).toBe(
      true,
    );
    expect(FROZEN_TARGET_RED_PLAN.probes.map((probe) => probe.id)).toEqual([
      'red-production-base-npm-ci-postinstall',
      'red-builder-npm-ci-postinstall',
    ]);
  });

  it('the runtime ledger holds exactly the four reproduction refs the frozen JSON cites', () => {
    expect(RUNTIME_LEDGER).toHaveLength(4);
    expect(RUNTIME_LEDGER.every((ref) => ref.includes('2026-09-30'))).toBe(true);
  });
});

describe('frozen target evidence resolves against this checkout', () => {
  it('every discovery and graph locator (path:N, path:N-M, path:N,M,... and ledger refs) resolves', async () => {
    const locators = allLocatorsOf(
      FROZEN_TARGET_DISCOVERY,
      FROZEN_TARGET_DEPENDENCY_GRAPH,
      FROZEN_TARGET_RED_PLAN,
    );
    const summary = await resolveAll(targetResolver(), locators);
    expect(summary.unresolved, JSON.stringify(summary.unresolved, null, 2)).toEqual([]);
    expect(summary.allResolved).toBe(true);
    // the three file_line forms the frozen document uses
    const forms = locators.filter((l) => l.kind === 'file_line').map((l) => l.ref);
    expect(forms).toContain('Dockerfile:58');
    expect(forms).toContain('Dockerfile:32-37');
    expect(forms).toContain('Dockerfile.gcp:26,28,51,53');
  });

  it('a resolver without the ledger fails closed on the runtime_result citations', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: REPO_ROOT });
    const summary = await resolveAll(resolver, allLocatorsOf(FROZEN_TARGET_DISCOVERY));
    expect(summary.allResolved).toBe(false);
    expect(summary.unresolved.every((u) => u.locator.kind === 'runtime_result')).toBe(true);
    expect(summary.unresolved.every((u) => u.reason === 'RUNTIME_LEDGER_NOT_CONFIGURED')).toBe(true);
  });
});

describe('driveBootstrapSequence over the frozen target in mode BOOTSTRAP_RED_ONLY', () => {
  it('stops by mode at RED_SYNTHESIS with the frozen RedPlanArtifact stored; WRITER never entered', async () => {
    const state = await driveBootstrapSequence(
      {
        runId: 'ppe-target-bootstrap',
        mode: 'BOOTSTRAP_RED_ONLY',
        discovery: FROZEN_TARGET_DISCOVERY,
        dependencyGraph: FROZEN_TARGET_DEPENDENCY_GRAPH,
        decisionGate: FROZEN_TARGET_DECISION_GATE,
        proposedProbes: FROZEN_TARGET_RED_PLAN,
      },
      targetResolver(),
    );
    expect(state.terminal).toBeUndefined();
    expect(state.stoppedByMode).toEqual({ atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' });
    expect(state.stoppedByMode?.atPhase).toBe('RED_SYNTHESIS');
    expect(state.phase).toBe('RED_SYNTHESIS');
    expect(state.artifacts.redPlan).toBeDefined();
    expect(state.artifacts.redPlan).toEqual(FROZEN_TARGET_RED_PLAN);
    expect(state.artifacts.discovery).toEqual(FROZEN_TARGET_DISCOVERY);
    expect(state.artifacts.dependencyGraph).toEqual(FROZEN_TARGET_DEPENDENCY_GRAPH);
    expect(state.artifacts.decisionGate).toEqual(FROZEN_TARGET_DECISION_GATE);
    expect(state.artifacts.candidate).toBeUndefined();
    expect(state.history.map((t) => t.to)).toEqual([
      'BUILD_GRAPH',
      'DECISION_GATE',
      'RED_SYNTHESIS',
      'RED_SYNTHESIS',
    ]);
    expect(state.history.some((t) => t.to === 'WRITER')).toBe(false);
    expect(isDeepFrozen(state)).toBe(true);
    expect(hasNoUndefinedKeys(state)).toBe(true);
    expect(summarizeRunState(state)).toEqual({
      runId: 'ppe-target-bootstrap',
      mode: 'BOOTSTRAP_RED_ONLY',
      phase: 'RED_SYNTHESIS',
      stoppedByMode: { atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' },
      storedArtifacts: ['discovery', 'dependency-graph', 'decision-gate', 'red-plan'],
    });
  });

  it('MISSING_AUTHORITY fires when the red plan cites a locator absent from discovery/graph (section 8)', async () => {
    const invented: EvidenceLocator = { kind: 'file_line', ref: 'services/mapLayerSelection.ts:1' };
    let state = startPatternProofRun({ runId: 'ppe-target-missing', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, FROZEN_TARGET_DISCOVERY);
    state = applyDependencyGraph(state, FROZEN_TARGET_DEPENDENCY_GRAPH);
    state = applyDecisionGate(state, FROZEN_TARGET_DECISION_GATE);
    const halted = await applyRedSynthesis(
      state,
      {
        probes: [
          FROZEN_TARGET_RED_PLAN.probes[0],
          {
            id: 'red-map-layer-unavailable',
            assertedBehavior: 'mapLayerSelection exposes an `unavailable` signal',
            authorityEvidence: invented,
            command: 'assert the signal exists',
          },
        ],
      },
      targetResolver(),
    );
    expect(halted.terminal?.state).toBe('MISSING_AUTHORITY');
    expect(halted.terminal?.atPhase).toBe('RED_SYNTHESIS');
    expect(halted.terminal?.evidence).toEqual([
      { locator: invented, reason: AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH },
    ]);
    expect(halted.artifacts.redPlan).toBeUndefined();
    expect(halted.stoppedByMode).toBeUndefined();
    expect(isDeepFrozen(halted)).toBe(true);
  });

  it('a red-plan authority present in the graph but not on disk is MISSING_AUTHORITY with the resolver reason', async () => {
    let state = startPatternProofRun({ runId: 'ppe-target-unresolvable', mode: 'BOOTSTRAP_RED_ONLY' });
    state = applyDiscovery(state, FROZEN_TARGET_DISCOVERY);
    state = applyDependencyGraph(state, FROZEN_TARGET_DEPENDENCY_GRAPH);
    state = applyDecisionGate(state, FROZEN_TARGET_DECISION_GATE);
    // a different root: docker-compose.staging.yml does not exist under the package directory
    const elsewhere = new RepositoryAuthorityResolver({
      repoRoot: path.join(REPO_ROOT, 'packages', 'mps-pattern-proof'),
      runtimeLedger: RUNTIME_LEDGER,
    });
    const halted = await applyRedSynthesis(state, FROZEN_TARGET_RED_PLAN, elsewhere);
    expect(halted.terminal?.state).toBe('MISSING_AUTHORITY');
    expect(halted.terminal?.evidence.map((item) => ('reason' in item ? item.reason : ''))).toEqual([
      'FILE_NOT_FOUND',
      'FILE_NOT_FOUND',
    ]);
    expect(halted.artifacts.redPlan).toBeUndefined();
  });
});
