import { ContentHash } from "./ContentHash";

/**
 * ArtifactLineage
 *
 * Provides temporal correctness and fork detection to the 
 * otherwise unordered immutable graph.
 */
export interface ArtifactLineage {
  /**
   * The canonical hash of the previous state. 
   * Null if this is the genesis state.
   */
  readonly parent_hash: ContentHash | null;

  /**
   * Strictly monotonically increasing sequence number.
   * new_state.sequence === previous_state.sequence + 1
   */
  readonly sequence: number;

  /**
   * The logical group or stream this lineage belongs to.
   */
  readonly commit_id: string;
}
