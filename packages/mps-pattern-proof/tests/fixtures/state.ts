/**
 * State-machine fixture helpers (plan section 6, as amended by D1/D6/D7/T3).
 *
 * Everything here is SYNTHETIC: no agents, no real diff, no Dockerfile change, no docker daemon.
 * The ports defined here (`StageProbeOracle`, `VerifierProbeRunner`) are verifier-owned test
 * doubles that stand in for the verifier lane's own probes; the state machine never sees them --
 * it only sees the PatternVerificationArtifact they produce, exactly as it would in production.
 */
import type {
  CandidateArtifact,
  PatternVerificationArtifact,
  ProofPackage,
  VerificationClaim,
} from '../../src/artifacts';
import { InMemoryAuthorityResolver, type AuthorityLocatorResolver } from '../../src/authority';
import { isEvidenceLocatorKind, type EvidenceLocator } from '../../src/evidence';
import { digestOf, type Digest } from '../../src/identity';
import type { ReplayComparison } from '../../src/replay';
import {
  applyCandidate,
  applyDecisionGate,
  applyDependencyGraph,
  applyDiscovery,
  applyRedSynthesis,
  applyVerification,
  startPatternProofRun,
  type PatternProofMode,
  type PatternProofRunState,
} from '../../src/state-machine';
import { validateProofPackage } from '../../src/validators';
import {
  validCandidate,
  validDiscovery,
  validGate,
  validGraph,
  validRedPlan,
  validVerification,
} from './artifacts';

// ---------------------------------------------------------------------------------------------
// Verifier-owned ports (test doubles)
// ---------------------------------------------------------------------------------------------

export type StageProbeClassification = 'PASS' | 'FAIL' | 'BLOCKED';

export interface StageProbeResult {
  readonly classification: StageProbeClassification;
  readonly evidence: EvidenceLocator;
}

/** A verifier-owned probe over one Docker stage of a candidate (D6, via an oracle port). */
export interface StageProbeOracle {
  probeStage(stageName: string): Promise<StageProbeResult>;
}

/** The synthetic candidate the FALSIFIED fixture's oracle evaluates: which stages skip lifecycle scripts. */
export interface SyntheticCandidateDescription {
  readonly stages: Readonly<Record<string, { readonly ignoreScripts: boolean }>>;
}

/**
 * Independently evaluates the synthetic description: a stage whose install step ignores lifecycle
 * scripts cannot fail on an absent postinstall dependency (PASS); a stage that still runs them
 * with no scripts/ present fails exactly as the base does today (FAIL); an unknown stage cannot
 * be probed (BLOCKED). The oracle never reads the writer's claim -- only the description.
 */
export class SyntheticStageProbeOracle implements StageProbeOracle {
  constructor(private readonly description: SyntheticCandidateDescription) {}

  async probeStage(stageName: string): Promise<StageProbeResult> {
    const stage = this.description.stages[stageName];
    const classification: StageProbeClassification =
      stage === undefined ? 'BLOCKED' : stage.ignoreScripts ? 'PASS' : 'FAIL';
    return {
      classification,
      evidence: { kind: 'runtime_result', ref: `verifier-owned-probe:${stageName}:${classification}` },
    };
  }
}

export type VerifierProbeAvailability =
  | { readonly available: true; readonly classification: StageProbeClassification }
  | { readonly available: false; readonly reason: string };

/** The port through which a verifier runs a mandatory probe; may report that it cannot run at all. */
export interface VerifierProbeRunner {
  run(probeId: string): Promise<VerifierProbeAvailability>;
}

export class UnavailableVerifierProbeRunner implements VerifierProbeRunner {
  constructor(private readonly reason: string) {}

  async run(_probeId: string): Promise<VerifierProbeAvailability> {
    return { available: false, reason: this.reason };
  }
}

// ---------------------------------------------------------------------------------------------
// Verification builders (what a verifier lane would emit from those ports)
// ---------------------------------------------------------------------------------------------

export interface StageProbeOutcome {
  readonly stageName: string;
  readonly result: StageProbeResult;
}

export async function probeStages(
  oracle: StageProbeOracle,
  stageNames: readonly string[],
): Promise<readonly StageProbeOutcome[]> {
  const out: StageProbeOutcome[] = [];
  for (const stageName of stageNames) out.push({ stageName, result: await oracle.probeStage(stageName) });
  return out;
}

/**
 * Builds the single final PatternVerificationArtifact from verifier-owned stage probes. Any BLOCKED
 * probe wins (fail closed: NOT_PROVEN / VERIFICATION_BLOCKED), then any FAIL (FALSIFIED), else ACCEPT.
 */
export function buildVerificationFromStageProbes(
  outcomes: readonly StageProbeOutcome[],
  isolationEvidence: readonly EvidenceLocator[],
): PatternVerificationArtifact {
  const claims: VerificationClaim[] = outcomes.map(({ stageName, result }) => ({
    claim: `stage ${stageName}: declared install step does not fail on absent lifecycle-script dependencies (${result.classification})`,
    evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
    materialInvariant: true,
  }));
  if (outcomes.some(({ result }) => result.classification === 'BLOCKED')) {
    return { claims, verdict: 'NOT_PROVEN', reasonCode: 'VERIFICATION_BLOCKED', isolationEvidence };
  }
  const verdict = outcomes.some(({ result }) => result.classification === 'FAIL') ? 'FALSIFIED' : 'ACCEPT';
  return { claims, verdict, isolationEvidence };
}

