import type { ArtifactContract, ArtifactReference } from './ArtifactContract';
import { sha256ContentHash } from '../canonical/sha256Canonical';

export const CAPABILITY_QUALIFICATION_ARTIFACT_TYPE = 'capability_qualification' as const;
export const CAPABILITY_QUALIFICATION_SCHEMA_VERSION = 'capability-qualification/v1' as const;
export const CAPABILITY_QUALIFICATION_DERIVATION_VERSION = 'qualification-engine/v1' as const;
export const CAPABILITY_QUALIFICATION_CANONICALIZER_ID = 'rfc8785-sha256-v1' as const;
export const CAPABILITY_QUALIFICATION_SCOPE = 'STRUCTURAL_CAPABILITY' as const;

export const GA_LEVELS = ['GA-L0', 'GA-L1', 'GA-L2', 'GA-L3', 'GA-L4'] as const;
export type GaLevel = (typeof GA_LEVELS)[number];

export type QualificationPredicateResult = 'PASS' | 'FAIL';

export type QualificationBlockerClass =
  | 'STRUCTURAL_BLOCKER'
  | 'CONFIGURATION_BLOCKER'
  | 'DEPENDENCY_BLOCKER'
  | 'RUNTIME_TRANSIENT'
  | 'AUTHORITY_BLOCKER'
  | 'REVOCATION_BLOCKER';

export interface QualificationBlocker {
  readonly class: QualificationBlockerClass;
  readonly code: string;
}

export interface QualificationPredicateObservation {
  readonly predicate_id: string;
  readonly result: QualificationPredicateResult;
  readonly evidence_refs: readonly ArtifactReference[];
  readonly blocker?: QualificationBlocker;
}

export interface CapabilityQualificationPolicyV1 {
  readonly policy_version: string;
  readonly policy_hash: string;
  readonly requirements_by_level: Readonly<Record<GaLevel, readonly string[]>>;
}

export interface CapabilityQualificationSubject {
  readonly repository: string;
  readonly candidate_sha: string;
  readonly build_identity: string;
  readonly controller_version: string;
}

export interface CapabilityQualificationArtifact extends ArtifactContract {
  readonly artifact_type: typeof CAPABILITY_QUALIFICATION_ARTIFACT_TYPE;
  readonly payload: {
    readonly schema_version: typeof CAPABILITY_QUALIFICATION_SCHEMA_VERSION;
    readonly qualification_scope: typeof CAPABILITY_QUALIFICATION_SCOPE;
    readonly subject: CapabilityQualificationSubject;
    readonly target_level: GaLevel;
    readonly qualified_level: GaLevel;
    readonly delta_qualification: number;
    readonly predicates: readonly QualificationPredicateObservation[];
    readonly qualification_policy_version: string;
    readonly qualification_policy_hash: string;
    readonly derivation_version: typeof CAPABILITY_QUALIFICATION_DERIVATION_VERSION;
    readonly evaluator_hash: string;
  };
}

function levelIndex(level: GaLevel): number {
  return GA_LEVELS.indexOf(level);
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeReference(reference: ArtifactReference): ArtifactReference {
  return {
    artifact_id: required(reference.artifact_id, 'CAPABILITY_QUALIFICATION_INVALID_EVIDENCE_ID'),
    artifact_type: required(reference.artifact_type, 'CAPABILITY_QUALIFICATION_INVALID_EVIDENCE_TYPE'),
  };
}

function normalizePredicate(
  predicate: QualificationPredicateObservation,
): QualificationPredicateObservation {
  const predicateId = required(
    predicate.predicate_id,
    'CAPABILITY_QUALIFICATION_INVALID_PREDICATE_ID',
  );
  if (predicate.result === 'PASS' && predicate.blocker) {
    throw new Error('CAPABILITY_QUALIFICATION_PASS_WITH_BLOCKER');
  }
  if (predicate.result === 'FAIL' && !predicate.blocker) {
    throw new Error('CAPABILITY_QUALIFICATION_FAIL_WITHOUT_BLOCKER');
  }
  if (
    predicate.blocker?.class === 'AUTHORITY_BLOCKER' ||
    predicate.blocker?.class === 'REVOCATION_BLOCKER'
  ) {
    throw new Error('CAPABILITY_QUALIFICATION_RUNTIME_AUTHORITY_BLOCKER_FORBIDDEN');
  }
  if (predicate.blocker?.class === 'RUNTIME_TRANSIENT') {
    throw new Error('CAPABILITY_QUALIFICATION_RUNTIME_TRANSIENT_FORBIDDEN');
  }

  const evidenceRefs = [...predicate.evidence_refs]
    .map(normalizeReference)
    .sort((a, b) =>
      `${a.artifact_type}:${a.artifact_id}`.localeCompare(`${b.artifact_type}:${b.artifact_id}`),
    );

  return {
    predicate_id: predicateId,
    result: predicate.result,
    evidence_refs: evidenceRefs,
    ...(predicate.blocker
      ? {
          blocker: {
            class: predicate.blocker.class,
            code: required(predicate.blocker.code, 'CAPABILITY_QUALIFICATION_INVALID_BLOCKER_CODE'),
          },
        }
      : {}),
  };
}

function normalizePredicates(
  predicates: readonly QualificationPredicateObservation[],
): readonly QualificationPredicateObservation[] {
  const normalized = predicates.map(normalizePredicate).sort((a, b) =>
    a.predicate_id.localeCompare(b.predicate_id),
  );

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].predicate_id === normalized[index].predicate_id) {
      throw new Error('CAPABILITY_QUALIFICATION_DUPLICATE_PREDICATE');
    }
  }

  return normalized;
}

