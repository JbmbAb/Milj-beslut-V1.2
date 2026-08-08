import type { SourceArtifactRef } from "../core/ChunkTypes.js";
import type { ChunkVerifyResult } from "../core/ChunkVerifier.js";
import { ARCHIVE_MAX_CHUNK_BYTES } from "./ArchiveByteChunker.js";
import {
  buildArchiveChunkResult,
  type ArchiveChunkVerificationJson,
} from "./ArchiveChunkManifest.js";

/**
 * Recompute archive byte chunks and compare to an expected MB-005 verification record.
 */
export function verifyArchiveBytes(
  bytes: Uint8Array,
  expected: ArchiveChunkVerificationJson,
  source_artifact_ref?: SourceArtifactRef,
): ChunkVerifyResult {
  if (expected.control !== "MB-005") {
    return { ok: false, reason: "REJECT_MB005: expected control MB-005" };
  }
  if (expected.hash_per_chunk !== "sha256") {
    return { ok: false, reason: "REJECT_MB005: hash_per_chunk must be sha256" };
  }

  const source = source_artifact_ref ?? expected.source_artifact_ref;
  const maxBytes =
    expected.max_chunk_size_bytes > 0
      ? expected.max_chunk_size_bytes
      : expected.max_chunk_size_mb > 0
        ? Math.round(expected.max_chunk_size_mb * 1024 * 1024)
        : ARCHIVE_MAX_CHUNK_BYTES;

  const actual = buildArchiveChunkResult(bytes, source, maxBytes);

  if (actual.verification.chunks.length !== expected.chunks.length) {
    return {
      ok: false,
      reason: `REJECT_MB005: chunk count ${actual.verification.chunks.length} != ${expected.chunks.length}`,
    };
  }
  for (let i = 0; i < expected.chunks.length; i++) {
    const e = expected.chunks[i]!;
    const a = actual.verification.chunks[i]!;
    if (
      e.chunk_index !== a.chunk_index ||
      e.sha256 !== a.sha256 ||
      e.byte_offset_start !== a.byte_offset_start ||
      e.byte_offset_end !== a.byte_offset_end
    ) {
      return {
        ok: false,
        reason: `REJECT_MB005: chunk ${e.chunk_index} mismatch on replay`,
      };
    }
  }
  if (actual.verification.manifest_hash !== expected.manifest_hash) {
    return {
      ok: false,
      reason: "REJECT_MB005: manifest_hash mismatch",
    };
  }

  return { ok: true };
}
