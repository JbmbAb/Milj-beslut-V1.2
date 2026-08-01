import type { ContentReference } from "@miljobeslut/mps-core";
import type { PolicyDecisionArtifact } from "@miljobeslut/mps-policy";

// ---------- TID & IDENTITET ----------

export interface Instant {
  readonly iso8601: string; // Canonical RFC 3339
}

export interface RuntimeIdentity {
  readonly runtime_schema_version: string;
  readonly runtime_version: string;
  readonly runtime_hash: string;
}

export type RuntimeCapabilityId = string; // Kommer från Registry

export interface WorkerIdentity {
  readonly worker_id: string;
  readonly runtime_identity: RuntimeIdentity;
  readonly capabilities: readonly RuntimeCapabilityId[];
}

// ---------- PIPELINE & PLANNER INPUT ----------

export interface PipelineSpec {
  readonly schema_version: "pipeline.spec.v1";

  readonly pipeline_id: string;
  readonly version: string;

  readonly stages: readonly {
    readonly id: string;
    readonly type: "GOVERNANCE" | "ARCHIVE" | "PROMOTION" | "CUSTOM";
    readonly config: Record<string, unknown>;
  }[];

  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
  }[];

  readonly triggers: readonly {
    readonly type: "SCHEDULED" | "EVENT_DRIVEN" | "MANUAL";
    readonly schedule_cron?: string;
    readonly event_type?: string;
  }[];

  readonly registry_snapshot_id: string;
  readonly policy_set_id: string;

  readonly metadata: {
    readonly municipality?: string;
    readonly domain?: string;
    readonly description?: string;
  };
}

export interface PlannerInputArtifact {
  readonly schema_version: "planner.input.v1";

  readonly input_hash: string;

  readonly pipeline_id: string;
  readonly pipeline_version: string;
  readonly registry_snapshot_id: string;
  readonly policy_set_id: string;

  readonly pipeline_spec_hash: string;
  readonly registry_snapshot_hash: string;
  readonly policy_set_hash: string;
  readonly clock_instant: Instant;

  readonly pipeline_schema_version: string;
  readonly registry_schema_version: string;
  readonly policy_schema_version: string;
}

// ---------- PLAN BUILDER & PLAN ARTIFACT ----------

export interface PlanArtifact {
  readonly schema_version: "plan.artifact.v1";

  readonly plan_hash: string;
  readonly planner_input_hash: string;

  readonly pipeline_hash: string;
  readonly registry_snapshot_hash: string;
  readonly policy_set_hash: string;

  readonly plan_id: string;

  readonly plan_builder_version: string;
  readonly plan_builder_hash: string;
  readonly canonicalization_version: string;

  readonly stages_order: readonly string[];
  readonly created_at: Instant;
}

export interface PlanBuilder {
  build(
    plannerInput: PlannerInputArtifact
  ): PlanArtifact;
}

// ---------- SCHEDULER POLICY & SCHEDULED PLAN ----------

export interface PriorityWeights {
  readonly LOW: number;
  readonly NORMAL: number;
  readonly HIGH: number;
}

export interface SchedulerPolicyArtifact {
  readonly schema_version: "scheduler.policy.v1";

  readonly policy_id: string;
  readonly policy_hash: string;

  readonly priority_weights: PriorityWeights;
  readonly tenant_quotas: Record<string, number>;
  readonly aging_ms: number;
  readonly burst_allowance: number;
  readonly fairness_algorithm: "WEIGHTED_FAIR_QUEUE";
}

export interface ScheduledPlanArtifact {
  readonly schema_version: "scheduled.plan.v1";

  readonly scheduled_hash: string;

  readonly plan_hash: string;
  readonly scheduler_hash: string;
  readonly scheduler_policy_hash: string;

  readonly scheduled_at: Instant;
  readonly priority: "LOW" | "NORMAL" | "HIGH";
}

export interface Scheduler {
  schedule(
    plan: PlanArtifact,
    instant: Instant,
    policy: SchedulerPolicyArtifact
  ): ScheduledPlanArtifact;
}

// ---------- EXECUTION QUEUE & LEASE-EVENTKEDJA ----------

export interface ExecutionQueueItem {
  readonly queue_item_id: string;
  readonly queue_item_hash: string;

  readonly scheduled_hash: string;
  readonly plan_hash: string;
  readonly tenant_id: string;
  readonly priority: "LOW" | "NORMAL" | "HIGH";
  readonly scheduled_at: Instant;
}

