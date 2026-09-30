/**
 * PATTERN-PROOF-ENGINE-01 V1 -- the pure terminal-state machine (BOOTSTRAP design section 3,
 * frozen design section 3; plan section 4 as amended by section 12: D1, D3, D4, D8, D9, D10, D15).
 *
 * Orchestrator-independent (frozen design Q-PPE-3): no `agent()`/`pipeline()`/`phase()`, no clock,
 * no I/O of its own. Every transition takes the CURRENT state plus the next artifact (validated
 * here, never trusted), and returns a NEW deep-frozen state; nothing is ever mutated. Resolution of
 * authority is delegated to an injected `AuthorityLocatorResolver` port, diff derivation to an
 * injected `diffResolver`, and replay to a bound `ReplayComparison` (./replay.ts) -- the machine
 * decides, the ports observe.
 *
 * Phases:  DISCOVER -> BUILD_GRAPH -> DECISION_GATE -> RED_SYNTHESIS -> WRITER -> VERIFY
 *          -> ADVERSARIAL_PROBES -> ASSEMBLE_EVIDENCE -> DONE
 * VERIFY and ADVERSARIAL_PROBES are ONE artifact (BOOTSTRAP section 4: a single final
 * PatternVerificationArtifact per round). The phase enum keeps both names for progress display,
 * but a single transition consumes them and no state ever awaits input at ADVERSARIAL_PROBES
 * (D15); verification outcomes are recorded `atPhase: 'VERIFY+ADVERSARIAL_PROBES'`.
 *
 * Terminal states (exactly the frozen six) are ABSORBING (PPE_RUN_TERMINAL); `stoppedByMode` is
 * absorbing as well (D8, PPE_RUN_STOPPED): in BOOTSTRAP_RED_ONLY the run never enters WRITER.
 *
 * Storage rule: an artifact is stored on the state iff the machine ADMITTED it -- it validated and
 * its own authority/isolation resolved. A DecisionGate whose own item stops the run is admitted
 * (the stop IS its content); a RedPlan with unresolved authority, a Candidate with derived FAIL, or
 * a verification whose isolation evidence does not resolve is NOT admitted and is not stored.
 *
 * Determinism: transitions carry no timestamps (`at?: never`), so the same inputs always produce
 * byte-identical states (digestable with ./identity.ts). No key on a state is ever `undefined`.
 *
 * Binding (R1 F4, R2 F6): a run may carry the `baseSha` it was started for; an admitted candidate
 * must be built on it, its `diffRef` must be the git_object RANGE `baseSha..candidateSha` (a bare
 * candidate object is not the diff) and must resolve; a ProofPackage must name the admitted
 * candidate's shas, a manifest consistent with them and EXACTLY the probe ids of the stored RedPlan
 * (set equality: an omitted probe is as unbound as a foreign one; else PPE_PROOF_PACKAGE_UNBOUND, an
 * inadmissible artifact, never a terminal state). Terminal records are never evidence-free (R1 F16).
 */
import type {
  CandidateArtifact,
  DecisionGateArtifact,
  DependencyGraphArtifact,
  DiscoveryArtifact,
  PatternVerificationArtifact,
  ProofPackage,
  RedPlanArtifact,
} from './artifacts';
import { resolveAll, type AuthorityLocatorResolver, type UnresolvedAuthority } from './authority';
import { PatternProofError } from './errors';
import { locatorKey, type EvidenceLocator } from './evidence';
import { digestOf, type PatternProofArtifactKind } from './identity';
import { deepFreeze } from './internal/deep-freeze';
import { divergentObservations, validateReplayComparison, type ReplayComparison } from './replay';
import {
  candidateDiffRefs,
  GIT_SHA_RE,
  isCandidateDiffRef,
  isPathAllowed,
  validateCandidateArtifact,
  validateDecisionGateArtifact,
  validateDependencyGraphArtifact,
  validateDiscoveryArtifact,
  validatePatternVerificationArtifact,
  validateProofPackage,
  validateRedPlanArtifact,
} from './validators';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export const PATTERN_PROOF_PHASES = [
  'DISCOVER',
  'BUILD_GRAPH',
  'DECISION_GATE',
  'RED_SYNTHESIS',
  'WRITER',
  'VERIFY',
  'ADVERSARIAL_PROBES',
  'ASSEMBLE_EVIDENCE',
  'DONE',
] as const;

export type PatternProofPhase = (typeof PATTERN_PROOF_PHASES)[number];

