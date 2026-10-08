import type { CheckVerdict, StageId } from './vocabulary';

/** The validated manifest (what C1 established). Optional `max_seq_length` is identity by presence. */
export interface Manifest {
  readonly manifest_type: string;
  readonly contract_version: string;
  readonly candidate: { readonly commit_sha: string; readonly tree_sha: string };
  readonly release: { readonly artifact_id: string; readonly contract_version: string; readonly release_hash_sha256: string };
  readonly zero_google: { readonly evidence_sha256: string };
  readonly embedding: {
    readonly contract_version: string;
    readonly pipeline_key: string;
    readonly model_id: string;
    readonly model_revision: string;
    readonly pipeline_version: string;
    readonly dimension: number;
    readonly normalization: string;
    readonly query_prefix_sha256: string;
    readonly passage_prefix_sha256: string;
    readonly max_seq_length?: number;
    readonly pipeline_spec_sha256: string;
    readonly snapshot_manifest_sha256: string;
    readonly registry_sha256: string;
    readonly admission_sha256: string;
    readonly selection_decision_sha256: string;
    readonly evidence_sha256: string;
  };
  readonly schema: {
    readonly prisma_schema_blob_sha1: string;
    readonly migration_id: string;
    readonly migration_sql_sha256: string;
    readonly table: string;
    readonly vector_dimension: number;
    readonly approval_sha256: string;
    readonly evidence_sha256: string;
  };
  readonly generation:
    | {
        readonly posture: 'BOUND';
        readonly runtime_id: string;
        readonly runtime_implementation_sha256: string;
        readonly runtime_config_sha256: string;
        readonly model_id: string;
        readonly model_version: string;
        readonly model_snapshot_manifest_sha256: string;
        readonly generation_contract_version: string;
        readonly port_source_blob_sha1: string;
        readonly evidence_sha256: string;
      }
    | { readonly posture: 'DECLARED_ABSENT'; readonly evidence_sha256: string };
}

export interface CheckRecord {
  readonly id: StageId;
  readonly result: CheckVerdict;
  readonly code?: string;
}

export interface Evaluation {
  readonly result: CheckVerdict;
  readonly failure_code?: string;
  readonly manifest_sha256?: string;
  readonly checks: readonly CheckRecord[];
}

/** Contract 11.1. `observations` carries adapter-produced facts; the core performs no IO. */
export interface EvaluateInput {
  readonly manifest_bytes: Uint8Array;
  readonly policy: unknown;
  readonly policy_authentication: unknown;
  readonly verifier: unknown;
  readonly observations: unknown;
  readonly expected_manifest_sha256?: string;
}
