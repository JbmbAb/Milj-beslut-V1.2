import { ContentHash } from "../artifacts/ContentHash";

/**
 * Conformance matrix identity.
 *
 * Stable, canonical reference for MCS-001.
 */
export interface ConformanceMatrixIdentity {
  readonly matrix_id: string;
  readonly content_hash: ContentHash;
}
