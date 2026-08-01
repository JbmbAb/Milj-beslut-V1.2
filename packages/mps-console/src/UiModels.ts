export interface ArtifactReference {
  readonly hash: string;
  readonly schema_version: string;
}

export interface PipelineViewModel {
  readonly pipeline_id: string;
  readonly plan: ArtifactReference;
  readonly status: "QUEUED" | "RUNNING" | "FAILED" | "COMPLETED";
  readonly progress: number; // 0–100
}

export interface DashboardViewModel {
  readonly queued: number;
  readonly running: number;
  readonly replay_failures: number;
  readonly policy_blocks: number;
  readonly average_runtime_ms: number;
  readonly worker_utilization_pct: number;
}

export interface ArtifactViewModel {
  readonly reference: ArtifactReference;
  readonly type:
    | "PLAN"
    | "PLANNER_INPUT"
    | "SCHEDULED_PLAN"
    | "EXECUTION_REPORT"
    | "REGISTRY_SNAPSHOT"
    | "POLICY_SET"
    | "EVOLUTION_ARTIFACT";
  readonly summary: Record<string, unknown>;
}

export interface RegistrySnapshotViewModel {
  readonly snapshot: ArtifactReference;
  readonly policies: readonly ArtifactReference[];
  readonly capabilities: readonly ArtifactReference[];
  readonly pipelines: readonly ArtifactReference[];
  readonly scheduler_policies: readonly ArtifactReference[];
  readonly promotion_policies: readonly ArtifactReference[];
}

export interface GovernanceSimulationViewModel {
  readonly policy_before: ArtifactReference;
  readonly policy_after: ArtifactReference;
  readonly diff_summary: Record<string, unknown>;
}

export interface ReplayStepViewModel {
  readonly step_name: string;
  readonly original: ArtifactReference;
  readonly replay: ArtifactReference;
  readonly status: "IDENTICAL" | "DIVERGED";
}

export interface ReplaySimulationViewModel {
  readonly execution: ArtifactReference;
  readonly steps: readonly ReplayStepViewModel[];
}

export interface AuditNodeViewModel {
  readonly audit_ref: ArtifactReference;
  readonly parent_ref?: ArtifactReference;
  readonly diff_summary: Record<string, unknown>;
}

export interface LeaseEventViewModel {
  readonly event_type:
    | "ISSUED"
    | "HEARTBEAT"
    | "EXTENDED"
    | "RELEASED"
    | "EXPIRED";
  readonly at: string;
  readonly lease_id: string;
}

export interface LeaseTimelineViewModel {
  readonly execution: ArtifactReference;
  readonly lease_events: readonly LeaseEventViewModel[];
  readonly audit_events: readonly ArtifactReference[];
}

export interface WorkerViewModel {
  readonly worker_id: string;
  readonly runtime_version: string;
  readonly runtime_hash: string;
  readonly capabilities: readonly string[];
  readonly current_lease?: string;
  readonly queue_depth: number;
  readonly cpu_pct: number;
  readonly mem_pct: number;
}

export interface EventBusEntryViewModel {
  readonly timestamp: string;
  readonly tenant_id: string;
  readonly worker_id?: string;
  readonly runtime_version?: string;
  readonly pipeline_id?: string;
  readonly plan_hash?: string;
  readonly execution_id?: string;
  readonly audit_id?: string;
  readonly event_type: string;
  readonly payload_summary: Record<string, unknown>;
}

export interface EvolutionLineageViewModel {
  readonly seed: ArtifactReference;
  readonly mutations: readonly ArtifactReference[];
  readonly scores: readonly ArtifactReference[];
  readonly elites: readonly ArtifactReference[];
  readonly promotions: readonly ArtifactReference[];
}

export interface LineageNodeViewModel {
  readonly ref: ArtifactReference;
  readonly label: string;
}

export interface LineageEdgeViewModel {
  readonly from: ArtifactReference;
  readonly to: ArtifactReference;
  readonly relation: string;
}

export interface LineageViewModel {
  readonly root: ArtifactReference;
  readonly nodes: readonly LineageNodeViewModel[];
  readonly edges: readonly LineageEdgeViewModel[];
}
