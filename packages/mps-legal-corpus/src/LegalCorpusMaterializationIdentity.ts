import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';

/** Versioned identity contract for governed, non-legacy legal corpus records. */
export const LEGAL_CORPUS_RECORD_IDENTITY_VERSION = 'legal-corpus-record-v1' as const;

export interface LegalCorpusMaterializationIdentityInput {
  readonly logical_source_id: string;
  readonly registry_artifact_id: string;
  readonly registry_source_content_hash: string;
  readonly raw_source_content_hash: string;
  readonly text_projection_artifact_id: string;
  readonly text_projection_hash: string;
  readonly text_projection_version: string;
  readonly corpus_materialization_version: string;
}

/**
 * LEGAL_CORPUS_RECORD_IDENTITY_V1.
 *
 * Logical source names describe a law; they do not identify a particular acquired byte stream,
 * projection, or materialization. This payload binds all three without ever reusing a legacy
 * `foundation:*` record key.
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
