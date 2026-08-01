import type {
  ContentReference,
} from "@miljobeslut/mps-core";

import type {
  ReplayResult,
} from "@miljobeslut/mps-replay";

export type PipelineStage =
  | "GOVERNANCE"
  | "ARCHIVE"
  | "PROMOTION";

export interface StageInput {
  readonly stage: PipelineStage;
  readonly reference: ContentReference;
}

export interface StageOutput<TArtifact> {
  readonly stage: PipelineStage;
  readonly reference: ContentReference;
  readonly artifact_id: string;
  readonly artifact: TArtifact;
  readonly runtime_id: string;
  readonly registry_snapshot_id: string;
}

export interface ExecutionManifestStage {
  readonly stage: PipelineStage;
  readonly reference: ContentReference;
}

export interface ExecutionManifest {
  readonly runtime_id: string;
  readonly registry_snapshot_id: string;
  readonly registry_hash: string;
  readonly stages: readonly ExecutionManifestStage[];
}

export interface ExecutionReport {
  readonly runtime_id: string;
  readonly started_at: string;
  readonly finished_at: string;

  readonly registry_snapshot_id: string;
  readonly registry_hash: string;

  readonly stages: readonly StageOutput<unknown>[];
  readonly replay: ReplayResult;

  readonly completed: boolean;
}
