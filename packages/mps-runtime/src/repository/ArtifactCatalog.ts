import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";

/**
 * Non-authoritative artifact-id catalog. Listing IDs is a locator only — every candidate
 * must still be resolved and re-verified through ArtifactRepositoryPort before use.
 */
export interface ArtifactCatalogPort {
  listArtifactIds(): Promise<readonly string[]>;
}

export function artifactCatalogOf(
  repository: ArtifactRepositoryPort,
): ArtifactCatalogPort | null {
  const candidate = repository as ArtifactRepositoryPort & Partial<ArtifactCatalogPort>;
  return typeof candidate.listArtifactIds === "function" ? (candidate as ArtifactCatalogPort) : null;
}
