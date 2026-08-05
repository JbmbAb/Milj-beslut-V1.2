import type {
  ExecutionContextFactory,
  PlanArtifact,
  ScheduledPlanArtifact,
  TenantControlPlaneContextArtifact,
  WorkerIdentity,
  ExecutionContext,
} from "./types";
import { CanonicalSerializer } from "@miljobeslut/mps-canonical";
import * as crypto from "node:crypto";

export class DefaultExecutionContextFactory implements ExecutionContextFactory {
  constructor(
    private readonly serializer: CanonicalSerializer,
    private readonly contextVersion: string = "1.0.0"
  ) {}

  create(
    plan: PlanArtifact,
    scheduled: ScheduledPlanArtifact,
    control: TenantControlPlaneContextArtifact,
    worker: WorkerIdentity
  ): ExecutionContext {
    // Contract: ExecutionContext SHALL be immutable.
    const baseContext = {
      schema_version: "execution.context.v1" as const,
      execution_context_version: this.contextVersion,
      plan_hash: plan.plan_hash,
      scheduled_hash: scheduled.scheduled_hash,
      control_context_hash: control.context_hash,
      worker_id: worker.worker_id,
      runtime_hash: worker.runtime_identity.runtime_hash,
      scheduler_hash: scheduled.scheduler_hash,
    };

    const bytes = this.serializer.serializeCanonical(baseContext, "JSON");
    const context_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    return {
      ...baseContext,
      context_hash,
    };
  }
}
