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

const STRUCTURAL_BLOCKER_CLASSES = new Set<QualificationBlockerClass>([
  'STRUCTURAL_BLOCKER',
  'CONFIGURATION_BLOCKER',
  'DEPENDENCY_BLOCKER',
]);

const RUNTIME_AUTHORITY_BLOCKER_CLASSES = new Set<QualificationBlockerClass>([
  'AUTHORITY_BLOCKER',
  'REVOCATION_BLOCKER',
]);

const SHA256_REFERENCE_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA256_VALUE_PATTERN = /^[0-9a-f]{64}$/;

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

function isGaLevel(value: unknown): value is GaLevel {
  return typeof value === 'string' && (GA_LEVELS as readonly string[]).includes(value);
}

function levelIndex(level: GaLevel): number {
  return GA_LEVELS.indexOf(level);
}

function required(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function requiredSha256Reference(value: unknown, code: string): string {
  const normalized = required(value, code).toLowerCase();
  if (!SHA256_REFERENCE_PATTERN.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizeReference(reference: ArtifactReference): ArtifactReference {
  if (!reference || typeof reference !== 'object') {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_EVIDENCE_REFERENCE');
  }
  return {
    artifact_id: required(reference.artifact_id, 'CAPABILITY_QUALIFICATION_INVALID_EVIDENCE_ID'),
    artifact_type: required(reference.artifact_type, 'CAPABILITY_QUALIFICATION_INVALID_EVIDENCE_TYPE'),
  };
}

function normalizeBlocker(blocker: QualificationBlocker): QualificationBlocker {
  if (!blocker || typeof blocker !== 'object') {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_BLOCKER');
  }

  const blockerClass = required(
    (blocker as { class?: unknown }).class,
    'CAPABILITY_QUALIFICATION_INVALID_BLOCKER_CLASS',
  ) as QualificationBlockerClass;

  if (RUNTIME_AUTHORITY_BLOCKER_CLASSES.has(blockerClass)) {
    throw new Error('CAPABILITY_QUALIFICATION_RUNTIME_AUTHORITY_BLOCKER_FORBIDDEN');
  }
  if (blockerClass === 'RUNTIME_TRANSIENT') {
    throw new Error('CAPABILITY_QUALIFICATION_RUNTIME_TRANSIENT_FORBIDDEN');
  }
  if (!STRUCTURAL_BLOCKER_CLASSES.has(blockerClass)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_BLOCKER_CLASS');
  }

  return {
    class: blockerClass,
    code: required(blocker.code, 'CAPABILITY_QUALIFICATION_INVALID_BLOCKER_CODE'),
  };
}

function normalizePredicate(
  predicate: QualificationPredicateObservation,
): QualificationPredicateObservation {
  if (!predicate || typeof predicate !== 'object') {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_PREDICATE');
  }

  const predicateId = required(
    predicate.predicate_id,
    'CAPABILITY_QUALIFICATION_INVALID_PREDICATE_ID',
  );
  if (predicate.result !== 'PASS' && predicate.result !== 'FAIL') {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_PREDICATE_RESULT');
  }
  if (!Array.isArray(predicate.evidence_refs)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_EVIDENCE_REFS');
  }
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
    ...(predicate.blocker ? { blocker: normalizeBlocker(predicate.blocker) } : {}),
  };
}

function normalizePredicates(
  predicates: readonly QualificationPredicateObservation[],
): readonly QualificationPredicateObservation[] {
  if (!Array.isArray(predicates)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_PREDICATES');
  }

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

function validatePolicy(policy: CapabilityQualificationPolicyV1): CapabilityQualificationPolicyV1 {
  if (!policy || typeof policy !== 'object') {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_POLICY');
  }

  const policyVersion = required(
    policy.policy_version,
    'CAPABILITY_QUALIFICATION_INVALID_POLICY_VERSION',
  );
  const policyHash = requiredSha256Reference(
    policy.policy_hash,
    'CAPABILITY_QUALIFICATION_INVALID_POLICY_HASH',
  );
  if (!policy.requirements_by_level || typeof policy.requirements_by_level !== 'object') {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_POLICY_REQUIREMENTS');
  }

  const requirementsByLevel = {} as Record<GaLevel, readonly string[]>;
  const seenRequirements = new Set<string>();

  for (const level of GA_LEVELS) {
    if (!Object.prototype.hasOwnProperty.call(policy.requirements_by_level, level)) {
      throw new Error('CAPABILITY_QUALIFICATION_MISSING_POLICY_LEVEL');
    }

    const requirements = policy.requirements_by_level[level];
    if (!Array.isArray(requirements)) {
      throw new Error('CAPABILITY_QUALIFICATION_INVALID_POLICY_LEVEL_REQUIREMENTS');
    }

    const normalizedRequirements = requirements.map((predicateId) =>
      required(predicateId, 'CAPABILITY_QUALIFICATION_INVALID_POLICY_PREDICATE_ID'),
    );
    for (const predicateId of normalizedRequirements) {
      if (seenRequirements.has(predicateId)) {
        throw new Error('CAPABILITY_QUALIFICATION_DUPLICATE_POLICY_REQUIREMENT');
      }
      seenRequirements.add(predicateId);
    }
    requirementsByLevel[level] = normalizedRequirements;
  }

  return {
    policy_version: policyVersion,
    policy_hash: policyHash,
    requirements_by_level: requirementsByLevel,
  };
}

function cumulativeRequirements(
  policy: CapabilityQualificationPolicyV1,
  level: GaLevel,
): readonly string[] {
  const requirements: string[] = [];
  const maxIndex = levelIndex(level);
  for (let index = 0; index <= maxIndex; index += 1) {
    requirements.push(...policy.requirements_by_level[GA_LEVELS[index]]);
  }
  return requirements;
}

function deriveQualifiedLevelFromValidated(input: {
  readonly target_level: GaLevel;
  readonly predicates: readonly QualificationPredicateObservation[];
  readonly policy: CapabilityQualificationPolicyV1;
}): GaLevel {
  const predicateById = new Map(input.predicates.map((predicate) => [predicate.predicate_id, predicate]));
  const targetIndex = levelIndex(input.target_level);

  for (let index = targetIndex; index >= 0; index -= 1) {
    const level = GA_LEVELS[index];
    const requiredPredicates = cumulativeRequirements(input.policy, level);
    const allPass = requiredPredicates.every(
      (predicateId) => predicateById.get(predicateId)?.result === 'PASS',
    );
    if (allPass) return level;
  }

  return 'GA-L0';
}

export function deriveQualifiedLevel(input: {
  readonly target_level: GaLevel;
  readonly predicates: readonly QualificationPredicateObservation[];
  readonly policy: CapabilityQualificationPolicyV1;
}): GaLevel {
  if (!isGaLevel(input.target_level)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_TARGET_LEVEL');
  }
  const policy = validatePolicy(input.policy);
  const predicates = normalizePredicates(input.predicates);
  return deriveQualifiedLevelFromValidated({ target_level: input.target_level, predicates, policy });
}

function contentHashFor(
  artifact: Omit<CapabilityQualificationArtifact, 'content_hash'>,
): CapabilityQualificationArtifact['content_hash'] {
  return sha256ContentHash({
    canonicalizer_id: CAPABILITY_QUALIFICATION_CANONICALIZER_ID,
    artifact_type: CAPABILITY_QUALIFICATION_ARTIFACT_TYPE,
    artifact,
  });
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return sha256ContentHash(left).value === sha256ContentHash(right).value;
}

export function createCapabilityQualificationArtifact(input: {
  readonly artifact_id: string;
  readonly subject: CapabilityQualificationSubject;
  readonly target_level: GaLevel;
  readonly predicates: readonly QualificationPredicateObservation[];
  readonly policy: CapabilityQualificationPolicyV1;
  readonly evaluator_hash: string;
}): CapabilityQualificationArtifact {
  if (!isGaLevel(input.target_level)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_TARGET_LEVEL');
  }

  const candidateSha = required(
    input.subject?.candidate_sha,
    'CAPABILITY_QUALIFICATION_INVALID_CANDIDATE_SHA',
  ).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new Error('CAPABILITY_QUALIFICATION_INVALID_CANDIDATE_SHA');
  }

  const validatedPolicy = validatePolicy(input.policy);
  const normalizedPredicates = normalizePredicates(input.predicates);
  const qualifiedLevel = deriveQualifiedLevelFromValidated({
    target_level: input.target_level,
    predicates: normalizedPredicates,
    policy: validatedPolicy,
  });
  const deltaQualification = levelIndex(input.target_level) - levelIndex(qualifiedLevel);

  const payload: CapabilityQualificationArtifact['payload'] = {
    schema_version: CAPABILITY_QUALIFICATION_SCHEMA_VERSION,
    qualification_scope: CAPABILITY_QUALIFICATION_SCOPE,
    subject: {
      repository: required(input.subject.repository, 'CAPABILITY_QUALIFICATION_INVALID_REPOSITORY'),
      candidate_sha: candidateSha,
      build_identity: required(
        input.subject.build_identity,
        'CAPABILITY_QUALIFICATION_INVALID_BUILD_IDENTITY',
      ),
      controller_version: required(
        input.subject.controller_version,
        'CAPABILITY_QUALIFICATION_INVALID_CONTROLLER_VERSION',
      ),
    },
    target_level: input.target_level,
    qualified_level: qualifiedLevel,
    delta_qualification: deltaQualification,
    predicates: normalizedPredicates,
    qualification_policy_version: validatedPolicy.policy_version,
    qualification_policy_hash: validatedPolicy.policy_hash,
    derivation_version: CAPABILITY_QUALIFICATION_DERIVATION_VERSION,
    evaluator_hash: requiredSha256Reference(
      input.evaluator_hash,
      'CAPABILITY_QUALIFICATION_INVALID_EVALUATOR_HASH',
    ),
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
    content_hash: contentHashFor(artifact),
  };
}

export function replayCapabilityQualification(input: {
  readonly artifact: CapabilityQualificationArtifact;
  readonly policy: CapabilityQualificationPolicyV1;
}): boolean {
  try {
    const artifact = input.artifact;
    if (!artifact || typeof artifact !== 'object') return false;
    if (artifact.artifact_type !== CAPABILITY_QUALIFICATION_ARTIFACT_TYPE) return false;
    required(artifact.artifact_id, 'CAPABILITY_QUALIFICATION_INVALID_ARTIFACT_ID');
    if (artifact.payload.schema_version !== CAPABILITY_QUALIFICATION_SCHEMA_VERSION) return false;
    if (artifact.payload.qualification_scope !== CAPABILITY_QUALIFICATION_SCOPE) return false;
    if (artifact.payload.derivation_version !== CAPABILITY_QUALIFICATION_DERIVATION_VERSION) return false;
    if (!isGaLevel(artifact.payload.target_level) || !isGaLevel(artifact.payload.qualified_level)) {
      return false;
    }

    const candidateSha = required(
      artifact.payload.subject?.candidate_sha,
      'CAPABILITY_QUALIFICATION_INVALID_CANDIDATE_SHA',
    );
    if (!/^[0-9a-f]{40}$/.test(candidateSha)) return false;
    required(artifact.payload.subject.repository, 'CAPABILITY_QUALIFICATION_INVALID_REPOSITORY');
    required(
      artifact.payload.subject.build_identity,
      'CAPABILITY_QUALIFICATION_INVALID_BUILD_IDENTITY',
    );
    required(
      artifact.payload.subject.controller_version,
      'CAPABILITY_QUALIFICATION_INVALID_CONTROLLER_VERSION',
    );
    requiredSha256Reference(
      artifact.payload.evaluator_hash,
      'CAPABILITY_QUALIFICATION_INVALID_EVALUATOR_HASH',
    );

    const policy = validatePolicy(input.policy);
    if (artifact.payload.qualification_policy_version !== policy.policy_version) return false;
    if (artifact.payload.qualification_policy_hash !== policy.policy_hash) return false;

    const normalizedPredicates = normalizePredicates(artifact.payload.predicates);
    if (!sameCanonicalValue(normalizedPredicates, artifact.payload.predicates)) return false;

    const expectedReferences = normalizedPredicates.flatMap((predicate) => predicate.evidence_refs);
    if (!sameCanonicalValue(expectedReferences, artifact.references)) return false;

    if (
      artifact.content_hash.algorithm !== 'sha256' ||
      !SHA256_VALUE_PATTERN.test(artifact.content_hash.value)
    ) {
      return false;
    }
    const { content_hash: observedHash, ...artifactWithoutHash } = artifact;
    const expectedHash = contentHashFor(artifactWithoutHash);
    if (observedHash.algorithm !== expectedHash.algorithm || observedHash.value !== expectedHash.value) {
      return false;
    }

    const derived = deriveQualifiedLevelFromValidated({
      target_level: artifact.payload.target_level,
      predicates: normalizedPredicates,
      policy,
    });

    return (
      derived === artifact.payload.qualified_level &&
      levelIndex(artifact.payload.target_level) - levelIndex(derived) ===
        artifact.payload.delta_qualification
    );
  } catch {
    return false;
  }
}
