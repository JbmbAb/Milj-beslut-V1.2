/**
 * Projection Layer contracts — Epoch II §2.7.
 *
 * Views are derived; CAS artifacts remain authoritative.
 * Projection SHALL NEVER become a source of truth.
 */

import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";

export const PROJECTION_RUNTIME_VERSION = "1.0.0" as const;

/**
 * Read-only projection of one immutable artifact envelope.
 * `projection_hash` fingerprints the view for reproducibility checks.
 */
export type ArtifactProjectionView = {
  readonly projection_kind: "artifact";
  readonly artifact_id: string;
  readonly artifact_type: string | null;
  readonly content_hash: ContentHash;
  /** Frozen body snapshot — never a write-back handle. */
  readonly body: unknown;
  readonly projection_hash: ContentHash;
};

export type ProjectionBatchView = {
  readonly projection_kind: "batch";
  readonly views: readonly ArtifactProjectionView[];
  readonly batch_hash: ContentHash;
};
