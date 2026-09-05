import type { ArtifactContract, ArtifactReference } from './ArtifactContract';
import { sha256ContentHash } from '../canonical/sha256Canonical';

export const CAPABILITY_QUALIFICATION_ARTIFACT_TYPE = 'capability_qualification' as const;
export const CAPABILITY_QUALIFICATION_SCHEMA_VERSION = 'capability-qualification/v1' as const;
export const CAPABILITY_QUALIFICATION_DERIVATION_VERSION = 'qualification-engine/v1' as const;
export const CAPABILITY_QUALIFICATION_CANONICALIZER_ID = 'rfc8785-sha256-v1' as const;

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

function normalizeReference(reference: ArtifactReference): ArtifactReference {
  return {
    artifact_id: reference.artifact_id,
    artifact_type: reference.artifact_type,
  };
}

function normalizePredicate(
  predicate: QualificationPredicateObservation,
): QualificationPredicateObservation {
  const predicateId = predicate.predicate_id.trim();
  if (!predicateId) throw new Error('CAPABILITY_QUALIFICATION_INVALID_PREDICATE_ID');
  if (predicate.result === 'PASS' && predicate.blocker) {
    throw new Error('CAPABILITY_QUALIFICATION_PASS_WITH_BLOCKER');
  }
  if (predicate.result === 'FAIL' && !predicate.blocker) {
    throw new Error('CAPABILITY_QUALIFICATION_FAIL_WITHOUT_BLOCKER');
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
            code: predicate.blocker.code.trim(),
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

export function deriveQualifiedLevel(input: {
  readonly target_level: GaLevel;
  readonly predicates: readonly QualificationPredicateObservation[];
  readonly policy: CapabilityQualificationPolicyV1;
}): GaLevel {
  const predicateById = new Map(input.predicates.map((predicate) => [predicate.predicate_id, predicate]));
  const targetIndex = levelIndex(input.target_level);

  for (let index = targetIndex; index >= 0; index -= 1) {
    const level = GA_LEVELS[index];
    const requiredPredicates = input.policy.requirements_by_level[level] ?? [];
    const allPass = requiredPredicates.every((predicateId) => predicateById.get(predicateId)?.result === 'PASS');
    if (allPass) return level;
  }

  return 'GA-L0';
}

export function createCapabilityQualificationArtifact(input: {
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
    subject: {
      repository: input.subject.repository.trim(),
      candidate_sha: candidateSha,
      build_identity: input.subject.build_identity.trim(),
      controller_version: input.subject.controller_version.trim(),
    },
    target_level: input.target_level,
    qualified_level: qualifiedLevel,
    delta_qualification: deltaQualification,
    predicates: normalizedPredicates,
    qualification_policy_version: input.policy.policy_version,
    qualification_policy_hash: input.policy.policy_hash,
    derivation_version: CAPABILITY_QUALIFICATION_DERIVATION_VERSION,
    evaluator_hash: input.evaluator_hash.trim(),
  };

  const identity = sha256ContentHash({
    canonicalizer_id: CAPABILITY_QUALIFICATION_CANONICALIZER_ID,
    artifact_type: CAPABILITY_QUALIFICATION_ARTIFACT_TYPE,
    payload,
  });

  const references = normalizedPredicates.flatMap((predicate) => predicate.evidence_refs);
  const artifact: Omit<CapabilityQualificationArtifact, 'content_hash'> = {
    artifact_id: `capability-qualification-${identity.value.slice(0, 24)}`,
    artifact_type: CAPABILITY_QUALIFICATION_ARTIFACT_TYPE,
    references,
    payload,
  };

  return {
    ...artifact,
    content_hash: sha256ContentHash(artifact),
  };
}

export function replayCapabilityQualification(input: {
  readonly artifact: CapabilityQualificationArtifact;
  readonly policy: CapabilityQualificationPolicyV1;
}): boolean {
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
