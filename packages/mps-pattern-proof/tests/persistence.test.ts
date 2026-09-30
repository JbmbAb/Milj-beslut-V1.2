import { CasBackedArtifactRepository, MemoryByteStorageBackend } from '@miljobeslut/mps-runtime';
import { describe, expect, it } from 'vitest';
import { isPatternProofError } from '../src/errors';
import { artifactIdFor, artifactTypeFor, digestOf, PATTERN_PROOF_ARTIFACT_KINDS } from '../src/identity';
import {
  kindFromArtifactType,
  PatternProofArtifactStore,
  persistedRefFromArtifactId,
} from '../src/persistence';
import { validateArtifact } from '../src/validators';
import { FIXTURE_BUILDERS, validCandidate } from './fixtures/artifacts';

/**
 * Tests never touch the port directly (plan D5): every write goes through PatternProofArtifactStore,
 * which is the package's only `.put(` caller. The repository is the real CasBackedArtifactRepository
 * over the real MemoryByteStorageBackend (WORM on differing bytes), not a mock.
 */
function newStore(): PatternProofArtifactStore {
  return new PatternProofArtifactStore({
    repository: new CasBackedArtifactRepository(new MemoryByteStorageBackend()),
  });
}

describe('PatternProofArtifactStore: round trip for every artifact kind', () => {
  for (const kind of PATTERN_PROOF_ARTIFACT_KINDS) {
    it(`${kind}: persistArtifact -> loadArtifact returns the validated frozen artifact`, async () => {
      const store = newStore();
      const artifact = FIXTURE_BUILDERS[kind]();
      const ref = await store.persistArtifact(kind, artifact);

      const expectedDigest = digestOf(validateArtifact(kind, artifact));
      expect(ref.kind).toBe(kind);
      expect(ref.digest).toBe(expectedDigest);
      expect(ref.artifactId).toBe(artifactIdFor(kind, expectedDigest));
      expect(ref.artifactType).toBe(artifactTypeFor(kind));
      expect(ref.contentHash).toEqual({ algorithm: 'sha256', value: expectedDigest.slice('sha256:'.length) });
      expect(ref.locator).toEqual({ kind: 'cas_artifact', ref: ref.artifactId });
      expect(Object.isFrozen(ref)).toBe(true);

      const loaded = await store.loadArtifact(ref);
      expect(loaded).toEqual(artifact);
      expect(Object.isFrozen(loaded)).toBe(true);
      expect(digestOf(loaded)).toBe(ref.digest);
      expect(await store.exists(ref)).toBe(true);
    });
  }

  it('persistArtifact validates first: an invalid artifact is never written', async () => {
    const store = newStore();
    await expect(
      store.persistArtifact('candidate', { ...validCandidate(), candidateSha: 'HEAD' }),
    ).rejects.toThrow(/PPE_CANDIDATE_SHA_INVALID/);
  });

  it('the same artifact persisted twice is idempotent (same id, same bytes, no WORM violation)', async () => {
    const store = newStore();
    const first = await store.persistArtifact('candidate', validCandidate());
    const second = await store.persistArtifact('candidate', validCandidate());
    expect(second.artifactId).toBe(first.artifactId);
    expect(second.contentHash).toEqual(first.contentHash);
    await expect(
      store.persistUnderId(
        first.artifactId,
        first.artifactType,
        validateArtifact('candidate', validCandidate()),
      ),
    ).resolves.toEqual(first);
  });

  it('different artifacts get different content-addressed ids', async () => {
    const store = newStore();
    const a = await store.persistArtifact('candidate', validCandidate());
    const modified = validCandidate();
    const b = await store.persistArtifact('candidate', {
      ...modified,
      allowedPathsCompliance: {
        ...modified.allowedPathsCompliance,
        allowedPaths: ['Dockerfile', 'Dockerfile.gcp'],
      },
    });
    expect(b.artifactId).not.toBe(a.artifactId);
    expect(await store.loadArtifact(a)).toEqual(validCandidate());
  });
});

