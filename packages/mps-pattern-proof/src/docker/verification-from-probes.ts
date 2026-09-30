/**
 * PATTERN-PROOF-ENGINE-01 V1 -- the single final PatternVerificationArtifact derived from
 * verifier-owned RED probe executions (BOOTSTRAP sections 4-6; R1 F14).
 *
 * The mapping the frozen design wants proven in src, not in a fixture: inability to execute a
 * mandatory probe is NEVER converted into ACCEPT or FALSIFIED.
 *
 *   any BLOCKED result  -> verdict NOT_PROVEN, reasonCode VERIFICATION_BLOCKED
 *   else any FAIL       -> verdict FALSIFIED   (the candidate violates the asserted behavior)
 *   else (all PASS)     -> verdict ACCEPT
 *
 * Every probe becomes one claim grounded in VERIFIER_OWNED_PROBE; a BLOCKED probe's claim is not a
 * material invariant (nothing was established), an executed probe's claim is. Zero results are not
 * a verification (PPE_SCHEMA_INVALID), a result with an unknown classification is inadmissible
 * (PPE_SCHEMA_INVALID); the artifact is returned through the validator (deep-frozen).
 */
import type { PatternVerificationArtifact, VerificationClaim } from '../artifacts';
import { PatternProofError } from '../errors';
import type { EvidenceLocator } from '../evidence';
import { validatePatternVerificationArtifact } from '../validators';
import type { RedProbeExecutionResult } from './red-probe';

export const VERIFICATION_BLOCKED_REASON_CODE = 'VERIFICATION_BLOCKED';

const RESULT_CLASSIFICATIONS: readonly string[] = Object.freeze(['PASS', 'FAIL', 'BLOCKED']);

export interface VerificationFromProbesOptions {
  /** the verifier lane's isolation evidence (createVerifierContext().isolationEvidence in production) */
  readonly isolationEvidence: readonly EvidenceLocator[];
  /** the verify-only key id the verifier lane was bound to (VerifierContext.verifierAuthority) */
  readonly verifierAuthority: string;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be a non-empty string', { path });
  }
  return value;
}

function claimFor(
  result: RedProbeExecutionResult,
  index: number,
  verifierAuthority: string,
): VerificationClaim {
  const path = `results[${index}]`;
  const probeId = requireNonEmptyString(result.probeId, `${path}.probeId`);
  const stageName = requireNonEmptyString(result.stageName, `${path}.stageName`);
  const reasonCode = requireNonEmptyString(result.reasonCode, `${path}.reasonCode`);
  const classification: unknown = result.classification;
  if (typeof classification !== 'string' || !RESULT_CLASSIFICATIONS.includes(classification)) {
    throw new PatternProofError(
      'PPE_SCHEMA_INVALID',
      `classification must be one of ${RESULT_CLASSIFICATIONS.join(', ')}`,
      { path: `${path}.classification` },
    );
  }
  if (classification === 'BLOCKED') {
    const why =
      typeof result.blockedReason === 'string' && result.blockedReason.length > 0
        ? result.blockedReason
        : reasonCode;
    return {
      claim: `verifier ${verifierAuthority}: probe ${probeId} (stage ${stageName}) could not execute: BLOCKED ${reasonCode} -- ${why}`,
      evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
      materialInvariant: false,
    };
  }
  return {
    claim: `verifier ${verifierAuthority}: probe ${probeId} (stage ${stageName}) ${classification} ${reasonCode}: ${result.assertedBehavior}`,
    evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
    materialInvariant: true,
  };
}

/**
 * Derives the verification artifact from verifier-owned probe executions. BLOCKED wins (NOT_PROVEN /
 * VERIFICATION_BLOCKED), then FAIL (FALSIFIED), else ACCEPT. Never converts a BLOCKED probe into a
 * verdict; never returns a verdict over zero probes.
 */
export function verificationFromRedProbeResults(
  results: readonly RedProbeExecutionResult[],
  opts: VerificationFromProbesOptions,
): PatternVerificationArtifact {
  if (!Array.isArray(results) || results.length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'a verification needs at least one probe result', {
      path: 'results',
    });
  }
  const verifierAuthority = requireNonEmptyString(opts.verifierAuthority, 'verifierAuthority');
  const claims = results.map((result, index) => claimFor(result, index, verifierAuthority));
  const classifications = results.map((result) => result.classification);
  const isolationEvidence = [...opts.isolationEvidence];
  if (classifications.includes('BLOCKED')) {
    return validatePatternVerificationArtifact({
      claims,
      verdict: 'NOT_PROVEN',
      reasonCode: VERIFICATION_BLOCKED_REASON_CODE,
      isolationEvidence,
    });
  }
  const verdict = classifications.includes('FAIL') ? 'FALSIFIED' : 'ACCEPT';
  return validatePatternVerificationArtifact({ claims, verdict, isolationEvidence });
}
