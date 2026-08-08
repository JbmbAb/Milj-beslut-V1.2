/**
 * Shared chunk basetypes — not a UniversalChunker.
 * Text and archive contracts extend these without sharing algorithms.
 */

export type ChunkContractId = "text" | "archive";

export interface SourceArtifactRef {
  readonly artifact_id: string;
  /** Optional opaque type label (document, archive_file, …). */
  readonly artifact_type?: string;
}

export interface ContentHash {
  readonly algorithm: "sha256";
  readonly value: string;
}

/** Shared identity fields present on every produced chunk. */
export interface ChunkBase {
  readonly source_artifact_ref: SourceArtifactRef;
  readonly chunk_index: number;
  readonly content_hash: ContentHash;
  readonly contract_id: ChunkContractId;
  readonly chunk_version: string;
}
