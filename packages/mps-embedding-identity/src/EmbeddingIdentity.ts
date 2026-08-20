/**
 * LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01.
 *
 * Binds a governed legal-corpus chunk (LegalCorpusMaterializedChunk: fragment_id,
 * materialization_id, content_hash -- see prisma/schema.prisma) to a specific embedding
 * model/pipeline, producing a deterministic embedding identity.
 *
 * Deliberately standalone: no dependency on mps-retrieval-governance, mps-retrieval-trace, or
 * mps-legal-corpus. Consumers (policy, trace, retrieval-result binding) depend on this contract;
 * this contract does not depend on them, and does not itself define retrieval policy, trace
 * shape, or persistence -- see LEGAL-RETRIEVAL-QUARANTINE-RECON-01's explicit finding that no
 * existing package has any embedding-identity concept, and this session's owner instruction that
 * the governance package "ska inte själv hitta på embedding identity."
 *
 * Invariant (governs the whole point of this module):
 *   same chunk + same model + same pipeline  -> same embedding_identity_hash
 *   same chunk + changed model/version/pipeline -> different embedding_identity_hash
 */

import { createHash } from "node:crypto";

export const EMBEDDING_IDENTITY_CONTRACT_VERSION = "embed-identity-1" as const;

/** The exact six fields this contract requires -- nothing less binds the identity. */
export interface EmbeddingIdentityInput {
  /** LegalCorpusMaterializedChunk.fragmentId -- content-derived, never freely chosen. */
  readonly fragment_id: string;
  /** LegalCorpusMaterializedChunk.materializationId -- ties the chunk to its exact governed
   *  materialization (chunk_policy_version is identity-bearing there; v2.3/v2.4/v2.4.1 fragments
   *  of "the same" underlying text are DIFFERENT fragment_ids and therefore never collide here). */
  readonly materialization_id: string;
  /** LegalCorpusMaterializedChunk.contentHash -- sha256(full_text); re-asserted here rather than
   *  trusted implicitly, so a caller passing a stale/wrong content hash for a given fragment_id
   *  produces a genuinely different identity instead of silently reusing an old one. */
  readonly chunk_content_hash: string;
  readonly embedding_model_id: string;
  readonly embedding_model_version: string;
  readonly embedding_pipeline_version: string;
}

export interface EmbeddingIdentityFields extends EmbeddingIdentityInput {
  readonly contract_version: typeof EMBEDDING_IDENTITY_CONTRACT_VERSION;
  readonly embedding_identity_hash: string;
}

export class EmbeddingIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingIdentityError";
  }
}

const REQUIRED_FIELDS: readonly (keyof EmbeddingIdentityInput)[] = [
  "fragment_id",
  "materialization_id",
  "chunk_content_hash",
  "embedding_model_id",
  "embedding_model_version",
  "embedding_pipeline_version",
];

function assertComplete(input: EmbeddingIdentityInput): void {
  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new EmbeddingIdentityError(
        "EMBEDDING_IDENTITY_INCOMPLETE",
        `embedding identity requires a non-empty '${field}'`,
      );
    }
  }
}

function canonicalPayload(input: EmbeddingIdentityInput): string {
  // Explicit key order, not object-key insertion order -- the hash must not depend on how the
  // caller happened to construct the input object.
  const ordered = REQUIRED_FIELDS.reduce<Record<string, string>>((acc, field) => {
    acc[field] = input[field];
    return acc;
  }, {});
  return JSON.stringify(ordered);
}

export function computeEmbeddingIdentityHash(input: EmbeddingIdentityInput): string {
  assertComplete(input);
  return createHash("sha256").update(canonicalPayload(input), "utf8").digest("hex");
}

/** Binds and freezes a full EmbeddingIdentityFields record from the six required inputs. */
export function bindEmbeddingIdentity(input: EmbeddingIdentityInput): EmbeddingIdentityFields {
  const embedding_identity_hash = computeEmbeddingIdentityHash(input);
  return Object.freeze({
    fragment_id: input.fragment_id,
    materialization_id: input.materialization_id,
    chunk_content_hash: input.chunk_content_hash,
    embedding_model_id: input.embedding_model_id,
    embedding_model_version: input.embedding_model_version,
    embedding_pipeline_version: input.embedding_pipeline_version,
    contract_version: EMBEDDING_IDENTITY_CONTRACT_VERSION,
    embedding_identity_hash,
  });
}
