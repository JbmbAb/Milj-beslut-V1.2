import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';

/**
 * Versioned identity contract for governed, non-legacy legal corpus records.
 *
 * LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2 (bumped from v1): `chunk_policy_version` is now bound
 * into identity. Root cause this closes, found via the real F2 replay/rechunk proof, not
 * speculated: a materialization identity that did not depend on chunk policy meant re-chunking
 * the SAME raw source + projection under a DIFFERENT chunk policy collided onto the SAME
 * materialization row -- the new chunk set landed inside the old materialization instead of a
 * distinct new one, which is exactly the destructive-rechunk risk GOVERNED-LEGAL-CHUNK-SCHEMA-V1
 * was built to avoid. A different chunk policy produces a different canonical chunk set (per
 * ChunkIdentity v2's own chunk_set_content_hash, which already treats chunk_policy_version as
 * identity-bearing) -- the materialization that OWNS that chunk set must therefore also be a
 * different identity, or the chunk table's per-materialization uniqueness stops meaning anything.
 */
export const LEGAL_CORPUS_RECORD_IDENTITY_VERSION = 'legal-corpus-record-v2' as const;

export interface LegalCorpusMaterializationIdentityInput {
  readonly logical_source_id: string;
  readonly registry_artifact_id: string;
  readonly registry_source_content_hash: string;
  readonly raw_source_content_hash: string;
  readonly text_projection_artifact_id: string;
  readonly text_projection_hash: string;
  readonly text_projection_version: string;
  readonly corpus_materialization_version: string;
  readonly chunk_policy_version: string;
}

/**
 * LEGAL_CORPUS_RECORD_IDENTITY_V2.
 *
 * Logical source names describe a law; they do not identify a particular acquired byte stream,
 * projection, chunk policy, or materialization. This payload binds all four without ever reusing
 * a legacy `foundation:*` record key.
 */
export function buildLegalCorpusMaterializationIdentityPayload(
  input: LegalCorpusMaterializationIdentityInput,
): Record<string, string> {
  return {
    logical_source_id: input.logical_source_id,
    registry_artifact_id: input.registry_artifact_id,
    registry_source_content_hash: input.registry_source_content_hash,
    raw_source_content_hash: input.raw_source_content_hash,
    text_projection_artifact_id: input.text_projection_artifact_id,
    text_projection_hash: input.text_projection_hash,
    text_projection_version: input.text_projection_version,
    corpus_materialization_version: input.corpus_materialization_version,
    chunk_policy_version: input.chunk_policy_version,
  };
}

export function computeLegalCorpusMaterializationHash(
  input: LegalCorpusMaterializationIdentityInput,
): string {
  return createHash('sha256')
    .update(
      `${LEGAL_CORPUS_RECORD_IDENTITY_VERSION}\n${canonicalizeStrict(
        buildLegalCorpusMaterializationIdentityPayload(input),
      )}`,
      'utf8',
    )
    .digest('hex');
}

/** The canonical corpus key is opaque/content-bound; a `foundation:*` key can never be emitted. */
export function buildCanonicalLegalCorpusRecordKey(
  input: LegalCorpusMaterializationIdentityInput,
): string {
  return `canonical:legal-corpus:${computeLegalCorpusMaterializationHash(input)}`;
}
