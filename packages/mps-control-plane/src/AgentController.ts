import type {
  PlanArtifact,
  ScheduledPlanArtifact,
  TenantControlPlaneContextArtifact,
  WorkerIdentity,
  PipelineRuntime,
  PolicyEnforcementMiddleware,
  ExecutionContextFactory,
  ExecutionEventSubscriber,
  ExecutionCompletedEvent,
} from "./types";
import { CanonicalSerializer } from "@miljobeslut/mps-canonical";
import * as crypto from "node:crypto";

export class AgentController {
  constructor(
    private readonly runtime: PipelineRuntime,
    private readonly policy: PolicyEnforcementMiddleware,
    private readonly contextFactory: ExecutionContextFactory,
    private readonly subscribers: readonly ExecutionEventSubscriber[],
    private readonly serializer: CanonicalSerializer
  ) {}

  async execute(
    plan: PlanArtifact,
    scheduled: ScheduledPlanArtifact,
    controlContext: TenantControlPlaneContextArtifact,
    worker: WorkerIdentity
  ): Promise<void> {
    const execCtx = this.contextFactory.create(
      plan,
      scheduled,
      controlContext,
      worker
    );

    // 1. Enforce Policies (throws on BLOCK or PENDING REVIEW)
    await this.policy.enforce(execCtx, plan);

    // 2. Execute Pipeline Runtime
    const report = await this.runtime.executePipeline(plan, execCtx);

    const eventCore = {
      schema_version: "execution.completed.v1" as const,
      report,
    };

    const bytes = this.serializer.serializeCanonical(eventCore, "JSON");
    const event_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    const event: ExecutionCompletedEvent = {
      ...eventCore,
      event_hash,
    };

    // 3. Notify Subscribers concurrently
    await Promise.all(
      this.subscribers.map(s => s.onExecutionCompleted(event))
    );
  }
}