describe('PatternProofArtifactStore: fail-closed paths', () => {
  it('a tampered reference (wrong contentHash) fails closed with PPE_CONTENT_HASH_MISMATCH', async () => {
    const store = newStore();
    const ref = await store.persistArtifact('discovery', FIXTURE_BUILDERS.discovery());
    const tampered = {
      ...ref,
      contentHash: { algorithm: 'sha256' as const, value: 'f'.repeat(64) },
      digest: `sha256:${'f'.repeat(64)}` as const,
    };
    let caught: unknown;
    try {
      await store.loadArtifact(tampered);
    } catch (error) {
      caught = error;
    }
    expect(isPatternProofError(caught, 'PPE_CONTENT_HASH_MISMATCH')).toBe(true);
    // presence is still answered (exists does not verify content, documented)
    expect(await store.exists(tampered)).toBe(true);
  });

  it('WORM: re-putting DIFFERENT bytes under the same (original) id throws the backend violation', async () => {
    const store = newStore();
    const frozen = await store.persistArtifact('candidate', validCandidate());
    const edited = validCandidate();
    const editedInPlace = {
      ...edited,
      allowedPathsCompliance: { ...edited.allowedPathsCompliance, result: 'FAIL' as const },
    };
    await expect(store.persistUnderId(frozen.artifactId, frozen.artifactType, editedInPlace)).rejects.toThrow(
      /WORM violation/,
    );
    // the original is untouched
    expect(await store.loadArtifact(frozen)).toEqual(validCandidate());
  });

  it('persistUnderId refuses artifact types this package does not own', async () => {
    const store = newStore();
    await expect(store.persistUnderId('x', 'WORKFLOW_EXECUTION', {})).rejects.toThrow(/PPE_SCHEMA_INVALID/);
    await expect(store.persistUnderId('', 'PPE_CANDIDATE', {})).rejects.toThrow(/PPE_SCHEMA_INVALID/);
  });

  it('persistUnderId refuses bodies that cannot be canonicalized (undefined values)', async () => {
    const store = newStore();
    await expect(store.persistUnderId('ppe:candidate:x', 'PPE_CANDIDATE', { a: undefined })).rejects.toThrow(
      /PPE_DIGEST_INPUT_INVALID/,
    );
  });

  it('loading an unknown reference fails with PPE_ARTIFACT_NOT_FOUND and exists() answers false', async () => {
    const store = newStore();
    const ref = persistedRefFromArtifactId(`ppe:red-plan:${'0'.repeat(64)}`);
    let caught: unknown;
    try {
      await store.loadArtifact(ref);
    } catch (error) {
      caught = error;
    }
    expect(isPatternProofError(caught, 'PPE_ARTIFACT_NOT_FOUND')).toBe(true);
    expect(await store.exists(ref)).toBe(false);
  });

  it('a stored body that no longer validates is rejected on load', async () => {
    const store = newStore();
    const ref = await store.persistUnderId(`ppe:decision-gate:${'1'.repeat(64)}`, 'PPE_DECISION_GATE', {
      items: [{ item: 'x', classification: 'MECHANICAL' }],
    });
    await expect(store.loadArtifact(ref)).rejects.toThrow(/PPE_DECISION_ITEM_INCOMPLETE/);
  });
});

describe('identity helpers', () => {
  it('persistedRefFromArtifactId rebuilds the full reference from the content-addressed id', async () => {
    const store = newStore();
    const ref = await store.persistArtifact('red-plan', FIXTURE_BUILDERS['red-plan']());
    expect(persistedRefFromArtifactId(ref.artifactId)).toEqual(ref);
    expect(() => persistedRefFromArtifactId('ppe:workflow:abc')).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() => persistedRefFromArtifactId('replay-m1-attempt-m1-1')).toThrow(/PPE_SCHEMA_INVALID/);
  });

  it('kindFromArtifactType is the inverse of artifactTypeFor', () => {
    for (const kind of PATTERN_PROOF_ARTIFACT_KINDS)
      expect(kindFromArtifactType(artifactTypeFor(kind))).toBe(kind);
    expect(kindFromArtifactType('REPLAY')).toBeUndefined();
  });
});
