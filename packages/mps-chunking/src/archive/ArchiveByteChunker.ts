import type { ChunkBase, SourceArtifactRef } from "../core/ChunkTypes.js";
import { sha256Bytes } from "../core/ChunkHasher.js";
import { ARCHIVE_CHUNK_VERSION } from "../core/ChunkVersion.js";

/** Mimers Brunn §10 — max_chunk_size_mb: 256 */
export const ARCHIVE_MAX_CHUNK_BYTES = 256 * 1024 * 1024;

export interface ArchiveByteChunk extends ChunkBase {
  readonly contract_id: "archive";
  readonly chunk_version: typeof ARCHIVE_CHUNK_VERSION;
  readonly byte_offset_start: number;
  readonly byte_offset_end: number;
}

/**
 * Fixed-size byte-range chunker. No semantic boundaries, no overlap, no text decode.
 */
export function chunkArchiveBytes(
  bytes: Uint8Array,
  source_artifact_ref: SourceArtifactRef,
  maxChunkBytes: number = ARCHIVE_MAX_CHUNK_BYTES,
): ArchiveByteChunk[] {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(
      "REJECT_ARCHIVE_CONTRACT: archive chunker requires Uint8Array input",
    );
  }
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes <= 0) {
    throw new Error("REJECT_ARCHIVE_CONTRACT: maxChunkBytes must be positive integer");
  }

  const chunks: ArchiveByteChunk[] = [];
  let index = 0;

  for (let start = 0; start < bytes.length; start += maxChunkBytes) {
    const end = Math.min(bytes.length, start + maxChunkBytes);
    const slice = bytes.subarray(start, end);
    chunks.push({
      source_artifact_ref,
      chunk_index: index,
      content_hash: sha256Bytes(slice),
      contract_id: "archive",
      chunk_version: ARCHIVE_CHUNK_VERSION,
      byte_offset_start: start,
      byte_offset_end: end,
    });
    index += 1;
  }

  // Empty file → single empty chunk at 0..0 for stable manifest
  if (chunks.length === 0) {
    chunks.push({
      source_artifact_ref,
      chunk_index: 0,
      content_hash: sha256Bytes(new Uint8Array(0)),
      contract_id: "archive",
      chunk_version: ARCHIVE_CHUNK_VERSION,
      byte_offset_start: 0,
      byte_offset_end: 0,
    });
  }

  return chunks;
}
