import type {
  DashboardViewModel,
  PipelineViewModel,
  ArtifactReference,
  ArtifactViewModel,
  RegistrySnapshotViewModel,
  GovernanceSimulationViewModel,
  ReplaySimulationViewModel,
  AuditNodeViewModel,
  LeaseTimelineViewModel,
  WorkerViewModel,
  EventBusEntryViewModel,
  EvolutionLineageViewModel,
  LineageViewModel,
} from "./UiModels";

export interface DashboardProjection {
  readonly dashboard: DashboardViewModel;
}

export interface PipelineProjection {
  readonly pipeline: PipelineViewModel;
  readonly spec: ArtifactReference;
  readonly planner_input: ArtifactReference;
  readonly plan: ArtifactReference;
  readonly scheduled_plan: ArtifactReference;
  readonly execution_report?: ArtifactReference;
}

export interface ArtifactProjection {
  readonly artifact: ArtifactViewModel;
  readonly related: readonly ArtifactReference[];
}

export interface RegistryProjection {
  readonly registry: RegistrySnapshotViewModel;
}

export interface GovernanceProjection {
  readonly simulation: GovernanceSimulationViewModel;
}

export interface ReplayProjection {
  readonly replay: ReplaySimulationViewModel;
}

export interface AuditChainProjection {
  readonly nodes: readonly AuditNodeViewModel[];
}

export interface LeaseTimelineProjection {
  readonly timeline: LeaseTimelineViewModel;
}

export interface WorkerProjection {
  readonly workers: readonly WorkerViewModel[];
}

export interface EventBusProjection {
  readonly events: readonly EventBusEntryViewModel[];
}

export interface EvolutionProjection {
  readonly evolution: EvolutionLineageViewModel;
}

export interface LineageProjection {
  readonly lineage: LineageViewModel;
}

export interface MpsProjectionApi {
  getDashboard(): Promise<DashboardProjection>;
  getPipeline(id: string): Promise<PipelineProjection>;
  getArtifact(hash: string): Promise<ArtifactProjection>;
  getRegistry(snapshotId: string): Promise<RegistryProjection>;
  getGovernanceSimulation(
    tenantId: string,
    beforePolicyHash: string,
    afterPolicyHash: string
  ): Promise<GovernanceProjection>;
  getReplay(executionHash: string): Promise<ReplayProjection>;
  getAuditChain(rootAuditHash: string): Promise<AuditChainProjection>;
  getLeaseTimeline(executionHash: string): Promise<LeaseTimelineProjection>;
  getWorkers(): Promise<WorkerProjection>;
  getEventBus(params: {
    tenantId?: string;
    workerId?: string;
    runtimeVersion?: string;
    pipelineId?: string;
    planHash?: string;
    executionId?: string;
    auditId?: string;
  }): Promise<EventBusProjection>;
  getEvolutionLineage(seedHash: string): Promise<EvolutionProjection>;
  getLineage(rootHash: string): Promise<LineageProjection>;
}