function cumulativeRequirements(
  policy: CapabilityQualificationPolicyV1,
  level: GaLevel,
): readonly string[] {
  const requirements = new Set<string>();
  const maxIndex = levelIndex(level);
  for (let index = 0; index <= maxIndex; index += 1) {
    for (const predicateId of policy.requirements_by_level[GA_LEVELS[index]] ?? []) {
      requirements.add(predicateId);
    }
  }
  return [...requirements];
}

export function deriveQualifiedLevel(input: {
  readonly target_level: GaLevel;
  readonly predicates: readonly QualificationPredicateObservation[];
  readonly policy: CapabilityQualificationPolicyV1;
}): GaLevel {
  const predicateById = new Map(input.predicates.map((predicate) => [predicate.predicate_id, predicate]));
  const targetIndex = levelIndex(input.target_level);

  for (let index = targetIndex; index >= 0; index -= 1) {
    const level = GA_LEVELS[index];
    const requiredPredicates = cumulativeRequirements(input.policy, level);
    const allPass = requiredPredicates.every((predicateId) => predicateById.get(predicateId)?.result === 'PASS');
    if (allPass) return level;
  }

  return 'GA-L0';
}

export function createCapabilityQualificationArtifact(input: {
  readonly artifact_id: string;
  readonly subject: CapabilityQualificationSubject;
  readonly target_level: GaLevel;
  readonly predicates: readonly QualificationPredicateObservation[];
  readonly policy: CapabilityQualificationPolicyV1;
  readonly evaluator_hash: string;
}): CapabilityQualificationArtifact {
  const candidateSha = input.subject.candidate_sha.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_CANDIDATE_SHA');
  }

  const normalizedPredicates = normalizePredicates(input.predicates);
  const qualifiedLevel = deriveQualifiedLevel({
    target_level: input.target_level,
    predicates: normalizedPredicates,
    policy: input.policy,
  });
  const deltaQualification = levelIndex(input.target_level) - levelIndex(qualifiedLevel);

  const payload: CapabilityQualificationArtifact['payload'] = {
    schema_version: CAPABILITY_QUALIFICATION_SCHEMA_VERSION,
    qualification_scope: CAPABILITY_QUALIFICATION_SCOPE,
    subject: {
      repository: required(input.subject.repository, 'CAPABILITY_QUALIFICATION_INVALID_REPOSITORY'),
      candidate_sha: candidateSha,
      build_identity: required(input.subject.build_identity, 'CAPABILITY_QUALIFICATION_INVALID_BUILD_IDENTITY'),
      controller_version: required(
        input.subject.controller_version,
        'CAPABILITY_QUALIFICATION_INVALID_CONTROLLER_VERSION',
      ),
    },
    target_level: input.target_level,
    qualified_level: qualifiedLevel,
    delta_qualification: deltaQualification,
    predicates: normalizedPredicates,
    qualification_policy_version: required(
      input.policy.policy_version,
      'CAPABILITY_QUALIFICATION_INVALID_POLICY_VERSION',
    ),
    qualification_policy_hash: required(
      input.policy.policy_hash,
      'CAPABILITY_QUALIFICATION_INVALID_POLICY_HASH',
    ),
    derivation_version: CAPABILITY_QUALIFICATION_DERIVATION_VERSION,
    evaluator_hash: required(input.evaluator_hash, 'CAPABILITY_QUALIFICATION_INVALID_EVALUATOR_HASH'),
  };

  const references = normalizedPredicates.flatMap((predicate) => predicate.evidence_refs);
  const artifact: Omit<CapabilityQualificationArtifact, 'content_hash'> = {
    artifact_id: required(input.artifact_id, 'CAPABILITY_QUALIFICATION_INVALID_ARTIFACT_ID'),
    artifact_type: CAPABILITY_QUALIFICATION_ARTIFACT_TYPE,
    references,
    payload,
  };

  return {
    ...artifact,
    content_hash: sha256ContentHash({
      canonicalizer_id: CAPABILITY_QUALIFICATION_CANONICALIZER_ID,
      artifact_type: CAPABILITY_QUALIFICATION_ARTIFACT_TYPE,
      artifact,
    }),
  };
}

export function replayCapabilityQualification(input: {
  readonly artifact: CapabilityQualificationArtifact;
  readonly policy: CapabilityQualificationPolicyV1;
}): boolean {
  if (input.artifact.payload.qualification_scope !== CAPABILITY_QUALIFICATION_SCOPE) return false;
  if (input.artifact.payload.qualification_policy_version !== input.policy.policy_version) return false;
  if (input.artifact.payload.qualification_policy_hash !== input.policy.policy_hash) return false;

  const derived = deriveQualifiedLevel({
    target_level: input.artifact.payload.target_level,
    predicates: input.artifact.payload.predicates,
    policy: input.policy,
  });

  return (
    derived === input.artifact.payload.qualified_level &&
    levelIndex(input.artifact.payload.target_level) - levelIndex(derived) ===
      input.artifact.payload.delta_qualification
  );
}
