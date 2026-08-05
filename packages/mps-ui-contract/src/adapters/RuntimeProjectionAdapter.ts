import type { ContentHash } from "../../../../mps-compliance/src/artifacts/ContentHash.js";

/**
 * Thin UI bridge from ProjectionRuntime views (Epoch II §2.7).
 * Presentation only — never resolves CAS itself.
 */
export type RuntimeArtifactProjectionViewModel = {
  readonly artifact_id: string;
  readonly artifact_type: string | null;
  readonly content_hash: ContentHash;
  readonly projection_hash: ContentHash;
  readonly summary: string;
};

export function adaptArtifactProjectionView(input: {
  readonly artifact_id: string;
  readonly artifact_type: string | null;
  readonly content_hash: ContentHash;
  readonly projection_hash: ContentHash;
  readonly body: unknown;
}): RuntimeArtifactProjectionViewModel {
  const typeLabel = input.artifact_type ?? "unknown";
  return {
    artifact_id: input.artifact_id,
    artifact_type: input.artifact_type,
    content_hash: input.content_hash,
    projection_hash: input.projection_hash,
    summary: `${typeLabel}:${input.artifact_id}`,
  };
}
