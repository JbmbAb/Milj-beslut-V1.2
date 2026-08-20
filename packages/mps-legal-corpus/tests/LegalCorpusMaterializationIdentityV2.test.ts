import { describe, expect, it } from 'vitest';
import {
  buildCanonicalLegalCorpusRecordKey,
  computeLegalCorpusMaterializationHash,
  type LegalCorpusMaterializationIdentityInput,
} from '../src/index';

/**
 * LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2.
 *
 * Root cause (found via the real F2 replay/rechunk proof against the live database, not
 * speculated): materialization identity did not depend on chunk_policy_version, so re-chunking
 * the same raw source + projection under a different policy collided onto the SAME
 * materialization row instead of producing a distinct new one -- the opposite of what
 * GOVERNED-LEGAL-CHUNK-SCHEMA-V1's per-materialization chunk uniqueness assumes.
 */
function baseIdentity(overrides: Partial<LegalCorpusMaterializationIdentityInput> = {}): LegalCorpusMaterializationIdentityInput {
  return {
    logical_source_id: 'regeringskansliet-sfs-1998-808',
    registry_artifact_id: 'reg-rk-sfs-1998-808-001',
    registry_source_content_hash: 'a'.repeat(64),
    raw_source_content_hash: 'b'.repeat(64),
    text_projection_artifact_id: 'projection-1',
    text_projection_hash: 'c'.repeat(64),
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: 'legal-chunker-v2.3',
    ...overrides,
  };
}

describe('LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2', () => {
  it('A: identical inputs including chunk_policy_version -> identical materialization identity', () => {
    const first = baseIdentity();
    const second = baseIdentity();

    expect(computeLegalCorpusMaterializationHash(first)).toBe(computeLegalCorpusMaterializationHash(second));
    expect(buildCanonicalLegalCorpusRecordKey(first)).toBe(buildCanonicalLegalCorpusRecordKey(second));
  });

  it('B: only chunk_policy_version changes -> different materialization identity', () => {
    const v1 = baseIdentity({ chunk_policy_version: 'legal-chunker-v2.3' });
    const v2 = baseIdentity({ chunk_policy_version: 'legal-chunker-v2.4-test' });

    expect(computeLegalCorpusMaterializationHash(v1)).not.toBe(computeLegalCorpusMaterializationHash(v2));
    expect(buildCanonicalLegalCorpusRecordKey(v1)).not.toBe(buildCanonicalLegalCorpusRecordKey(v2));
  });

  it('every other field held constant, changing any ONE still changes identity (no field is silently ignored)', () => {
    const reference = baseIdentity();
    const variants: Partial<LegalCorpusMaterializationIdentityInput>[] = [
      { logical_source_id: 'other-source' },
      { registry_artifact_id: 'other-artifact' },
      { registry_source_content_hash: 'd'.repeat(64) },
      { raw_source_content_hash: 'e'.repeat(64) },
      { text_projection_artifact_id: 'other-projection' },
      { text_projection_hash: 'f'.repeat(64) },
      { text_projection_version: 'other-version' },
      { corpus_materialization_version: 'other-materialization-version' },
      { chunk_policy_version: 'other-policy' },
    ];

    const referenceHash = computeLegalCorpusMaterializationHash(reference);
    for (const variant of variants) {
      const changed = baseIdentity(variant);
      expect(computeLegalCorpusMaterializationHash(changed)).not.toBe(referenceHash);
    }
  });
});