/** A verifier that could not run a mandatory probe emits NOT_PROVEN / VERIFICATION_BLOCKED, never a verdict. */
export function buildVerificationFromRunner(
  probeId: string,
  availability: VerifierProbeAvailability,
  isolationEvidence: readonly EvidenceLocator[],
): PatternVerificationArtifact {
  if (availability.available === false) {
    return {
      claims: [
        {
          claim: `mandatory verifier probe ${probeId} could not execute: ${availability.reason}`,
          evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
          materialInvariant: false,
        },
      ],
      verdict: 'NOT_PROVEN',
      reasonCode: 'VERIFICATION_BLOCKED',
      isolationEvidence,
    };
  }
  return buildVerificationFromStageProbes(
    [
      {
        stageName: probeId,
        result: {
          classification: availability.classification,
          evidence: {
            kind: 'runtime_result',
            ref: `verifier-owned-probe:${probeId}:${availability.classification}`,
          },
        },
      },
    ],
    isolationEvidence,
  );
}

// ---------------------------------------------------------------------------------------------
// Locator harvesting + resolvers
// ---------------------------------------------------------------------------------------------

/** Every EvidenceLocator-shaped object anywhere inside the given values (deterministic order). */
export function allLocatorsOf(...values: readonly unknown[]): readonly EvidenceLocator[] {
  const out: EvidenceLocator[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (isEvidenceLocatorKind(record.kind) && typeof record.ref === 'string') {
      const locator: { kind: EvidenceLocator['kind']; ref: string; note?: string } = {
        kind: record.kind,
        ref: record.ref,
      };
      if (typeof record.note === 'string') locator.note = record.note;
      out.push(locator);
      return;
    }
    for (const key of Object.keys(record)) walk(record[key]);
  };
  for (const value of values) walk(value);
  return out;
}

/** An InMemoryAuthorityResolver that resolves every locator cited by the given artifacts. */
export function seededResolver(...artifacts: readonly unknown[]): InMemoryAuthorityResolver {
  return new InMemoryAuthorityResolver(allLocatorsOf(...artifacts));
}

/** Resolves everything the happy-path fixtures cite (discovery, graph, red plan, candidate, verification). */
export function happyPathResolver(): InMemoryAuthorityResolver {
  return seededResolver(
    validDiscovery(),
    validGraph(),
    validRedPlan(),
    validCandidate(),
    validVerification(),
  );
}

/** A diffResolver that reports exactly these changed paths regardless of shas. */
export function diffResolverReturning(
  paths: readonly string[],
): (baseSha: string, candidateSha: string) => Promise<readonly string[]> {
  return async (_baseSha: string, _candidateSha: string) => paths;
}

// ---------------------------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------------------------

/** DISCOVER -> RED_SYNTHESIS with the valid fixtures; stops wherever the machine stops. */
export async function driveThroughRedSynthesis(
  mode: PatternProofMode,
  resolver: AuthorityLocatorResolver = happyPathResolver(),
  runId = `ppe-fixture-${mode}`,
): Promise<PatternProofRunState> {
  let state = startPatternProofRun({ runId, mode });
  state = applyDiscovery(state, validDiscovery());
  state = applyDependencyGraph(state, validGraph());
  state = applyDecisionGate(state, validGate());
  return applyRedSynthesis(state, validRedPlan(), resolver);
}

/** FULL_PATTERN_PROOF happy path up to phase VERIFY (candidate admitted). */
export async function driveToVerify(
  resolver: AuthorityLocatorResolver = happyPathResolver(),
  candidate: CandidateArtifact = validCandidate(),
): Promise<PatternProofRunState> {
  const state = await driveThroughRedSynthesis('FULL_PATTERN_PROOF', resolver);
  return applyCandidate(state, candidate, {
    diffResolver: diffResolverReturning(candidate.allowedPathsCompliance.allowedPaths),
    resolver,
  });
}

/** FULL_PATTERN_PROOF happy path up to phase ASSEMBLE_EVIDENCE (verification ACCEPT admitted). */
export async function driveToAssembleEvidence(
  resolver: AuthorityLocatorResolver = happyPathResolver(),
): Promise<PatternProofRunState> {
  const state = await driveToVerify(resolver);
  return applyVerification(state, validVerification(), resolver);
}

// ---------------------------------------------------------------------------------------------
// Replay + freezing helpers
// ---------------------------------------------------------------------------------------------

/**
 * A ReplayComparison bound to `pkg` (digests over the validated canonical form). With no
 * `observed`, two identical observations (reproducible); otherwise the given digests.
 */
export function boundComparison(pkg: ProofPackage, observed?: readonly Digest[]): ReplayComparison {
  const validated = validateProofPackage(pkg);
  const expectedPackageDigest = digestOf(validated);
  const observedDigests = observed ?? [expectedPackageDigest, expectedPackageDigest];
  return {
    manifestDigest: digestOf(validated.inputManifest),
    expectedPackageDigest,
    observedDigests,
    reproducible: observedDigests.every((digest) => digest === expectedPackageDigest),
  };
}

/** True iff `value` and every nested object/array is frozen. */
export function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.keys(value).every((key) => isDeepFrozen((value as Record<string, unknown>)[key]));
}

/** True iff no key anywhere in `value` holds `undefined` (states must digest under canonicalizeStrict). */
export function hasNoUndefinedKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasNoUndefinedKeys);
  if (typeof value !== 'object' || value === null) return true;
  return Object.keys(value).every((key) => {
    const item = (value as Record<string, unknown>)[key];
    return item !== undefined && hasNoUndefinedKeys(item);
  });
}
