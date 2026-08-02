import { PlanArtifact, ExecutionAttempt, ContentReference } from "../domain/types.js";

export interface RuntimeSnapshot {
  readonly snapshot_id: string;
  readonly plan_ref: ContentReference;
  readonly attempt: ExecutionAttempt;
  readonly registry_ref: ContentReference;
  readonly policy_ref: ContentReference;
  readonly capability_ref: ContentReference;
}
