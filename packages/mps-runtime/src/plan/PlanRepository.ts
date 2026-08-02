import { PlanArtifact } from "../domain/types.js";

export class PlanRepository {
  constructor(
    private readonly storage: Map<string, PlanArtifact>
  ) {}

  get(planId: string): PlanArtifact {
    const artifact = this.storage.get(planId);

    if (!artifact) {
      throw new Error(
        `PlanArtifact not found: ${planId}`
      );
    }

    return artifact;
  }

  save(plan: PlanArtifact): void {
    const existing = this.storage.get(plan.artifact_id);
    
    if (existing) {
      if (existing.content_hash === plan.content_hash) {
        // Idempotent success - same identity, same bytes/hash
        return;
      }
      throw new Error(
        "PlanArtifact identity already exists with different content"
      );
    }

    this.storage.set(
      plan.artifact_id,
      Object.freeze(plan)
    );
  }
}
