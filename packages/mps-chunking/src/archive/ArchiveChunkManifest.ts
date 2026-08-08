import type { SourceArtifactRef } from "../core/ChunkTypes.js";
import { buildChunkManifest, type ChunkManifest } from "../core/ChunkManifest.js";
import { ARCHIVE_CHUNK_VERSION } from "../core/ChunkVersion.js";
import {
  ARCHIVE_MAX_CHUNK_BYTES,
  chunkArchiveBytes,
  type ArchiveByteChunk,
} from "./ArchiveByteChunker.js";

/**
 * Shape suitable for Mimers MB-005 chunk-verification.json
 */
export interface ArchiveChunkVerificationJson {
  readonly control: "MB-005";
  readonly contract_id: "archive";
  readonly chunk_version: typeof ARCHIVE_CHUNK_VERSION;
  /** Exact byte size used for chunking (authoritative for replay). */
  readonly max_chunk_size_bytes: number;
  /** Mimers §10 display parameter (256 in production). */
  readonly max_chunk_size_mb: number;
  readonly hash_per_chunk: "sha256";
  readonly stable_ordering: true;
  readonly source_artifact_ref: SourceArtifactRef;
  readonly manifest_hash: string;
  readonly chunks: ReadonlyArray<{
    readonly chunk_index: number;
    readonly sha256: string;
    readonly byte_offset_start: number;
    readonly byte_offset_end: number;
  }>;
}

export interface ArchiveChunkResult {
  readonly chunks: readonly ArchiveByteChunk[];
  readonly manifest: ChunkManifest;
  readonly verification: ArchiveChunkVerificationJson;
}

export function buildArchiveChunkResult(
  bytes: Uint8Array,
  source_artifact_ref: SourceArtifactRef,
  maxChunkBytes: number = ARCHIVE_MAX_CHUNK_BYTES,
): ArchiveChunkResult {
  const chunks = chunkArchiveBytes(bytes, source_artifact_ref, maxChunkBytes);
  const manifest = buildChunkManifest(
    "archive",
    ARCHIVE_CHUNK_VERSION,
    source_artifact_ref,
    chunks,
    chunks.map((c) => ({
      chunk_index: c.chunk_index,
      byte_offset_start: c.byte_offset_start,
      byte_offset_end: c.byte_offset_end,
    })),
  );

  const verification: ArchiveChunkVerificationJson = Object.freeze({
    control: "MB-005",
    contract_id: "archive" as const,
    chunk_version: ARCHIVE_CHUNK_VERSION,
    max_chunk_size_bytes: maxChunkBytes,
    max_chunk_size_mb: maxChunkBytes / (1024 * 1024),
    hash_per_chunk: "sha256" as const,
    stable_ordering: true as const,
    source_artifact_ref,
    manifest_hash: manifest.manifest_hash.value,
    chunks: Object.freeze(
      chunks.map((c) =>
        Object.freeze({
          chunk_index: c.chunk_index,
          sha256: c.content_hash.value,
          byte_offset_start: c.byte_offset_start,
          byte_offset_end: c.byte_offset_end,
        }),
      ),
    ),
  });

  return {
    chunks: Object.freeze(chunks),
    manifest,
    verification,
  };
}
