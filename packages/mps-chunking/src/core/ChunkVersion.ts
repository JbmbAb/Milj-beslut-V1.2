import type { ChunkContractId } from "./ChunkTypes.js";

/** Separate version namespaces — never one linear version across contracts. */
export const TEXT_CHUNK_VERSION = "v2.3" as const;
export const ARCHIVE_CHUNK_VERSION = "v1.0" as const;

export type TextChunkVersion = typeof TEXT_CHUNK_VERSION;
export type ArchiveChunkVersion = typeof ARCHIVE_CHUNK_VERSION;

export function versionForContract(contract: ChunkContractId): string {
  switch (contract) {
    case "text":
      return TEXT_CHUNK_VERSION;
    case "archive":
      return ARCHIVE_CHUNK_VERSION;
    default: {
      const _exhaustive: never = contract;
      return _exhaustive;
    }
  }
}

export function formatContractVersion(contract: ChunkContractId): string {
  return `${contract}/${versionForContract(contract)}`;
}
