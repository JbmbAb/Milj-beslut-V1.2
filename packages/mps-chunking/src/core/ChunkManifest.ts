import type { ChunkBase, ChunkContractId, SourceArtifactRef } from "./ChunkTypes.js";
import type { ContentHash } from "./ChunkTypes.js";
import { sha256Utf8Text } from "./ChunkHasher.js";

export interface ChunkManifestEntry {
  readonly chunk_index: number;
  readonly content_hash: ContentHash;
  readonly byte_offset_start?: number;
  readonly byte_offset_end?: number;
}

export interface ChunkManifest {
  readonly contract_id: ChunkContractId;
  readonly chunk_version: string;
  readonly source_artifact_ref: SourceArtifactRef;
  readonly chunks: readonly ChunkManifestEntry[];
  /** Hash of ordered (index, content_hash) pairs for replay. */
  readonly manifest_hash: ContentHash;
}

export function buildChunkManifest(
  contract_id: ChunkContractId,
  chunk_version: string,
  source_artifact_ref: SourceArtifactRef,
  chunks: readonly ChunkBase[],
  extras?: readonly {
    readonly chunk_index: number;
    readonly byte_offset_start?: number;
    readonly byte_offset_end?: number;
  }[],
): ChunkManifest {
  const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const extraByIndex = new Map(
    (extras ?? []).map((e) => [e.chunk_index, e] as const),
  );

  const entries: ChunkManifestEntry[] = ordered.map((c) => {
    const extra = extraByIndex.get(c.chunk_index);
    return {
      chunk_index: c.chunk_index,
      content_hash: c.content_hash,
      ...(extra?.byte_offset_start !== undefined
        ? { byte_offset_start: extra.byte_offset_start }
        : {}),
      ...(extra?.byte_offset_end !== undefined
        ? { byte_offset_end: extra.byte_offset_end }
        : {}),
    };
  });

  const canonical = entries
    .map((e) => `${e.chunk_index}:${e.content_hash.value}`)
    .join("|");

  return Object.freeze({
    contract_id,
    chunk_version,
    source_artifact_ref,
    chunks: Object.freeze(entries),
    manifest_hash: sha256Utf8Text(canonical),
  });
}
