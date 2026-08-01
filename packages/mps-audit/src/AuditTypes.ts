import type { ReplayResult } from "@miljobeslut/mps-replay";
import type { StageOutput } from "@miljobeslut/mps-runtime";

export interface AuditRecord {
  readonly schema_version: string;

  readonly audit_id: string;
  readonly sequence: number;

  readonly audit_hash: string;
  readonly parent?: {
    readonly audit_id: string;
    readonly audit_hash: string;
  };

  readonly runtime_id: string;

  readonly registry_snapshot_id: string;
  readonly registry_hash: string;

  readonly started_at: string;
  readonly finished_at: string;

  readonly stages: readonly StageOutput<unknown>[];

  readonly replay: ReplayResult;
  readonly completed: boolean;
}

export interface AuditArtifact {
  readonly record: AuditRecord;
  readonly hash: string;
}

export interface AuditReference {
  readonly audit_id: string;
  readonly audit_hash: string;
}

export interface AuditChainIndex {
  readonly latest_audit_id: string | null;
  readonly latest_audit_hash: string | null;
  readonly length: number;
}
