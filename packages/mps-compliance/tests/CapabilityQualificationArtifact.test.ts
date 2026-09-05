import { describe, expect, it } from 'vitest';

import {
  createCapabilityQualificationArtifact,
  deriveQualifiedLevel,
  replayCapabilityQualification,
  type CapabilityQualificationPolicyV1,
  type QualificationPredicateObservation,
} from '../src/artifacts/CapabilityQualificationArtifact';

const policy: CapabilityQualificationPolicyV1 = {
  policy_version: 'ga-policy/v1',
  policy_hash: 'sha256:policy-v1',
  requirements_by_level: {
    'GA-L0': [],
    'GA-L1': ['implementation_verified'],
    'GA-L2': ['verifier_separation'],
    'GA-L3': ['durable_reconciliation'],
    'GA-L4': ['runtime_wiring_verified'],
  },
};

const evidence = (id: string) => ({
  artifact_id: id,
  artifact_type: 'proof',
});

const predicates: QualificationPredicateObservation[] = [
  {
    predicate_id: 'implementation_verified',
    result: 'PASS',
    evidence_refs: [evidence('proof-implementation')],
  },
  {
    predicate_id: 'verifier_separation',
    result: 'PASS',
    evidence_refs: [evidence('proof-verifier')],
  },
  {
    predicate_id: 'durable_reconciliation',
    result: 'PASS',
    evidence_refs: [evidence('proof-reconciliation')],
  },
  {
    predicate_id: 'runtime_wiring_verified',
    result: 'FAIL',
    evidence_refs: [evidence('proof-runtime-wiring')],
    blocker: {
      class: 'STRUCTURAL_BLOCKER',
      code: 'RUNTIME_WIRING_NOT_PROVEN',
    },
  },
];

function create(predicatesOverride: readonly QualificationPredicateObservation[] = predicates) {
  return createCapabilityQualificationArtifact({
    artifact_id: 'cq-artifact-001',
    subject: {
      repository: 'JbmbAb/Milj-beslut-V1.2',
      candidate_sha: '0123456789abcdef0123456789abcdef01234567',
      build_identity: 'build-001',
      controller_version: 'controller-v1',
    },
    target_level: 'GA-L4',
    predicates: predicatesOverride,
    policy,
    evaluator_hash: 'sha256:evaluator-v1',
  });
}

describe('GA-D1 CapabilityQualificationArtifact v1', () => {
  it('derives the structural ceiling instead of accepting a caller-supplied qualified level', () => {
    const artifact = create();

    expect(artifact.payload.qualification_scope).toBe('STRUCTURAL_CAPABILITY');
    expect(artifact.payload.target_level).toBe('GA-L4');
    expect(artifact.payload.qualified_level).toBe('GA-L3');
    expect(artifact.payload.delta_qualification).toBe(1);
    expect(artifact.artifact_id).toBe('cq-artifact-001');
  });

  it('requires lower-level predicates cumulatively before a higher level can qualify', () => {
    const withBrokenFoundation = predicates.map((predicate) =>
      predicate.predicate_id === 'implementation_verified'
        ? {
            ...predicate,
            result: 'FAIL' as const,
            blocker: { class: 'STRUCTURAL_BLOCKER' as const, code: 'IMPLEMENTATION_NOT_PROVEN' },
          }
        : predicate,
    );

    expect(
      deriveQualifiedLevel({
        target_level: 'GA-L4',
        predicates: withBrokenFoundation,
        policy,
      }),
    ).toBe('GA-L0');
  });

  it('is deterministic under predicate and evidence-reference ordering', () => {
    const reversed = [...predicates]
      .reverse()
      .map((predicate) => ({ ...predicate, evidence_refs: [...predicate.evidence_refs].reverse() }));

    const first = create(predicates);
    const second = create(reversed);

    expect(second.payload.predicates).toEqual(first.payload.predicates);
    expect(second.references).toEqual(first.references);
    expect(second.content_hash).toEqual(first.content_hash);
  });

  it('binds the exact candidate SHA into canonical content', () => {
    const first = create();
    const second = createCapabilityQualificationArtifact({
      artifact_id: 'cq-artifact-001',
      subject: {
        repository: 'JbmbAb/Milj-beslut-V1.2',
        candidate_sha: '1123456789abcdef0123456789abcdef01234567',
        build_identity: 'build-001',
        controller_version: 'controller-v1',
      },
      target_level: 'GA-L4',
      predicates,
      policy,
      evaluator_hash: 'sha256:evaluator-v1',
    });

    expect(second.content_hash.value).not.toBe(first.content_hash.value);
  });

  it('forbids runtime authority and revocation blockers from contaminating structural qualification', () => {
    for (const blockerClass of ['AUTHORITY_BLOCKER', 'REVOCATION_BLOCKER'] as const) {
      expect(() =>
        create([
          ...predicates.slice(0, 3),
          {
            predicate_id: 'runtime_wiring_verified',
            result: 'FAIL',
            evidence_refs: [evidence('authority-proof')],
            blocker: { class: blockerClass, code: 'NOT_STRUCTURAL' },
          },
        ]),
      ).toThrow('CAPABILITY_QUALIFICATION_RUNTIME_AUTHORITY_BLOCKER_FORBIDDEN');
    }
  });

  it('forbids transient runtime failures from becoming frozen qualification truth', () => {
    expect(() =>
      create([
        ...predicates.slice(0, 3),
        {
          predicate_id: 'runtime_wiring_verified',
          result: 'FAIL',
          evidence_refs: [evidence('transient-proof')],
          blocker: { class: 'RUNTIME_TRANSIENT', code: 'NETWORK_TIMEOUT' },
        },
      ]),
    ).toThrow('CAPABILITY_QUALIFICATION_RUNTIME_TRANSIENT_FORBIDDEN');
  });

  it('rejects malformed predicate semantics and duplicate predicate ids', () => {
    expect(() =>
      create([
        ...predicates,
        {
          predicate_id: 'runtime_wiring_verified',
          result: 'PASS',
          evidence_refs: [],
        },
      ]),
    ).toThrow('CAPABILITY_QUALIFICATION_DUPLICATE_PREDICATE');

    expect(() =>
      create([
        {
          predicate_id: 'implementation_verified',
          result: 'FAIL',
          evidence_refs: [],
        },
      ]),
    ).toThrow('CAPABILITY_QUALIFICATION_FAIL_WITHOUT_BLOCKER');
  });

  it('replays only with the same policy and untampered canonical content', () => {
    const artifact = create();
    expect(replayCapabilityQualification({ artifact, policy })).toBe(true);

    const wrongPolicy = { ...policy, policy_hash: 'sha256:different-policy' };
    expect(replayCapabilityQualification({ artifact, policy: wrongPolicy })).toBe(false);

    const tampered = {
      ...artifact,
      payload: {
        ...artifact.payload,
        qualified_level: 'GA-L4' as const,
        delta_qualification: 0,
      },
    };
    expect(replayCapabilityQualification({ artifact: tampered, policy })).toBe(false);
  });

  it('fails replay when evidence references are altered without recomputing the content hash', () => {
    const artifact = create();
    const tampered = {
      ...artifact,
      references: [{ artifact_id: 'different-proof', artifact_type: 'proof' }],
    };

    expect(replayCapabilityQualification({ artifact: tampered, policy })).toBe(false);
  });
});
