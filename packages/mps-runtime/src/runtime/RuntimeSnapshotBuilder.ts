import * as crypto from "node:crypto";
import { PlanArtifact, ExecutionAttempt, ContentReference } from "../domain/types.js";
import { RuntimeSnapshot } from "./RuntimeSnapshot.js";

export class RuntimeSnapshotBuilder {
  build(input: {
    plan: PlanArtifact;
    attempt: ExecutionAttempt;
    registry_ref: ContentReference;
    policy_ref: ContentReference;
    capability_ref: ContentReference;
  }): RuntimeSnapshot {
    this.verifyPlanAttemptRelation(input.plan, input.attempt);

    return Object.freeze({
      snapshot_id: crypto.randomUUID(),
      plan_ref: {
        hash: input.plan.content_hash,
        artifact_type: "PlanArtifact"
      },
      attempt: Object.freeze(input.attempt),
      registry_ref: input.registry_ref,
      policy_ref: input.policy_ref,
      capability_ref: input.capability_ref
    });
  }

  private verifyPlanAttemptRelation(
    plan: PlanArtifact,
    attempt: ExecutionAttempt
  ) {
    if (attempt.plan_id !== plan.artifact_id) {
      throw new Error(
        "Attempt does not reference plan"
      );
    }
  }
}
