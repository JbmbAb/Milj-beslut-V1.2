import { ArtifactContract } from "../artifacts/ArtifactContract";
import { ArtifactReference } from "../artifacts/ArtifactReference";

/**
 * Immutable validation context.
 *
 * Provides access to the canonical artifact graph.
 */
export interface ValidationContext {
  readonly artifacts: readonly ArtifactContract[];

  /**
   * Resolves a canonical artifact reference into an artifact contract.
   *
   * Implementations SHALL NOT mutate artifacts during resolution.
   */
  resolve(reference: ArtifactReference): ArtifactContract | undefined;
}
