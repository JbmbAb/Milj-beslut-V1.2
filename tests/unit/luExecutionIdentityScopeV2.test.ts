import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider, createArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import { deriveLuExecutionSeed } from '@miljobeslut/mps-lu';
import {
  issueExecutionIdentity,
  issueExecutionIdentityV2,
} from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import {
  verifyExecutionIdentityAttestation,
  executionIdentityCanonicalBody,
  buildExecutionIdentityAttestationPredicate,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from '../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';
import {
  computeExecutionIdentityArtifactIdV1,
  computeExecutionIdentityArtifactIdV2,
  LU_EXECUTION_IDENTITY_SCOPE_V1,
  LU_EXECUTION_IDENTITY_SCOPE_V2,
  type ExecutionIdentitySubjectV2,
} from '../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import type { ExecutionIdentityArtifact } from '../../packages/mps-runtime/src/execution/ExecutionIdentityArtifact';
import {
  __resetLuExecutionAuthoritySigningProviderForTests,
} from '../../server/security/luExecutionAuthoritySigningKey';
import {
  __resetLuExecutionAuthorityVerifierForTests,
} from '../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';

const KEY_ID = 'ed25519:lu-execution-authority-test-v2';
const key = LocalPemSigningKeyProvider.generate(KEY_ID);
const otherKey = LocalPemSigningKeyProvider.generate('ed25519:other-authority');

const actorRef = { artifact_id: 'lu.site_assessment.actor', artifact_type: 'execution_identity' } as const;
const capabilityRef = { artifact_id: 'lu-site-assessment-capability', artifact_type: 'CAPABILITY_DEFINITION' } as const;

const bindingA = { artifact_id: 'project-context-binding-AAA', artifact_type: 'project_context_binding' } as const;
const bindingB = { artifact_id: 'project-context-binding-BBB', artifact_type: 'project_context_binding' } as const;
const releaseA = { artifact_id: 'product-release-AAA', artifact_type: 'product_release' } as const;
const releaseB = { artifact_id: 'product-release-BBB', artifact_type: 'product_release' } as const;

function subject(overrides: Partial<ExecutionIdentitySubjectV2> = {}): ExecutionIdentitySubjectV2 {
  return {
    site_id: 'site:test:orsa-stackmora-3-12',
    project_context_binding_ref: bindingA,
    product_release_ref: releaseA,
    execution_contract_version: 'lu-execution-identity-v1',
    ...overrides,
  };
}

beforeEach(() => {
  __resetLuExecutionAuthoritySigningProviderForTests(key.provider);
  __resetLuExecutionAuthorityVerifierForTests(new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey));
});

afterEach(() => {
  __resetLuExecutionAuthoritySigningProviderForTests(null);
  __resetLuExecutionAuthorityVerifierForTests(null);
});

