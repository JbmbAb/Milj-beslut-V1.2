import type { PipelineStage } from "@miljobeslut/mps-runtime";

export interface ObservationContext {
  readonly runtime_id: string;
  readonly registry_snapshot_id: string;
  readonly registry_hash: string;

  readonly pipeline_version: string;

  readonly stage?: PipelineStage;
  readonly artifact_id?: string;
}

export interface TelemetrySpan {
  readonly trace_id: string;
  readonly span_id: string;
  readonly parent_span_id?: string;

  readonly name: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly duration_ms: number;

  readonly context: ObservationContext;
}

export interface TelemetryMetric {
  readonly name: string;
  readonly value: number;
  readonly labels: Record<string, string>;
}

export interface TelemetryLog {
  readonly level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  readonly message: string;
  readonly timestamp: string;
  readonly context: ObservationContext;
}

export const Metrics = {
  runtimeDuration: "mps_runtime_execution_duration_ms",
  stageDuration: "mps_stage_duration_ms",
  verificationFailures: "mps_verification_failures_total",
  replayMismatch: "mps_replay_mismatch_total",
  artifactWrites: "mps_artifact_store_writes_total",
} as const;
