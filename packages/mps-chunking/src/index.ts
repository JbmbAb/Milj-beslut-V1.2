export type {
  ChunkContractId,
  SourceArtifactRef,
  ContentHash,
  ChunkBase,
} from "./core/ChunkTypes.js";

export {
  TEXT_CHUNK_VERSION,
  ARCHIVE_CHUNK_VERSION,
  versionForContract,
  formatContractVersion,
} from "./core/ChunkVersion.js";

export { sha256Bytes, sha256Utf8Text } from "./core/ChunkHasher.js";

export {
  buildChunkManifest,
  type ChunkManifest,
  type ChunkManifestEntry,
} from "./core/ChunkManifest.js";

export {
  verifyManifestsEqual,
  type ChunkVerifyResult,
} from "./core/ChunkVerifier.js";

export * from "./text/index.js";
export * from "./archive/index.js";
