import type { ChunkManifest } from "./ChunkManifest.js";

export type ChunkVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Fail-closed comparison of two manifests (replay determinism).
 */
export function verifyManifestsEqual(
  expected: ChunkManifest,
  actual: ChunkManifest,
): ChunkVerifyResult {
  if (expected.contract_id !== actual.contract_id) {
    return {
      ok: false,
      reason: `REJECT_CHUNK_CONTRACT: ${expected.contract_id} != ${actual.contract_id}`,
    };
  }
  if (expected.chunk_version !== actual.chunk_version) {
    return {
      ok: false,
      reason: `REJECT_CHUNK_VERSION: ${expected.chunk_version} != ${actual.chunk_version}`,
    };
  }
  if (
    expected.source_artifact_ref.artifact_id !==
    actual.source_artifact_ref.artifact_id
  ) {
    return {
      ok: false,
      reason: "REJECT_CHUNK_SOURCE: source_artifact_ref mismatch",
    };
  }
  if (expected.chunks.length !== actual.chunks.length) {
    return {
      ok: false,
      reason: `REJECT_CHUNK_COUNT: ${expected.chunks.length} != ${actual.chunks.length}`,
    };
  }
  for (let i = 0; i < expected.chunks.length; i++) {
    const e = expected.chunks[i]!;
    const a = actual.chunks[i]!;
    if (e.chunk_index !== a.chunk_index) {
      return {
        ok: false,
        reason: `REJECT_CHUNK_ORDER: index ${e.chunk_index} != ${a.chunk_index} at position ${i}`,
      };
    }
    if (e.content_hash.value !== a.content_hash.value) {
      return {
        ok: false,
        reason: `REJECT_CHUNK_HASH: index ${e.chunk_index} hash mismatch`,
      };
    }
    if (
      e.byte_offset_start !== undefined &&
      e.byte_offset_start !== a.byte_offset_start
    ) {
      return {
        ok: false,
        reason: `REJECT_CHUNK_OFFSET: index ${e.chunk_index} start mismatch`,
      };
    }
    if (
      e.byte_offset_end !== undefined &&
      e.byte_offset_end !== a.byte_offset_end
    ) {
      return {
        ok: false,
        reason: `REJECT_CHUNK_OFFSET: index ${e.chunk_index} end mismatch`,
      };
    }
  }
  if (expected.manifest_hash.value !== actual.manifest_hash.value) {
    return {
      ok: false,
      reason: "REJECT_MANIFEST_HASH: manifest_hash mismatch",
    };
  }
  return { ok: true };
}
