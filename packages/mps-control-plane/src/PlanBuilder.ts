import type { PlanBuilder, PlannerInputArtifact, PlanArtifact } from "./types";
import { CanonicalSerializer } from "@miljobeslut/mps-canonical";
import * as crypto from "node:crypto";

export class DefaultPlanBuilder implements PlanBuilder {
  constructor(
    private readonly serializer: CanonicalSerializer,
    private readonly builderVersion: string = "1.0.0",
    private readonly builderHash: string = "hash-builder-v1"
  ) {}

  build(plannerInput: PlannerInputArtifact): PlanArtifact {
    // Contract: PlanBuilder SHALL be pure and deterministic
    const basePlan = {
      schema_version: "plan.artifact.v1" as const,
      planner_input_hash: plannerInput.input_hash,
      pipeline_hash: plannerInput.pipeline_spec_hash,
      registry_snapshot_hash: plannerInput.registry_snapshot_hash,
      policy_set_hash: plannerInput.policy_set_hash,
      plan_id: `plan-${plannerInput.pipeline_id}-${plannerInput.clock_instant.iso8601}`,
      plan_builder_version: this.builderVersion,
      plan_builder_hash: this.builderHash,
      canonicalization_version: "RFC8785-v1",
      stages_order: ["GOVERNANCE", "ARCHIVE", "PROMOTION"], // Deriverad från edges/spec
      created_at: plannerInput.clock_instant,
    };

    const planBytes = this.serializer.serializeCanonical(basePlan, "JSON");
    const plan_hash = `sha256-${crypto.createHash("sha256").update(planBytes).digest("hex")}`;

    return {
      ...basePlan,
      plan_hash,
    };
  }
}
