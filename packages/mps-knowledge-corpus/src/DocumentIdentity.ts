import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import type { SourceArtifactRef } from '@miljobeslut/mps-text-projection';

import { KNOWLEDGE_DOCUMENT_IDENTITY_VERSION } from './versions';

/**
 * KNOWLEDGE-DOCUMENT-V1 — content-derived identity for one governed document.
 *
 * Reuses the repo's ONE identity kernel (version-prefixed sha256 over `canonicalizeStrict`, exactly
 * as LegalCorpusMaterializationIdentity, CanonicalDecisionImpactHash and DocumentFact do) with a
 * new payload; it does not introduce a second hashing/canonicalization model.
 *
 * What is bound:
 *   - logical_source_id            the stable source
 *   - registry_source_content_hash the signed scope of that source (stable across re-attestation)
 *   - raw_source_content_hash      sha256 of the exact acquired bytes
 *
 * What is deliberately NOT bound, and why:
 *   - registry_artifact_id  volatile label (re-issued on re-attestation); binding it would fork every
 *                           document identity on the next re-attestation (K2.1b lesson). NOTE: the
 *                           K2.1b MATERIALIZATION identity (legal-corpus-record-v2) does bind it, so a
 *                           relabel keeps this document_id but re-keys every canonical_record_key —
 *                           an inherited kernel property K2.2 reports (plan.relabeled), not alters.
 *   - quarantine_id / path  a per-acquisition storage uuid / local path. The legal-corpus scripts put
 *                           `projection-<quarantine_id>` into materialization identity, so re-acquiring
 *                           identical bytes produced a different identity. Same bytes must be the
 *                           same document wherever they happen to be stored.
 *   - timestamps, ordering, database ids, machine — none of them are content.
 *
 * Consequence: byte-identical acquisitions collapse to one document; a NEW VERSION of a source
 * (different bytes) is a distinct document; the same filename with different bytes is distinct.
 * The projection/chunk-policy dimensions live one level down, in the existing materialization
 * identity (legal-corpus-record-v2), which this id is a parent of, never a replacement for.
 */
export interface KnowledgeDocumentIdentityInput {
  readonly logical_source_id: string;
  readonly registry_source_content_hash: string;
  readonly raw_source_content_hash: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function buildKnowledgeDocumentIdentityPayload(
  input: KnowledgeDocumentIdentityInput,
): Record<string, string> {
  return {
    logical_source_id: input.logical_source_id,
    registry_source_content_hash: input.registry_source_content_hash,
    raw_source_content_hash: input.raw_source_content_hash,
  };
}

export function computeKnowledgeDocumentId(input: KnowledgeDocumentIdentityInput): string {
  if (!input.logical_source_id) throw new Error('REJECT_DOCUMENT_IDENTITY: logical_source_id is required');
  if (!SHA256_HEX.test(input.registry_source_content_hash)) {
    throw new Error('REJECT_DOCUMENT_IDENTITY: registry_source_content_hash must be 64 lowercase hex chars');
  }
  if (!SHA256_HEX.test(input.raw_source_content_hash)) {
    throw new Error('REJECT_DOCUMENT_IDENTITY: raw_source_content_hash must be 64 lowercase hex chars');
  }
  const digest = createHash('sha256')
    .update(
      `${KNOWLEDGE_DOCUMENT_IDENTITY_VERSION}\n${canonicalizeStrict(buildKnowledgeDocumentIdentityPayload(input))}`,
      'utf8',
    )
    .digest('hex');
  return `kdoc:${digest}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The SourceArtifactRef handed to TEXT-L1. `artifact_id` is the raw content hash, so the
 * projection id the builder derives (`tp:<artifact_id>:<text-hash16>`) is content-derived on both
 * sides and identical wherever the bytes were read from.
 */
export function buildRawSourceArtifactRef(rawSourceContentHash: string): SourceArtifactRef {
  if (!SHA256_HEX.test(rawSourceContentHash)) {
    throw new Error('REJECT_DOCUMENT_IDENTITY: raw_source_content_hash must be 64 lowercase hex chars');
  }
  return Object.freeze({ artifact_id: `raw:${rawSourceContentHash}`, artifact_type: 'raw_source' });
}