export interface LeaseState {
  readonly lease_id: string;
  readonly queue_item_id: string;
  readonly worker_id: string;
  readonly issued_at: Instant;
  readonly expires_at: Instant;
}

export interface LeaseEventArtifactBase {
  readonly lease_event_hash: string;
  readonly lease_parent_hash?: string;
  readonly lease_id: string;
  readonly queue_item_id: string;
  readonly worker_id: string;
}

export interface LeaseIssuedArtifact extends LeaseEventArtifactBase {
  readonly schema_version: "lease.issued.v1";
  readonly issued_at: Instant;
  readonly expires_at: Instant;
}

export interface LeaseReleasedArtifact extends LeaseEventArtifactBase {
  readonly schema_version: "lease.released.v1";
  readonly released_at: Instant;
}

export interface LeaseExpiredArtifact extends LeaseEventArtifactBase {
  readonly schema_version: "lease.expired.v1";
  readonly expired_at: Instant;
}

export interface LeaseHeartbeatArtifact extends LeaseEventArtifactBase {
  readonly schema_version: "lease.heartbeat.v1";
  readonly heartbeat_at: Instant;
}

export interface LeaseExtendedArtifact extends LeaseEventArtifactBase {
  readonly schema_version: "lease.extended.v1";
  readonly previous_expires_at: Instant;
  readonly new_expires_at: Instant;
}

export interface Lease {
  readonly lease_id: string;
  readonly item: ExecutionQueueItem;
  readonly expires_at: Instant;
}

export interface ExecutionQueue {
  enqueue(item: ExecutionQueueItem): void;

  reserve(worker: WorkerIdentity): Lease | null;
  ack(worker: WorkerIdentity, lease_id: string): void;
  release(worker: WorkerIdentity, lease_id: string): void;

  fail(worker: WorkerIdentity, lease_id: string, reason: string): void;
  retry(queue_item_id: string): void;

  heartbeat(worker: WorkerIdentity, lease_id: string): void;
  extendLease(worker: WorkerIdentity, lease_id: string, duration_ms: number): void;
}

// ---------- CONTROL PLANE CONTEXT & EXECUTION CONTEXT ----------

export interface TenantControlPlaneContextArtifact {
  readonly schema_version: "tenant.controlplane.context.v1";

  readonly context_hash: string;

  readonly tenant_id: string;
  readonly governance_snapshot_id: string;
  readonly governance_hash: string;

  readonly plan_hash: string;
  readonly policy_hash: string;
  readonly registry_snapshot_hash: string;

  readonly trigger_type: "CRON" | "EVENT" | "MANUAL";
  readonly scheduled_at: Instant;
  readonly created_at: Instant;
}

export interface ExecutionContext {
  readonly schema_version: "execution.context.v1";
  readonly execution_context_version: string;

  readonly context_hash: string;

  readonly plan_hash: string;
  readonly scheduled_hash: string;
  readonly control_context_hash: string;

  readonly worker_id: string;
  readonly runtime_hash: string;
  readonly scheduler_hash: string;
}

export interface ExecutionContextFactory {
  create(
    plan: PlanArtifact,
    scheduled: ScheduledPlanArtifact,
    control: TenantControlPlaneContextArtifact,
    worker: WorkerIdentity
  ): ExecutionContext;
}

// ---------- RUNTIME, REPORT & EVENT-SUBSCRIBERS ----------

export interface ExecutionReport {
  readonly schema_version: "execution.report.v1";
  readonly report_hash: string;

  readonly plan_hash: string;
  readonly scheduled_hash: string;
  readonly context_hash: string;
  readonly tenant_id: string;

  readonly started_at: Instant;
  readonly finished_at: Instant;

  readonly success: boolean;
  readonly details: Record<string, unknown>;
}

export interface PipelineRuntime {
  executePipeline(
    plan: PlanArtifact,
    context: ExecutionContext
  ): Promise<ExecutionReport>;
}

export interface PolicyEnforcementMiddleware {
  enforce(
    context: ExecutionContext,
    plan: PlanArtifact
  ): Promise<void>;
}

export interface ExecutionCompletedEvent {
  readonly schema_version: "execution.completed.v1";
  readonly event_hash: string;

  readonly report: ExecutionReport;
}

export interface ExecutionEventSubscriber {
  onExecutionCompleted(event: ExecutionCompletedEvent): Promise<void>;
}
