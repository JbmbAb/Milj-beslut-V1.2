import { describe, expect, it } from 'vitest';
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from '../../packages/mimers-brunn-core/src';
import {
  createDocumentReviewAttestation,
  validateDocumentReviewAttestationReference,
} from '../../packages/mps-data-governance/src/DocumentReviewAttestation';

/**
 * RED: the pre-contract prototype returns an attestation beside a V1 fact, but the fact itself
 * cannot carry the immutable hashed reference required by the frozen V2 production contract.
 */
describe('DOCUMENT-REVIEW-ATTESTATION-BINDING-CONTRACT-01 RED', () => {
  it('requires a V2 fact contract with a mandatory review_attestation_ref', async () => {
    const facts = await import('../../packages/mps-data-governance/src/DocumentFactArtifact');
    expect('VerifiedDocumentFactArtifactV2' in facts).toBe(true);
  });

  it('validates a review attestation only after resolving the hashed reference', async () => {
    const key = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    const reviewer = {
      identity_ref: {
        id: 'reviewer-a',
        content_hash: { algorithm: 'sha256' as const, digest: 'a'.repeat(64) },
      },
      role: 'GOVERNANCE_REVIEWER' as const,
    };
    const created = await createDocumentReviewAttestation({
      artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION',
      action: 'document_fact.review',
      subject_content_hash: 'b'.repeat(64),
      preimage: { fact_artifact_id: 'fact-a' },
      reviewer,
      governance_release: 'governance-v1',
      signing: key.provider,
    });
    const verifier = new LocalPemVerificationKeyProvider(
      'ed25519:document-fact-review-v1',
      key.publicKey,
    );

    const resolver = {
      async resolve() {
        return created.artifact;
      },
    };

    await expect(
      validateDocumentReviewAttestationReference({
        resolver,
        ref: created.ref,
        expected_action: 'document_fact.review',
        expected_subject_digest: 'b'.repeat(64),
        expected_reviewer: reviewer,
        verification: verifier,
      }),
    ).resolves.toEqual(created.artifact);

    const tamperedResolver = {
      async resolve() {
        return {
          ...created.artifact,
          payload: { ...created.artifact.payload, reviewer_role: 'SYSTEM_PROCESS' },
        };
      },
    };

    await expect(
      validateDocumentReviewAttestationReference({
        resolver: tamperedResolver,
        ref: created.ref,
        expected_action: 'document_fact.review',
        expected_subject_digest: 'b'.repeat(64),
        expected_reviewer: reviewer,
        verification: verifier,
      }),
    ).rejects.toThrow(/content hash does not match attestation payload/);
  });

  it.each([
    ['missing attestation', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { throw new Error('Artifact not found'); } }, ref: created.ref, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: verifier }), /not found/i],
    ['wrong attestation type', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return { ...created.artifact, artifact_type: 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION' }; } }, ref: { ...created.ref, artifact_type: 'DOCUMENT_PROPERTY_REVIEW_ATTESTATION' }, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: verifier }), /artifact type/],
    ['wrong hash', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: { ...created.ref, content_hash: '0'.repeat(64) }, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: verifier }), /does not match reference/],
    ['wrong signer', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, _verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: created.ref, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: new LocalPemVerificationKeyProvider('ed25519:other', LocalPemSigningKeyProvider.generate('ed25519:other').publicKey) }), /signer/],
    ['wrong action', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: created.ref, expected_action: 'document_evidence.property_review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: verifier }), /action/],
    ['wrong reviewer', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, _reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: created.ref, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: { identity_ref: { id: 'other', content_hash: { algorithm: 'sha256' as const, digest: 'c'.repeat(64) } }, role: 'GOVERNANCE_REVIEWER' as const }, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: verifier }), /reviewer/],
    ['wrong governance release', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: created.ref, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v2', expected_preimage: { fact_artifact_id: 'fact-a' }, verification: verifier }), /governance release/],
    ['preimage mismatch', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: created.ref, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-b' }, verification: verifier }), /preimage/],
    ['wrong fact type/projection/span', async (created: Awaited<ReturnType<typeof createDocumentReviewAttestation>>, verifier: LocalPemVerificationKeyProvider, reviewer: { identity_ref: { id: string; content_hash: { algorithm: 'sha256'; digest: string } }; role: 'GOVERNANCE_REVIEWER' }) => validateDocumentReviewAttestationReference({ resolver: { async resolve() { return created.artifact; } }, ref: created.ref, expected_action: 'document_fact.review', expected_subject_digest: 'b'.repeat(64), expected_reviewer: reviewer, expected_governance_release: 'governance-v1', expected_preimage: { fact_artifact_id: 'fact-a', fact_type: 'OTHER_FACT', source_projection_ref: { id: 'wrong' }, source_span: { start_offset: 2, end_offset: 3 } }, verification: verifier }), /preimage/],
  ])('denies %s before accepting a hash-bound review reference', async (_, exercise, error) => {
    const key = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    const reviewer = {
      identity_ref: {
        id: 'reviewer-a',
        content_hash: { algorithm: 'sha256' as const, digest: 'a'.repeat(64) },
      },
      role: 'GOVERNANCE_REVIEWER' as const,
    };
    const created = await createDocumentReviewAttestation({
      artifact_type: 'DOCUMENT_FACT_REVIEW_ATTESTATION',
      action: 'document_fact.review',
      subject_content_hash: 'b'.repeat(64),
      preimage: { fact_artifact_id: 'fact-a' },
      reviewer,
      governance_release: 'governance-v1',
      signing: key.provider,
    });
    const verifier = new LocalPemVerificationKeyProvider('ed25519:document-fact-review-v1', key.publicKey);
    await expect(exercise(created, verifier, reviewer)).rejects.toThrow(error);
  });
});