export const PATTERN_PROOF_TERMINAL_STATES = [
  'HUMAN_DECISION_REQUIRED',
  'MISSING_AUTHORITY',
  'SCOPE_VIOLATION',
  'FALSIFIED',
  'NOT_PROVEN',
  'NON_REPRODUCIBLE',
] as const;

export type PatternProofTerminalState = (typeof PATTERN_PROOF_TERMINAL_STATES)[number];

export const PATTERN_PROOF_MODES = ['BOOTSTRAP_RED_ONLY', 'FULL_PATTERN_PROOF'] as const;

export type PatternProofMode = (typeof PATTERN_PROOF_MODES)[number];

/** The atPhase label for every verification outcome (D15). */
export const VERIFY_PHASE_LABEL = 'VERIFY+ADVERSARIAL_PROBES';

/** Reason codes the machine itself mints (artifact-declared reason codes are copied verbatim). */
export const AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH = 'AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH';
export const VERIFICATION_BLOCKED = 'VERIFICATION_BLOCKED';
export const ALLOWED_PATHS_VIOLATED = 'ALLOWED_PATHS_VIOLATED';
export const REPLAY_DIGEST_DIVERGED = 'REPLAY_DIGEST_DIVERGED';

export interface PatternProofTransition {
  readonly from: PatternProofPhase;
  /** the phase entered, or the terminal state reached (the phase then stays where it was) */
  readonly to: PatternProofPhase | PatternProofTerminalState;
  /** the transition function (plus a qualifier for stop-by-mode) */
  readonly via: string;
  /** deliberately absent: no timestamps, states must be deterministic */
  readonly at?: never;
}

/** Terminal evidence is either a locator or an unresolved locator with the resolver's reason. */
export type PatternProofTerminalEvidence = EvidenceLocator | UnresolvedAuthority;

export interface PatternProofTerminalRecord {
  readonly state: PatternProofTerminalState;
  /** e.g. 'DECISION_GATE', 'RED_SYNTHESIS', 'WRITER', 'VERIFY+ADVERSARIAL_PROBES', 'ASSEMBLE_EVIDENCE' */
  readonly atPhase: string;
  readonly reasonCode?: string;
  /** copied verbatim from the DecisionGateItem that stopped the run */
  readonly blockingReason?: string;
  readonly evidence: readonly PatternProofTerminalEvidence[];
}

export interface PatternProofStoredArtifacts {
  readonly discovery?: DiscoveryArtifact;
  readonly dependencyGraph?: DependencyGraphArtifact;
  readonly decisionGate?: DecisionGateArtifact;
  readonly redPlan?: RedPlanArtifact;
  readonly candidate?: CandidateArtifact;
  readonly verification?: PatternVerificationArtifact;
  readonly proofPackage?: ProofPackage;
}

export interface PatternProofStoppedByMode {
  readonly atPhase: 'RED_SYNTHESIS';
  readonly reason: 'BOOTSTRAP_RED_ONLY';
}

export interface PatternProofRunState {
  readonly runId: string;
  readonly mode: PatternProofMode;
  /** the base git object this run was started for (40 hex); a candidate must be built on it (F4) */
  readonly baseSha?: string;
  readonly phase: PatternProofPhase;
  readonly artifacts: PatternProofStoredArtifacts;
  readonly terminal?: PatternProofTerminalRecord;
  readonly stoppedByMode?: PatternProofStoppedByMode;
  readonly history: readonly PatternProofTransition[];
}

export interface PatternProofRunSummary {
  readonly runId: string;
  readonly mode: PatternProofMode;
  readonly baseSha?: string;
  readonly phase: PatternProofPhase;
  readonly terminal?: PatternProofTerminalRecord;
  readonly stoppedByMode?: PatternProofStoppedByMode;
  readonly storedArtifacts: readonly PatternProofArtifactKind[];
}

export interface CandidateTransitionDeps {
  /** independently derives the changed paths of baseSha..candidateSha (never the writer's claim) */
  readonly diffResolver: (baseSha: string, candidateSha: string) => Promise<readonly string[]>;
  /** resolves `candidate.diffRef` (git_object / runtime_result / cas_artifact) */
  readonly resolver: AuthorityLocatorResolver;
}

