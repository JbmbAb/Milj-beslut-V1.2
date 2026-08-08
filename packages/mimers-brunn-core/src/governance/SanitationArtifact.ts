/**
 * Governance operations for Master Archive sanitation / migration.
 * Sanitation is not "file cleanup" — it is a reproducible, approved operation
 * with provenance (same immutability model as harvest + CAS).
 */

export const SANITATION_SCHEMA_VERSION = '1.0' as const;

export type SanitationAction =
  | 'MOVE'
  | 'FREEZE'
  | 'PROMOTE'
  | 'REPAIR_MANIFEST'
  | 'REHARVEST'
  | 'CLASSIFY'
  | 'INVALIDATE';

export type SanitationReason =
  | 'checksum_mismatch'
  | 'truncated_artifact'
  | 'provider_mismatch'
  | 'duplicate_alias'
  | 'legacy_migration'
  | 'incomplete_harvest'
  | 'dataset_family_normalize'
  | 'governance';

export type LegacyClassification = 'canonical' | 'duplicate' | 'obsolete' | 'unknown';

export type SanitationFileRef = {
  readonly path: string;
  readonly sha256?: string;
  readonly size_bytes?: number;
};

export type SanitationArtifact = {
  readonly schema_version: typeof SANITATION_SCHEMA_VERSION;
  readonly operation_id: string;
  readonly action: SanitationAction;
  readonly reason: SanitationReason;
  readonly source: string;
  readonly target?: string;
  readonly provider?: string;
  readonly dataset?: string;
  readonly files?: number;
  readonly old_hashes: readonly string[];
  readonly new_hashes: readonly string[];
  readonly file_refs?: readonly SanitationFileRef[];
  readonly classification?: LegacyClassification;
  readonly related_operation_ids?: readonly string[];
  readonly approved_by: string;
  readonly created_at: string;
  readonly closed_at?: string;
  readonly status: 'planned' | 'in_progress' | 'completed' | 'aborted';
  readonly notes?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
};

export type BuildSanitationArtifactInput = {
  operation_id: string;
  action: SanitationAction;
  reason: SanitationReason;
  source: string;
  target?: string;
  provider?: string;
  dataset?: string;
  files?: number;
  old_hashes?: readonly string[];
  new_hashes?: readonly string[];
  file_refs?: readonly SanitationFileRef[];
  classification?: LegacyClassification;
  related_operation_ids?: readonly string[];
  approved_by: string;
  created_at?: string;
  closed_at?: string;
  status?: SanitationArtifact['status'];
  notes?: string;
  evidence?: Readonly<Record<string, unknown>>;
};

export function buildSanitationArtifact(input: BuildSanitationArtifactInput): SanitationArtifact {
  return {
    schema_version: SANITATION_SCHEMA_VERSION,
    operation_id: input.operation_id,
    action: input.action,
    reason: input.reason,
    source: input.source,
    target: input.target,
    provider: input.provider,
    dataset: input.dataset,
    files: input.files,
    old_hashes: input.old_hashes ?? [],
    new_hashes: input.new_hashes ?? [],
    file_refs: input.file_refs,
    classification: input.classification,
    related_operation_ids: input.related_operation_ids,
    approved_by: input.approved_by,
    created_at: input.created_at ?? new Date().toISOString(),
    closed_at: input.closed_at,
    status: input.status ?? 'planned',
    notes: input.notes,
    evidence: input.evidence,
  };
}

export function assertSanitationArtifact(value: unknown): asserts value is SanitationArtifact {
  if (!value || typeof value !== 'object') throw new Error('SanitationArtifact must be an object');
  const v = value as Record<string, unknown>;
  if (v.schema_version !== SANITATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported sanitation schema_version: ${String(v.schema_version)}`);
  }
  if (typeof v.operation_id !== 'string' || !v.operation_id) {
    throw new Error('operation_id required');
  }
  if (typeof v.action !== 'string' || typeof v.reason !== 'string') {
    throw new Error('action and reason required');
  }
  if (typeof v.source !== 'string' || typeof v.approved_by !== 'string') {
    throw new Error('source and approved_by required');
  }
}
