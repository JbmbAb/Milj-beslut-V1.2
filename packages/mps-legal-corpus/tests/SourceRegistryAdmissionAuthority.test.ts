// packages/mps-legal-corpus/tests/SourceRegistryAdmissionAuthority.test.ts
//
// K2.1 — CORPUS-ADMISSION-REGISTRY-BINDING.
// Tests the admission DECISION logic in isolation. After K2.1b this module no longer loads or
// verifies a registry itself (that is the server-side SourceRegistryAdmissionAdapter's job, on
// the other side of the mps-legal-corpus / mps-data-governance boundary), so these tests inject
// VerifiedRegistrySnapshotProvider implementations directly.
//
// Note on fixture authenticity: the injected providers here are NOT "unconditionally admit"
// stubs — each one returns a specific snapshot set, or throws, and every deny path is asserted
// on its exact reason code. What is deliberately NOT covered here is the real signature/lifecycle
// verification, which now lives behind the adapter; see the K2.1b report for that boundary.

import { describe, expect, it } from 'vitest';
import {
  createRegistryAdmissionAuthority,
  type VerifiedRegistryEntrySnapshot,
  type VerifiedRegistrySnapshotProvider,
} from '../src/SourceRegistryAdmissionAuthority';

const APPROVED_ARTIFACT_ID = 'reg-test-source-001';
const APPROVED_CONTENT_HASH = 'a'.repeat(64);

function providerReturning(
  entries: readonly VerifiedRegistryEntrySnapshot[],
): VerifiedRegistrySnapshotProvider {
  return {
    async loadApprovedEntries() {
      return entries;
    },
  };
}

function providerThrowing(message: string): VerifiedRegistrySnapshotProvider {
  return {
    async loadApprovedEntries(): Promise<readonly VerifiedRegistryEntrySnapshot[]> {
      throw new Error(message);
    },
  };
}

const singleApproved = providerReturning([
  { registryArtifactId: APPROVED_ARTIFACT_ID, sourceContentHash: APPROVED_CONTENT_HASH },
]);

describe('createRegistryAdmissionAuthority', () => {
  it('admits a real, currently-APPROVED registry entry with a matching content hash', async () => {
    const authority = createRegistryAdmissionAuthority(singleApproved);
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('RED-A: denies a fabricated registry_artifact_id that never existed', async () => {
    const authority = createRegistryAdmissionAuthority(singleApproved);
    const result = await authority.checkAdmissible('reg-does-not-exist-999', APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ARTIFACT_NOT_FOUND');
  });

  it('RED-C: denies an artifact_id no longer present in the active registry (revoked/superseded)', async () => {
    // This repo's convention for revocation/supersession is removal from the active registry
    // file, not an in-file REJECTED/QUARANTINED marker. A once-real, now-removed artifact_id
    // must be denied identically to one that never existed.
    const authority = createRegistryAdmissionAuthority(singleApproved);
    const result = await authority.checkAdmissible('reg-test-source-000-superseded', APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ARTIFACT_NOT_FOUND');
  });

  it('RED-B: denies a wrong registry_source_content_hash for a real artifact_id', async () => {
    const authority = createRegistryAdmissionAuthority(singleApproved);
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, 'b'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('CONTENT_HASH_MISMATCH');
  });

  it('RED-D: denies when the registry authority cannot be loaded — fails closed, not open', async () => {
    const authority = createRegistryAdmissionAuthority(providerThrowing('registry file not found'));
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('REGISTRY_UNAVAILABLE');
  });

  it('RED-D: a provider throwing on signature/lifecycle verification denies as UNAVAILABLE, not NOT_FOUND', async () => {
    // The distinction matters: "I could not establish authority" must never be reported or
    // treated as "this artifact is absent", which is a weaker, differently-actionable claim.
    const authority = createRegistryAdmissionAuthority(
      providerThrowing("SourceRegistryArtifact 'x' failed approval binding checks: signature_valid"),
    );
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('REGISTRY_UNAVAILABLE');
  });

  it('H: denies when two APPROVED entries share the same registry_artifact_id, instead of silently picking the first', async () => {
    // The underlying registry loader guarantees unique source_id, NOT unique artifact_id — so
    // ambiguity is representable and must be refused rather than resolved by array position.
    const ambiguous = providerReturning([
      { registryArtifactId: APPROVED_ARTIFACT_ID, sourceContentHash: APPROVED_CONTENT_HASH },
      { registryArtifactId: APPROVED_ARTIFACT_ID, sourceContentHash: 'c'.repeat(64) },
    ]);
    const authority = createRegistryAdmissionAuthority(ambiguous);
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('AMBIGUOUS_ARTIFACT_ID');
  });

  it('H: ambiguity is refused even when the FIRST duplicate would have matched the claimed hash', async () => {
    // Guards against a "first match wins" regression that would look correct in the happy case.
    const ambiguous = providerReturning([
      { registryArtifactId: APPROVED_ARTIFACT_ID, sourceContentHash: APPROVED_CONTENT_HASH },
      { registryArtifactId: APPROVED_ARTIFACT_ID, sourceContentHash: APPROVED_CONTENT_HASH },
    ]);
    const authority = createRegistryAdmissionAuthority(ambiguous);
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('AMBIGUOUS_ARTIFACT_ID');
  });

  it('denies when registry_artifact_id / registry_source_content_hash are empty — no fallback', async () => {
    const authority = createRegistryAdmissionAuthority(singleApproved);
    expect((await authority.checkAdmissible('', '')).ok).toBe(false);
    expect((await authority.checkAdmissible(APPROVED_ARTIFACT_ID, '')).ok).toBe(false);
    expect((await authority.checkAdmissible('', APPROVED_CONTENT_HASH)).ok).toBe(false);
  });

  it('an empty registry admits nothing', async () => {
    const authority = createRegistryAdmissionAuthority(providerReturning([]));
    const result = await authority.checkAdmissible(APPROVED_ARTIFACT_ID, APPROVED_CONTENT_HASH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ARTIFACT_NOT_FOUND');
  });

  it('same inputs produce the same ruling deterministically', async () => {
    const authority = createRegistryAdmissionAuthority(singleApproved);
    const results = await Promise.all([
      authority.checkAdmissible('reg-nope', APPROVED_CONTENT_HASH),
      authority.checkAdmissible('reg-nope', APPROVED_CONTENT_HASH),
      authority.checkAdmissible('reg-nope', APPROVED_CONTENT_HASH),
    ]);
    expect(results.every((r) => r.ok === false && r.reason === 'ARTIFACT_NOT_FOUND')).toBe(true);
  });
});
