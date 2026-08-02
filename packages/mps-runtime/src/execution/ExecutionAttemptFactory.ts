import * as crypto from "node:crypto";
import { PlanArtifact, ExecutionAttempt } from "../domain/types.js";

export class ExecutionAttemptFactory {
  createInitial(
    plan: PlanArtifact
  ): ExecutionAttempt {
    return Object.freeze({
      attempt_id: crypto.randomUUID(),
      plan_id: plan.artifact_id,
      reason: "INITIAL",
      created_at: new Date().toISOString()
    });
  }

  createRetry(
    previous: ExecutionAttempt
  ): ExecutionAttempt {
    return Object.freeze({
      attempt_id: crypto.randomUUID(),
      plan_id: previous.plan_id,
      previous_attempt_id: previous.attempt_id,
      reason: "RETRY",
      created_at: new Date().toISOString()
    });
  }

  createLeaseRecovery(
    expired: ExecutionAttempt
  ): ExecutionAttempt {
    return Object.freeze({
      attempt_id: crypto.randomUUID(),
      plan_id: expired.plan_id,
      previous_attempt_id: expired.attempt_id,
      reason: "LEASE_RECOVERY",
      created_at: new Date().toISOString()
    });
  }
}
