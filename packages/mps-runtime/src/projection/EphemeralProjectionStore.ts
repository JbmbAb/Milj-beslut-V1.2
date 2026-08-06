/**
 * Ephemeral projection materialization — never CAS, never source of truth.
 * Used to prove DELETE → Rebuild → identical views from immutable artifacts.
 */

import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ArtifactProjectionView, ProjectionBatchView } from "./ProjectionContracts.js";
import type { ProjectionRuntime } from "./ProjectionRuntime.js";

/**
 * In-memory projection cache (UI/audit materialization).
 * Clearing this store MUST NOT affect CAS artifacts.
 */
export class EphemeralProjectionStore {
  private readonly byId = new Map<string, ArtifactProjectionView>();

  size(): number {
    return this.byId.size;
  }

  get(artifact_id: string): ArtifactProjectionView | undefined {
    return this.byId.get(artifact_id);
  }

  put(view: ArtifactProjectionView): void {
    this.byId.set(view.artifact_id, view);
  }

  /** DELETE all projections — CAS remains authoritative. */
  clear(): void {
    this.byId.clear();
  }

  list(): readonly ArtifactProjectionView[] {
    return Object.freeze([...this.byId.values()]);
  }

  /**
   * Rebuild projections from artifact refs via ProjectionRuntime.
   * Replaces any prior materialization.
   */
  async rebuildFromArtifacts(
    runtime: ProjectionRuntime,
    refs: readonly ArtifactReference[],
  ): Promise<ProjectionBatchView> {
    this.clear();
    const batch = await runtime.projectMany(refs);
    for (const view of batch.views) {
      this.put(view);
    }
    return batch;
  }
}