export interface BootstrapSequenceInput {
  readonly runId: string;
  readonly mode: PatternProofMode;
  readonly baseSha?: string;
  readonly discovery: unknown;
  readonly dependencyGraph: unknown;
  readonly decisionGate: unknown;
  readonly proposedProbes: unknown;
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

const STORED_ARTIFACT_KINDS: readonly (readonly [
  keyof PatternProofStoredArtifacts,
  PatternProofArtifactKind,
])[] = Object.freeze([
  ['discovery', 'discovery'],
  ['dependencyGraph', 'dependency-graph'],
  ['decisionGate', 'decision-gate'],
  ['redPlan', 'red-plan'],
  ['candidate', 'candidate'],
  ['verification', 'pattern-verification'],
  ['proofPackage', 'proof-package'],
] as const);

function isMode(value: unknown): value is PatternProofMode {
  return typeof value === 'string' && (PATTERN_PROOF_MODES as readonly string[]).includes(value);
}

function isPhase(value: unknown): value is PatternProofPhase {
  return typeof value === 'string' && (PATTERN_PROOF_PHASES as readonly string[]).includes(value);
}

interface NextStateOptions {
  readonly phase?: PatternProofPhase;
  readonly artifacts?: Partial<PatternProofStoredArtifacts>;
  readonly terminal?: PatternProofTerminalRecord;
  readonly stoppedByMode?: PatternProofStoppedByMode;
  readonly transition: PatternProofTransition;
}

/** Builds the successor state with ONLY present keys, then deep-freezes it. */
function nextState(state: PatternProofRunState, options: NextStateOptions): PatternProofRunState {
  const artifacts: Partial<Record<keyof PatternProofStoredArtifacts, unknown>> = {};
  for (const [key] of STORED_ARTIFACT_KINDS) {
    const incoming = options.artifacts?.[key];
    const existing = state.artifacts[key];
    if (incoming !== undefined) artifacts[key] = incoming;
    else if (existing !== undefined) artifacts[key] = existing;
  }
  const out: {
    runId: string;
    mode: PatternProofMode;
    baseSha?: string;
    phase: PatternProofPhase;
    artifacts: PatternProofStoredArtifacts;
    terminal?: PatternProofTerminalRecord;
    stoppedByMode?: PatternProofStoppedByMode;
    history: readonly PatternProofTransition[];
  } = {
    runId: state.runId,
    mode: state.mode,
    phase: options.phase ?? state.phase,
    artifacts: artifacts as PatternProofStoredArtifacts,
    history: [...state.history, options.transition],
  };
  if (state.baseSha !== undefined) out.baseSha = state.baseSha;
  if (options.terminal !== undefined) out.terminal = options.terminal;
  if (options.stoppedByMode !== undefined) out.stoppedByMode = options.stoppedByMode;
  return deepFreeze(out);
}

function terminalRecord(
  state: PatternProofTerminalState,
  atPhase: string,
  evidence: readonly PatternProofTerminalEvidence[],
  extras: { readonly reasonCode?: string; readonly blockingReason?: string } = {},
): PatternProofTerminalRecord {
  const out: {
    state: PatternProofTerminalState;
    atPhase: string;
    reasonCode?: string;
    blockingReason?: string;
    evidence: readonly PatternProofTerminalEvidence[];
  } = { state, atPhase, evidence };
  if (extras.reasonCode !== undefined) out.reasonCode = extras.reasonCode;
  if (extras.blockingReason !== undefined) out.blockingReason = extras.blockingReason;
  return out;
}

function terminate(
  state: PatternProofRunState,
  via: string,
  record: PatternProofTerminalRecord,
  artifacts?: Partial<PatternProofStoredArtifacts>,
): PatternProofRunState {
  const options: NextStateOptions = {
    terminal: record,
    transition: { from: state.phase, to: record.state, via },
  };
  return nextState(state, artifacts === undefined ? options : { ...options, artifacts });
}

function requireStored<K extends keyof PatternProofStoredArtifacts>(
  state: PatternProofRunState,
  key: K,
): NonNullable<PatternProofStoredArtifacts[K]> {
  const value = state.artifacts[key];
  if (value === undefined) {
    throw new PatternProofError(
      'PPE_PHASE_VIOLATION',
      `phase ${state.phase} requires a stored ${key} artifact`,
    );
  }
  return value;
}

/** Every locator the discovery and graph phases actually established (frozen design section 8). */
export function establishedLocatorKeys(
  discovery: DiscoveryArtifact,
  graph: DependencyGraphArtifact,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const finding of discovery.findings)
    for (const locator of finding.evidence) keys.add(locatorKey(locator));
  for (const node of graph.nodes) for (const locator of node.evidence) keys.add(locatorKey(locator));
  for (const edge of graph.edges) for (const locator of edge.evidence) keys.add(locatorKey(locator));
  return keys;
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/**
 * Terminal states and stop-by-mode are absorbing (frozen design section 3, D8); out-of-order calls
 * are phase violations. Checked in that order so a stopped run reports WHY it refuses input.
 */
export function assertPhase(state: PatternProofRunState, expected: PatternProofPhase): void {
  if (state.terminal !== undefined) {
    throw new PatternProofError(
      'PPE_RUN_TERMINAL',
      `run ${state.runId} is terminal (${state.terminal.state} at ${state.terminal.atPhase}); no further transitions`,
      { details: { terminal: state.terminal.state, expected } },
    );
  }
  if (state.stoppedByMode !== undefined) {
    throw new PatternProofError(
      'PPE_RUN_STOPPED',
      `run ${state.runId} stopped by mode ${state.stoppedByMode.reason} at ${state.stoppedByMode.atPhase}; no further transitions`,
      { details: { stoppedByMode: state.stoppedByMode, expected } },
    );
  }
  if (state.phase !== expected) {
    throw new PatternProofError(
      'PPE_PHASE_VIOLATION',
      `run ${state.runId} is at phase ${state.phase}, transition requires ${expected}`,
      { details: { phase: state.phase, expected } },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/** Starts a run; an optional `baseSha` (40 hex) is recorded and binds every later candidate (F4). */
export function startPatternProofRun(input: {
  readonly runId: string;
  readonly mode: PatternProofMode;
  readonly baseSha?: string;
}): PatternProofRunState {
  if (typeof input.runId !== 'string' || input.runId.trim().length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'runId must be a non-empty string', { path: 'runId' });
  }
  if (!isMode(input.mode)) {
    throw new PatternProofError(
      'PPE_SCHEMA_INVALID',
      `mode must be one of ${PATTERN_PROOF_MODES.join(', ')}`,
      {
        path: 'mode',
      },
    );
  }
  if (input.baseSha !== undefined && (typeof input.baseSha !== 'string' || !GIT_SHA_RE.test(input.baseSha))) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'baseSha must be a 40-hex lowercase git object id', {
      path: 'baseSha',
    });
  }
  const out: {
    runId: string;
    mode: PatternProofMode;
    baseSha?: string;
    phase: PatternProofPhase;
    artifacts: PatternProofStoredArtifacts;
    history: readonly PatternProofTransition[];
  } = { runId: input.runId, mode: input.mode, phase: 'DISCOVER', artifacts: {}, history: [] };
  if (input.baseSha !== undefined) out.baseSha = input.baseSha;
  return deepFreeze(out);
}

/** DISCOVER -> BUILD_GRAPH. */
export function applyDiscovery(state: PatternProofRunState, input: unknown): PatternProofRunState {
  assertPhase(state, 'DISCOVER');
  const discovery = validateDiscoveryArtifact(input);
  return nextState(state, {
    phase: 'BUILD_GRAPH',
    artifacts: { discovery },
    transition: { from: 'DISCOVER', to: 'BUILD_GRAPH', via: 'applyDiscovery' },
  });
}

/** BUILD_GRAPH -> DECISION_GATE. */
export function applyDependencyGraph(state: PatternProofRunState, input: unknown): PatternProofRunState {
  assertPhase(state, 'BUILD_GRAPH');
  const dependencyGraph = validateDependencyGraphArtifact(input);
  return nextState(state, {
    phase: 'DECISION_GATE',
    artifacts: { dependencyGraph },
    transition: { from: 'BUILD_GRAPH', to: 'DECISION_GATE', via: 'applyDependencyGraph' },
  });
}

/**
 * DECISION_GATE -> RED_SYNTHESIS, or terminal HUMAN_DECISION_REQUIRED / MISSING_AUTHORITY /
 * SCOPE_VIOLATION: the first non-MECHANICAL item wins, its blockingReason is copied verbatim
 * (D9: DECISION_GATE is an additional SCOPE_VIOLATION trigger source). The gate artifact is
 * stored in both outcomes -- it is the artifact a human decision blocks on. The terminal record
 * cites the blocking item as a runtime_result locator `decision-gate-item:<index>:<classification>`
 * (R1 F16: terminal records are never evidence-free).
 */
export function applyDecisionGate(state: PatternProofRunState, input: unknown): PatternProofRunState {
  assertPhase(state, 'DECISION_GATE');
  const decisionGate = validateDecisionGateArtifact(input);
  const blockingIndex = decisionGate.items.findIndex((item) => item.classification !== 'MECHANICAL');
  const blocking = blockingIndex === -1 ? undefined : decisionGate.items[blockingIndex];
  if (blocking !== undefined && blocking.classification !== 'MECHANICAL') {
    const evidence: EvidenceLocator = {
      kind: 'runtime_result',
      ref: `decision-gate-item:${blockingIndex}:${blocking.classification}`,
      note: blocking.item,
    };
    return terminate(
      state,
      'applyDecisionGate',
      terminalRecord(blocking.classification, 'DECISION_GATE', [evidence], {
        blockingReason: blocking.blockingReason ?? '',
      }),
      { decisionGate },
    );
  }
  return nextState(state, {
    phase: 'RED_SYNTHESIS',
    artifacts: { decisionGate },
    transition: { from: 'DECISION_GATE', to: 'RED_SYNTHESIS', via: 'applyDecisionGate' },
  });
}

/**
 * RED_SYNTHESIS: the hard rule (frozen design section 8, D3). Every probe's authorityEvidence must
 * (a) be one of the locators the stored discovery/graph actually established (locatorKey identity:
 * kind + trimmed ref, note ignored) -- else reason AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH -- and
 * (b) resolve through the resolver -- else the resolver's reason. Any unresolved probe authority is
 * terminal MISSING_AUTHORITY with the unresolved locators as evidence and NO RedPlan stored.
 * On success: FULL_PATTERN_PROOF -> WRITER; BOOTSTRAP_RED_ONLY -> stoppedByMode, phase stays
 * RED_SYNTHESIS, WRITER is never entered.
 */
export async function applyRedSynthesis(
  state: PatternProofRunState,
  proposedProbes: unknown,
  resolver: AuthorityLocatorResolver,
): Promise<PatternProofRunState> {
  assertPhase(state, 'RED_SYNTHESIS');
  const redPlan = validateRedPlanArtifact(proposedProbes);
  const established = establishedLocatorKeys(
    requireStored(state, 'discovery'),
    requireStored(state, 'dependencyGraph'),
  );
  const unresolved: UnresolvedAuthority[] = [];
  for (const probe of redPlan.probes) {
    const locator = probe.authorityEvidence;
    if (!established.has(locatorKey(locator))) {
      unresolved.push({ locator, reason: AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH });
      continue;
    }
    const resolution = await resolver.resolve(locator);
    if (!resolution.resolved) unresolved.push({ locator, reason: resolution.reason ?? 'UNRESOLVED' });
  }
  if (unresolved.length > 0) {
    return terminate(
      state,
      'applyRedSynthesis',
      terminalRecord('MISSING_AUTHORITY', 'RED_SYNTHESIS', unresolved, { reasonCode: unresolved[0].reason }),
    );
  }
  if (state.mode === 'BOOTSTRAP_RED_ONLY') {
    return nextState(state, {
      artifacts: { redPlan },
      stoppedByMode: { atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' },
      transition: { from: 'RED_SYNTHESIS', to: 'RED_SYNTHESIS', via: 'applyRedSynthesis:stoppedByMode' },
    });
  }
  return nextState(state, {
    phase: 'WRITER',
    artifacts: { redPlan },
    transition: { from: 'RED_SYNTHESIS', to: 'WRITER', via: 'applyRedSynthesis' },
  });
}

/**
 * WRITER -> VERIFY, or terminal SCOPE_VIOLATION (D10). The candidate must be bound to the run (F4):
 * `candidate.baseSha` equals the run's `baseSha` when one was recorded (else
 * PPE_CANDIDATE_SHA_INVALID), `candidate.diffRef` is the git_object range `baseSha..candidateSha`
 * (R2 F6: never a bare candidate object) and resolves (an unresolvable or foreign diff reference is
 * a candidate-integrity fault, thrown as PPE_CANDIDATE_COMPLIANCE_INCONSISTENT, never a verdict).
 * The changed paths are derived INDEPENDENTLY through `diffResolver` and checked with
 * `isPathAllowed`; the writer's own claim is never trusted. Derived FAIL -> SCOPE_VIOLATION
 * (evidence: one git_object locator per offending path). Claimed != derived in either direction ->
 * SCOPE_VIOLATION with reasonCode PPE_CANDIDATE_COMPLIANCE_INCONSISTENT; when the derivation found
 * nothing offending (claimed FAIL, derived PASS) the record cites the runtime_result
 * `derived-compliance:PASS;claimed:FAIL` (R1 F16). A candidate that is not admitted is not stored.
 */
export async function applyCandidate(
  state: PatternProofRunState,
  input: unknown,
  deps: CandidateTransitionDeps,
): Promise<PatternProofRunState> {
  assertPhase(state, 'WRITER');
  const candidate = validateCandidateArtifact(input);
  if (state.baseSha !== undefined && candidate.baseSha !== state.baseSha) {
    throw new PatternProofError(
      'PPE_CANDIDATE_SHA_INVALID',
      `candidate.baseSha ${candidate.baseSha} is not the run's baseSha ${state.baseSha}`,
      {
        path: 'candidate.baseSha',
        details: { runBaseSha: state.baseSha, candidateBaseSha: candidate.baseSha },
      },
    );
  }
  if (!isCandidateDiffRef(candidate.diffRef, candidate.baseSha, candidate.candidateSha)) {
    throw new PatternProofError(
      'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT',
      `candidate.diffRef must be a git_object naming one of ${candidateDiffRefs(candidate.baseSha, candidate.candidateSha).join(' | ')}`,
      { path: 'candidate.diffRef', details: { locator: candidate.diffRef } },
    );
  }
  const diffResolution = await deps.resolver.resolve(candidate.diffRef);
  if (!diffResolution.resolved) {
    throw new PatternProofError(
      'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT',
      `candidate.diffRef does not resolve (${diffResolution.reason ?? 'UNRESOLVED'}); compliance cannot be derived`,
      { path: 'candidate.diffRef', details: { locator: candidate.diffRef } },
    );
  }
  const changedPaths = await deps.diffResolver(candidate.baseSha, candidate.candidateSha);
  const { allowedPaths, result: claimed } = candidate.allowedPathsCompliance;
  const offending = changedPaths.filter((changed) => !isPathAllowed(allowedPaths, changed));
  const derived = offending.length === 0 ? 'PASS' : 'FAIL';
  if (derived === 'FAIL' || claimed !== derived) {
    const evidence: EvidenceLocator[] = offending.map((changed) => ({
      kind: 'git_object',
      ref: `${candidate.candidateSha}:${changed}`,
      note: 'changed path outside allowedPaths (independently derived)',
    }));
    if (evidence.length === 0) {
      evidence.push({
        kind: 'runtime_result',
        ref: `derived-compliance:${derived};claimed:${claimed}`,
        note: `independently derived ${changedPaths.length} changed path(s), none outside allowedPaths`,
      });
    }
    return terminate(
      state,
      'applyCandidate',
      terminalRecord('SCOPE_VIOLATION', 'WRITER', evidence, {
        reasonCode: claimed !== derived ? 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT' : ALLOWED_PATHS_VIOLATED,
      }),
    );
  }
  return nextState(state, {
    phase: 'VERIFY',
    artifacts: { candidate },
    transition: { from: 'WRITER', to: 'VERIFY', via: 'applyCandidate' },
  });
}

/**
 * VERIFY (+ ADVERSARIAL_PROBES, one artifact) -> ASSEMBLE_EVIDENCE, or terminal. For ACCEPT AND
 * FALSIFIED every isolationEvidence locator must resolve (D1; BOOTSTRAP section 4: isolation is
 * proven, not assumed) -- any unresolved locator -> NOT_PROVEN with reasonCode VERIFICATION_BLOCKED
 * and the unresolved locators as evidence, never FALSIFIED or ACCEPT. FALSIFIED (resolved) ->
 * terminal FALSIFIED; NOT_PROVEN -> terminal NOT_PROVEN with the artifact's own reasonCode;
 * ACCEPT (resolved) -> stored, ASSEMBLE_EVIDENCE. atPhase is always 'VERIFY+ADVERSARIAL_PROBES'.
 */
export async function applyVerification(
  state: PatternProofRunState,
  input: unknown,
  resolver: AuthorityLocatorResolver,
): Promise<PatternProofRunState> {
  assertPhase(state, 'VERIFY');
  const verification = validatePatternVerificationArtifact(input);
  if (verification.verdict === 'NOT_PROVEN') {
    const reasonCode = verification.reasonCode ?? VERIFICATION_BLOCKED;
    // A NOT_PROVEN record is never evidence-free: the validator allows an empty isolationEvidence for
    // this verdict, so the record then carries a runtime_result locator naming the declared reason.
    const evidence: readonly EvidenceLocator[] =
      verification.isolationEvidence.length > 0
        ? verification.isolationEvidence
        : [Object.freeze({ kind: 'runtime_result' as const, ref: `verification:NOT_PROVEN:${reasonCode}` })];
    return terminate(
      state,
      'applyVerification',
      terminalRecord('NOT_PROVEN', VERIFY_PHASE_LABEL, evidence, { reasonCode }),
      { verification },
    );
  }
  const isolation = await resolveAll(resolver, verification.isolationEvidence);
  if (!isolation.allResolved) {
    return terminate(
      state,
      'applyVerification',
      terminalRecord('NOT_PROVEN', VERIFY_PHASE_LABEL, isolation.unresolved, {
        reasonCode: VERIFICATION_BLOCKED,
      }),
    );
  }
  if (verification.verdict === 'FALSIFIED') {
    const extras = verification.reasonCode === undefined ? {} : { reasonCode: verification.reasonCode };
    return terminate(
      state,
      'applyVerification',
      terminalRecord('FALSIFIED', VERIFY_PHASE_LABEL, verification.isolationEvidence, extras),
      { verification },
    );
  }
  return nextState(state, {
    phase: 'ASSEMBLE_EVIDENCE',
    artifacts: { verification },
    transition: { from: 'VERIFY', to: 'ASSEMBLE_EVIDENCE', via: 'applyVerification' },
  });
}

function requireProofPackageBinding(state: PatternProofRunState, proofPackage: ProofPackage): void {
  const candidate = requireStored(state, 'candidate');
  const redPlan = requireStored(state, 'redPlan');
  const unbound = (message: string, path: string, details: Record<string, unknown>): PatternProofError =>
    new PatternProofError('PPE_PROOF_PACKAGE_UNBOUND', message, { path, details });
  if (proofPackage.candidateSha !== candidate.candidateSha) {
    throw unbound(
      `proofPackage.candidateSha ${proofPackage.candidateSha} is not the admitted candidate ${candidate.candidateSha}`,
      'proof-package.candidateSha',
      { expected: candidate.candidateSha, actual: proofPackage.candidateSha },
    );
  }
  if (proofPackage.baseSha !== candidate.baseSha) {
    throw unbound(
      `proofPackage.baseSha ${proofPackage.baseSha} is not the admitted candidate's baseSha ${candidate.baseSha}`,
      'proof-package.baseSha',
      { expected: candidate.baseSha, actual: proofPackage.baseSha },
    );
  }
  const manifest = proofPackage.inputManifest;
  if (manifest.baseSha !== candidate.baseSha) {
    throw unbound(
      `inputManifest.baseSha ${manifest.baseSha} is not the admitted candidate's baseSha ${candidate.baseSha}`,
      'proof-package.inputManifest.baseSha',
      { expected: candidate.baseSha, actual: manifest.baseSha },
    );
  }
  const admissibleDiffs = candidateDiffRefs(candidate.baseSha, candidate.candidateSha);
  if (!admissibleDiffs.includes(manifest.candidateShaOrDiff)) {
    throw unbound(
      `inputManifest.candidateShaOrDiff "${manifest.candidateShaOrDiff}" is not one of ${admissibleDiffs.join(' | ')}`,
      'proof-package.inputManifest.candidateShaOrDiff',
      { expected: admissibleDiffs, actual: manifest.candidateShaOrDiff },
    );
  }
  // R2 F6: SET EQUALITY with the stored RedPlan -- a package that omits a planned probe claims
  // proof over a narrower plan than the run established; a foreign id claims a probe never planned.
  const plannedProbes = new Set(redPlan.probes.map((probe) => probe.id));
  if (proofPackage.probeIdentities.length === 0) {
    throw unbound(
      'probeIdentities must name every stored RedPlan probe (got none)',
      'proof-package.probeIdentities',
      {
        planned: [...plannedProbes],
      },
    );
  }
  const foreign = proofPackage.probeIdentities.filter((id) => !plannedProbes.has(id));
  if (foreign.length > 0) {
    throw unbound(
      `probeIdentities name probes outside the stored RedPlan: ${foreign.join(', ')}`,
      'proof-package.probeIdentities',
      { foreign, planned: [...plannedProbes] },
    );
  }
  const named = new Set(proofPackage.probeIdentities);
  const omitted = [...plannedProbes].filter((id) => !named.has(id));
  if (omitted.length > 0) {
    throw unbound(
      `probeIdentities omit stored RedPlan probes: ${omitted.join(', ')}`,
      'proof-package.probeIdentities',
      { omitted, planned: [...plannedProbes] },
    );
  }
}

/**
 * ASSEMBLE_EVIDENCE -> DONE, or terminal NON_REPRODUCIBLE (D4). The package must be BOUND to the run
 * (R1 F4, R2 F6): its candidateSha/baseSha are the admitted candidate's, its manifest names that
 * base and the `base..candidate` range, and its probeIdentities are EXACTLY the stored RedPlan's
 * probe ids (set equality) -- else PPE_PROOF_PACKAGE_UNBOUND (inadmissible artifact, no terminal
 * state). The comparison must be BOUND to this package: manifestDigest ===
 * digestOf(proofPackage.inputManifest) and expectedPackageDigest === digestOf(proofPackage) (both
 * over the validated canonical form), else PPE_REPLAY_UNBOUND. The machine recomputes divergence
 * from the digests itself; any observed digest that differs is recorded as a `runtime_result`
 * locator `replay-iteration:<i>:<digest>`. DONE is evidence, not PROVEN (frozen design section 12).
 */
export function applyProofPackage(
  state: PatternProofRunState,
  input: unknown,
  comparison: ReplayComparison,
): PatternProofRunState {
  assertPhase(state, 'ASSEMBLE_EVIDENCE');
  const proofPackage = validateProofPackage(input);
  requireProofPackageBinding(state, proofPackage);
  const bound = validateReplayComparison(comparison);
  const manifestDigest = digestOf(proofPackage.inputManifest);
  if (bound.manifestDigest !== manifestDigest) {
    throw new PatternProofError(
      'PPE_REPLAY_UNBOUND',
      `comparison.manifestDigest ${bound.manifestDigest} is not digestOf(proofPackage.inputManifest) ${manifestDigest}`,
      { path: 'replay-comparison.manifestDigest' },
    );
  }
  const packageDigest = digestOf(proofPackage);
  if (bound.expectedPackageDigest !== packageDigest) {
    throw new PatternProofError(
      'PPE_REPLAY_UNBOUND',
      `comparison.expectedPackageDigest ${bound.expectedPackageDigest} is not digestOf(proofPackage) ${packageDigest}`,
      { path: 'replay-comparison.expectedPackageDigest' },
    );
  }
  const divergent = divergentObservations(bound);
  if (divergent.length > 0) {
    const evidence: EvidenceLocator[] = divergent.map(({ iteration, digest }) => ({
      kind: 'runtime_result',
      ref: `replay-iteration:${iteration}:${digest}`,
      note: `expected ${packageDigest}`,
    }));
    return terminate(
      state,
      'applyProofPackage',
      terminalRecord('NON_REPRODUCIBLE', 'ASSEMBLE_EVIDENCE', evidence, {
        reasonCode: REPLAY_DIGEST_DIVERGED,
      }),
    );
  }
  return nextState(state, {
    phase: 'DONE',
    artifacts: { proofPackage },
    transition: { from: 'ASSEMBLE_EVIDENCE', to: 'DONE', via: 'applyProofPackage' },
  });
}

// ---------------------------------------------------------------------------------------------
// Drivers / views
// ---------------------------------------------------------------------------------------------

/**
 * Runs DISCOVER .. RED_SYNTHESIS over a supplied artifact sequence and returns wherever the machine
 * stops: a terminal record, stoppedByMode (BOOTSTRAP_RED_ONLY), or phase WRITER (FULL_PATTERN_PROOF,
 * awaiting a candidate this function never produces). This is what `ppe-cli run` replays (D3).
 */
export async function driveBootstrapSequence(
  input: BootstrapSequenceInput,
  resolver: AuthorityLocatorResolver,
): Promise<PatternProofRunState> {
  let state = startPatternProofRun(
    input.baseSha === undefined
      ? { runId: input.runId, mode: input.mode }
      : { runId: input.runId, mode: input.mode, baseSha: input.baseSha },
  );
  state = applyDiscovery(state, input.discovery);
  state = applyDependencyGraph(state, input.dependencyGraph);
  state = applyDecisionGate(state, input.decisionGate);
  if (state.terminal !== undefined) return state;
  return applyRedSynthesis(state, input.proposedProbes, resolver);
}

/** Small JSON-serializable view (no undefined-valued keys; digestable). */
export function summarizeRunState(state: PatternProofRunState): PatternProofRunSummary {
  if (!isPhase(state.phase)) {
    throw new PatternProofError(
      'PPE_SCHEMA_INVALID',
      `not a PatternProofRunState phase: ${String(state.phase)}`,
    );
  }
  const storedArtifacts: PatternProofArtifactKind[] = [];
  for (const [key, kind] of STORED_ARTIFACT_KINDS) {
    if (state.artifacts[key] !== undefined) storedArtifacts.push(kind);
  }
  const out: {
    runId: string;
    mode: PatternProofMode;
    baseSha?: string;
    phase: PatternProofPhase;
    terminal?: PatternProofTerminalRecord;
    stoppedByMode?: PatternProofStoppedByMode;
    storedArtifacts: readonly PatternProofArtifactKind[];
  } = { runId: state.runId, mode: state.mode, phase: state.phase, storedArtifacts };
  if (state.baseSha !== undefined) out.baseSha = state.baseSha;
  if (state.terminal !== undefined) out.terminal = state.terminal;
  if (state.stoppedByMode !== undefined) out.stoppedByMode = state.stoppedByMode;
  return deepFreeze(out);
}