describe('LU-EXECUTION-IDENTITY-SCOPE-V2', () => {
  describe('positive', () => {
    it('same V2 canonical subject -> same artifact_id', () => {
      const a = computeExecutionIdentityArtifactIdV2(subject());
      const b = computeExecutionIdentityArtifactIdV2(subject());
      expect(a).toBe(b);
      expect(a).toMatch(/^lu-identity-v2-[0-9a-f]{64}$/);
    });

    it('same site + corrected binding -> different artifact_id', () => {
      const a = computeExecutionIdentityArtifactIdV2(subject({ project_context_binding_ref: bindingA }));
      const b = computeExecutionIdentityArtifactIdV2(subject({ project_context_binding_ref: bindingB }));
      expect(a).not.toBe(b);
    });

    it('same site + different release -> different artifact_id', () => {
      const a = computeExecutionIdentityArtifactIdV2(subject({ product_release_ref: releaseA }));
      const b = computeExecutionIdentityArtifactIdV2(subject({ product_release_ref: releaseB }));
      expect(a).not.toBe(b);
    });

    it('same canonical execution tuple -> same deterministic_seed', () => {
      const tuple = {
        site_id: 'site:test:orsa-stackmora-3-12',
        project_id: 'proj-1',
        project_context_ref: { artifact_id: 'lu_project_context-x', artifact_type: 'LU_PROJECT_CONTEXT' },
        property_context_ref: { artifact_id: 'lu_property_context-x', artifact_type: 'LU_PROPERTY_CONTEXT' },
        project_context_binding_ref: bindingA,
        product_release_ref: releaseA,
        product_release_hash: 'hash-x',
        execution_contract_version: 'lu-execution-identity-v1',
        rule_registry_snapshot_id: 'snapshot-x',
      };
      expect(deriveLuExecutionSeed(tuple)).toBe(deriveLuExecutionSeed({ ...tuple }));
    });

    it('existing V1 identity -> still verifies', async () => {
      const repo = new InMemoryArtifactRepository();
      const siteId = 'site:test:v1-legacy';
      const seed = 'seed-v1';
      const identity = await issueExecutionIdentity({
        site_id: siteId,
        deterministic_seed: seed,
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-v1',
        artifact_repository: repo,
      });
      expect(identity.artifact_id).toBe(computeExecutionIdentityArtifactIdV1(siteId));
      expect(identity.execution_identity_contract_version).toBeUndefined();

      const attestation = await repo.resolve(identity.signature_envelope_ref);
      const result = await verifyExecutionIdentityAttestation({
        identity,
        attestation: attestation as any,
        expectedPredicate: buildExecutionIdentityAttestationPredicate({
          execution_identity_id: identity.artifact_id,
          actor_ref: actorRef,
          capability_ref: capabilityRef,
          release_snapshot_id: 'snapshot-v1',
          site_id: siteId,
          deterministic_seed: seed,
        }),
        authorityVerifier: new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey),
      });
      expect(result.verified).toBe(true);
    });

    it('explicit historical replay using V1 ref -> still resolves', async () => {
      const repo = new InMemoryArtifactRepository();
      const siteId = 'site:test:v1-replay';
      const identity = await issueExecutionIdentity({
        site_id: siteId,
        deterministic_seed: 'seed-replay',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-replay',
        artifact_repository: repo,
      });
      const resolved = await repo.resolve<ExecutionIdentityArtifact>({
        artifact_id: computeExecutionIdentityArtifactIdV1(siteId),
        artifact_type: 'execution_identity',
      });
      expect(resolved.artifact_id).toBe(identity.artifact_id);
    });

    it('new current issuance -> V2 only', async () => {
      const repo = new InMemoryArtifactRepository();
      const s = subject();
      const identity = await issueExecutionIdentityV2({
        subject: s,
        deterministic_seed: 'seed-v2',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-v2',
        artifact_repository: repo,
      });
      expect(identity.artifact_id).toBe(computeExecutionIdentityArtifactIdV2(s));
      expect(identity.execution_identity_contract_version).toBe(LU_EXECUTION_IDENTITY_SCOPE_V2);
      expect(identity.subject_v2).toEqual(s);
    });

    it('V2 fresh reopen public-key-only -> PASS', async () => {
      const repo = new InMemoryArtifactRepository();
      const s = subject();
      const identity = await issueExecutionIdentityV2({
        subject: s,
        deterministic_seed: 'seed-reopen',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-reopen',
        artifact_repository: repo,
      });
      const attestation = await repo.resolve(identity.signature_envelope_ref);
      // Public-key-only verifier: constructed directly from the public PEM, no private key ever
      // touched in this scope.
      const publicOnlyVerifier = new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey);
      const result = await verifyExecutionIdentityAttestation({
        identity,
        attestation: attestation as any,
        expectedPredicate: buildExecutionIdentityAttestationPredicate({
          execution_identity_id: identity.artifact_id,
          actor_ref: actorRef,
          capability_ref: capabilityRef,
          release_snapshot_id: 'snapshot-reopen',
          site_id: s.site_id,
          deterministic_seed: 'seed-reopen',
        }),
        authorityVerifier: publicOnlyVerifier,
        expectedSubjectV2: s,
      });
      expect(result.verified).toBe(true);
    });

    it('re-issuing V2 for the identical subject is idempotent, not a WORM violation', async () => {
      const repo = new InMemoryArtifactRepository();
      const s = subject();
      const first = await issueExecutionIdentityV2({
        subject: s,
        deterministic_seed: 'seed-idempotent',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-idempotent',
        artifact_repository: repo,
      });
      await expect(
        issueExecutionIdentityV2({
          subject: s,
          deterministic_seed: 'seed-idempotent',
          actor_ref: actorRef,
          capability_ref: capabilityRef,
          release_snapshot_id: 'snapshot-idempotent',
          artifact_repository: repo,
        }),
      ).resolves.toMatchObject({ artifact_id: first.artifact_id });
    });
  });

  describe('negative -- fail closed', () => {
    async function verify(identity: ExecutionIdentityArtifact, opts: {
      predicateSiteId?: string;
      predicateSeed?: string;
      expectedSubjectV2?: ExecutionIdentitySubjectV2;
      verifier?: LocalPemVerificationKeyProvider;
      signedSeed: string;
      signedSiteId: string;
    }) {
      const predicate = buildExecutionIdentityAttestationPredicate({
        execution_identity_id: identity.artifact_id,
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-neg',
        site_id: opts.signedSiteId,
        deterministic_seed: opts.signedSeed,
      });
      const attestation = await createArtifactAttestation({
        subjectDigest: identity.content_hash.value,
        predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
        predicate: { ...predicate },
        signing: key.provider,
      });
      return verifyExecutionIdentityAttestation({
        identity,
        attestation,
        expectedPredicate: buildExecutionIdentityAttestationPredicate({
          execution_identity_id: identity.artifact_id,
          actor_ref: actorRef,
          capability_ref: capabilityRef,
          release_snapshot_id: 'snapshot-neg',
          site_id: opts.predicateSiteId ?? opts.signedSiteId,
          deterministic_seed: opts.predicateSeed ?? opts.signedSeed,
        }),
        authorityVerifier: opts.verifier ?? new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey),
        expectedSubjectV2: opts.expectedSubjectV2,
      });
    }

    function selfConsistentIdentity(overrides: Partial<ExecutionIdentityArtifact>): ExecutionIdentityArtifact {
      const base: Omit<ExecutionIdentityArtifact, 'content_hash'> = {
        artifact_id: computeExecutionIdentityArtifactIdV2(subject()),
        artifact_type: 'execution_identity',
        references: [],
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        signature_envelope_ref: { artifact_id: 'lu-identity-attestation-x', artifact_type: 'outcome_attestation' },
        execution_identity_contract_version: LU_EXECUTION_IDENTITY_SCOPE_V2,
        subject_v2: subject(),
        ...overrides,
      };
      return { ...base, content_hash: sha256ContentHash(executionIdentityCanonicalBody(base as ExecutionIdentityArtifact)) };
    }

    it('V2 payload with V1 site-only artifact_id -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({ artifact_id: computeExecutionIdentityArtifactIdV1(subject().site_id) });
      const result = await verify(identity, { signedSiteId: subject().site_id, signedSeed: 'seed' });
      expect(result).toMatchObject({ verified: false, reason: 'ARTIFACT_ID_MISMATCH' });
    });

    it('caller-selected artifact_id -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({ artifact_id: 'lu-identity-v2-caller-chosen' });
      const result = await verify(identity, { signedSiteId: subject().site_id, signedSeed: 'seed' });
      expect(result).toMatchObject({ verified: false, reason: 'ARTIFACT_ID_MISMATCH' });
    });

    it('wrong project_context_binding_ref -> FAIL CLOSED', async () => {
      const s = subject({ project_context_binding_ref: bindingA });
      const identity = selfConsistentIdentity({ artifact_id: computeExecutionIdentityArtifactIdV2(s), subject_v2: s });
      const result = await verify(identity, {
        signedSiteId: s.site_id,
        signedSeed: 'seed',
        expectedSubjectV2: subject({ project_context_binding_ref: bindingB }),
      });
      expect(result).toMatchObject({ verified: false, reason: 'SUBJECT_MISMATCH' });
    });

    it('wrong product_release_ref -> FAIL CLOSED', async () => {
      const s = subject({ product_release_ref: releaseA });
      const identity = selfConsistentIdentity({ artifact_id: computeExecutionIdentityArtifactIdV2(s), subject_v2: s });
      const result = await verify(identity, {
        signedSiteId: s.site_id,
        signedSeed: 'seed',
        expectedSubjectV2: subject({ product_release_ref: releaseB }),
      });
      expect(result).toMatchObject({ verified: false, reason: 'SUBJECT_MISMATCH' });
    });

    it('correct signature + stale content_hash -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({});
      const tampered: ExecutionIdentityArtifact = { ...identity, content_hash: { algorithm: 'sha256', value: '0'.repeat(64) } };
      const result = await verify(tampered, { signedSiteId: subject().site_id, signedSeed: 'seed' });
      expect(result).toMatchObject({ verified: false, reason: 'CONTENT_HASH_MISMATCH' });
    });

    it('correct hash + wrong deterministic_seed -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({});
      const result = await verify(identity, {
        signedSiteId: subject().site_id,
        signedSeed: 'seed-signed',
        predicateSeed: 'seed-different',
      });
      expect(result).toMatchObject({ verified: false, reason: 'PREDICATE_MISMATCH' });
    });

    it('V1 identity substituted for expected V2 current execution -> FAIL CLOSED', async () => {
      const repo = new InMemoryArtifactRepository();
      const siteId = subject().site_id;
      const identity = await issueExecutionIdentity({
        site_id: siteId,
        deterministic_seed: 'seed-v1-sub',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-v1-sub',
        artifact_repository: repo,
      });
      const attestation = await repo.resolve(identity.signature_envelope_ref);
      const result = await verifyExecutionIdentityAttestation({
        identity,
        attestation: attestation as any,
        expectedPredicate: buildExecutionIdentityAttestationPredicate({
          execution_identity_id: identity.artifact_id,
          actor_ref: actorRef,
          capability_ref: capabilityRef,
          release_snapshot_id: 'snapshot-v1-sub',
          site_id: siteId,
          deterministic_seed: 'seed-v1-sub',
        }),
        authorityVerifier: new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey),
        expectedSubjectV2: subject({ site_id: siteId }),
      });
      expect(result).toMatchObject({ verified: false, reason: 'LEGACY_IDENTITY_NOT_ALLOWED' });
    });

    it('tampered contract version -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({ execution_identity_contract_version: 'lu-execution-identity-scope-v99' as any });
      const result = await verify(identity, { signedSiteId: subject().site_id, signedSeed: 'seed' });
      expect(result).toMatchObject({ verified: false, reason: 'UNKNOWN_CONTRACT_VERSION' });
    });

    it('unknown/wrong-scope issuer -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({});
      const wrongVerifier = new LocalPemVerificationKeyProvider(otherKey.provider.keyId, otherKey.publicKey);
      const result = await verify(identity, { signedSiteId: subject().site_id, signedSeed: 'seed', verifier: wrongVerifier });
      expect(result).toMatchObject({ verified: false, reason: 'UNKNOWN_SIGNING_KEY' });
    });

    it('V2 declared with no subject_v2 (missing V2 binding) -> FAIL CLOSED', async () => {
      const identity = selfConsistentIdentity({ subject_v2: undefined });
      const result = await verify(identity, { signedSiteId: subject().site_id, signedSeed: 'seed' });
      expect(result).toMatchObject({ verified: false, reason: 'SUBJECT_MISMATCH' });
    });

    it('tampered subject_v2 (project_context_binding_ref altered after signing) -> FAIL CLOSED', async () => {
      // Simulates an attacker (or a bug) rewriting the subject in-place without a valid
      // re-signature: content_hash was computed over the ORIGINAL subject, so this identity is no
      // longer self-consistent with its own declared content_hash.
      const original = selfConsistentIdentity({});
      const tampered: ExecutionIdentityArtifact = {
        ...original,
        subject_v2: subject({ project_context_binding_ref: bindingB }),
      };
      const result = await verify(tampered, { signedSiteId: subject().site_id, signedSeed: 'seed' });
      expect(result).toMatchObject({ verified: false, reason: 'CONTENT_HASH_MISMATCH' });
    });

    it('same correct identity replayed for the exact intended subject -> deterministic accept', async () => {
      const repo = new InMemoryArtifactRepository();
      const s = subject();
      const issued = await issueExecutionIdentityV2({
        subject: s,
        deterministic_seed: 'seed-replay-v2',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-replay-v2',
        artifact_repository: repo,
      });
      const attestation = await repo.resolve(issued.signature_envelope_ref);
      const expectedPredicate = buildExecutionIdentityAttestationPredicate({
        execution_identity_id: issued.artifact_id,
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'snapshot-replay-v2',
        site_id: s.site_id,
        deterministic_seed: 'seed-replay-v2',
      });
      const first = await verifyExecutionIdentityAttestation({
        identity: issued,
        attestation: attestation as any,
        expectedPredicate,
        authorityVerifier: new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey),
        expectedSubjectV2: s,
      });
      const second = await verifyExecutionIdentityAttestation({
        identity: issued,
        attestation: attestation as any,
        expectedPredicate,
        authorityVerifier: new LocalPemVerificationKeyProvider(KEY_ID, key.publicKey),
        expectedSubjectV2: s,
      });
      expect(first).toEqual(second);
      expect(first).toMatchObject({ verified: true });
    });
  });
});
