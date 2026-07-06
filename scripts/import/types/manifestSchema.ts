/**
 * Mimers Brunn archive manifest — v2 canonical contract (Drive ↔ PostGIS).
 *
 * v1 manifests (no schema_version) remain readable; treat qa_status as "pending".
 */

export const MANIFEST_SCHEMA_V2 = '2.0' as const;

export type QAStatus = 'pending' | 'staging_ok' | 'passed' | 'failed';

export interface ManifestFileDetail {
  name: string;
  sha256: string;
  size_bytes: number;
  rel_path?: string;
}

/** Canonical manifest written to Data/<provider>/<dataset>/<version>/manifest.json */
export interface ArchiveManifestV2 {
  schema_version: typeof MANIFEST_SCHEMA_V2;

  // 1. Bas (v1-compatible core)
  provider: string;
  dataset: string;
  version: string;
  total_bytes: number;
  files: string[];
  content_bundle_sha256: string;

  // 2. Metadata & juridik
  provenance: string;
  source_url?: string;
  provider_version?: string;
  license?: string;

  // 3. Datakvalitet & schema
  qa_status: QAStatus;
  qa_at?: string;
  qa_error?: string;
  expected_columns?: string[];

  // 4. Livscykel & spårbarhet
  supersedes?: string;
  invalidated_by?: string;

  // 5. Per-file integrity (Batch A / harvest)
  files_detail?: ManifestFileDetail[];
}

/** Legacy v1 shape (Batch A early proposals, harvesting.ts). */
export interface ArchiveManifestV1 {
  schema_version?: undefined;
  provider: string;
  dataset: string;
  version: string;
  provenance: string;
  content_bundle_sha256: string;
  files: string[];
  total_bytes: number;
  [key: string]: unknown;
}

export type ArchiveManifest = ArchiveManifestV1 | ArchiveManifestV2;

export function isArchiveManifestV2(m: ArchiveManifest): m is ArchiveManifestV2 {
  return m.schema_version === MANIFEST_SCHEMA_V2;
}

export function isValidQAStatus(value: unknown): value is QAStatus {
  return value === 'pending' || value === 'staging_ok' || value === 'passed' || value === 'failed';
}

export function readQaStatus(m: ArchiveManifest): QAStatus {
  if (isArchiveManifestV2(m)) return m.qa_status;
  return 'pending';
}

export function isImportEligible(m: ArchiveManifest): boolean {
  const status = readQaStatus(m);
  return status === 'pending' || status === 'staging_ok';
}

export type BuildArchiveManifestV2Input = {
  provider: string;
  dataset: string;
  version: string;
  total_bytes: number;
  files: string[];
  content_bundle_sha256: string;
  provenance?: string;
  source_url?: string;
  provider_version?: string;
  license?: string;
  qa_status?: QAStatus;
  qa_at?: string;
  qa_error?: string;
  expected_columns?: string[];
  supersedes?: string;
  invalidated_by?: string;
  files_detail?: ManifestFileDetail[];
};

export function buildArchiveManifestV2(input: BuildArchiveManifestV2Input): ArchiveManifestV2 {
  const manifest: ArchiveManifestV2 = {
    schema_version: MANIFEST_SCHEMA_V2,
    provider: input.provider,
    dataset: input.dataset,
    version: input.version,
    total_bytes: input.total_bytes,
    files: input.files,
    content_bundle_sha256: input.content_bundle_sha256,
    provenance: input.provenance ?? 'archive_manifest_audit_proposal',
    qa_status: input.qa_status ?? 'pending',
  };

  if (input.source_url) manifest.source_url = input.source_url;
  if (input.provider_version) manifest.provider_version = input.provider_version;
  if (input.license) manifest.license = input.license;
  if (input.qa_at) manifest.qa_at = input.qa_at;
  if (input.qa_error) manifest.qa_error = input.qa_error;
  if (input.expected_columns?.length) manifest.expected_columns = input.expected_columns;
  if (input.supersedes) manifest.supersedes = input.supersedes;
  if (input.invalidated_by) manifest.invalidated_by = input.invalidated_by;
  if (input.files_detail?.length) manifest.files_detail = input.files_detail;

  return manifest;
}

/** Upgrade v1 proposal or legacy manifest to v2 (non-destructive). */
export function ensureArchiveManifestV2(m: ArchiveManifest): ArchiveManifestV2 {
  if (isArchiveManifestV2(m) && isValidQAStatus(m.qa_status)) {
    return m;
  }

  const legacy = m as ArchiveManifestV1 & Partial<ArchiveManifestV2>;
  return buildArchiveManifestV2({
    provider: legacy.provider,
    dataset: legacy.dataset,
    version: legacy.version,
    total_bytes: legacy.total_bytes,
    files: legacy.files,
    content_bundle_sha256: legacy.content_bundle_sha256,
    provenance: typeof legacy.provenance === 'string' ? legacy.provenance : 'legacy_v1_upgrade',
    source_url: typeof legacy.source_url === 'string' ? legacy.source_url : undefined,
    provider_version: typeof legacy.provider_version === 'string' ? legacy.provider_version : undefined,
    license: typeof legacy.license === 'string' ? legacy.license : undefined,
    qa_status: isValidQAStatus(legacy.qa_status) ? legacy.qa_status : 'pending',
    qa_at: typeof legacy.qa_at === 'string' ? legacy.qa_at : undefined,
    qa_error: typeof legacy.qa_error === 'string' ? legacy.qa_error : undefined,
    expected_columns: Array.isArray(legacy.expected_columns)
      ? legacy.expected_columns.filter((c): c is string => typeof c === 'string')
      : undefined,
    supersedes: typeof legacy.supersedes === 'string' ? legacy.supersedes : undefined,
    invalidated_by: typeof legacy.invalidated_by === 'string' ? legacy.invalidated_by : undefined,
    files_detail: Array.isArray(legacy.files_detail) ? (legacy.files_detail as ManifestFileDetail[]) : undefined,
  });
}

export function validateArchiveManifestStructure(
  m: unknown,
): { ok: true; manifest: ArchiveManifestV2 } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!m || typeof m !== 'object') {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }

  const o = m as Record<string, unknown>;

  for (const field of ['provider', 'dataset', 'version', 'provenance', 'content_bundle_sha256'] as const) {
    if (typeof o[field] !== 'string' || o[field].length === 0) {
      errors.push(`missing or invalid ${field}`);
    }
  }

  if (!Array.isArray(o.files) || o.files.length === 0) {
    errors.push('files[] must be a non-empty array');
  }

  if (typeof o.total_bytes !== 'number' || o.total_bytes < 0) {
    errors.push('total_bytes must be a non-negative number');
  }

  if (o.schema_version === MANIFEST_SCHEMA_V2) {
    if (!isValidQAStatus(o.qa_status)) {
      errors.push('v2 manifest requires qa_status (pending | staging_ok | passed | failed)');
    }
  } else if (o.schema_version !== undefined) {
    errors.push(`unsupported schema_version: ${String(o.schema_version)}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, manifest: ensureArchiveManifestV2(o as ArchiveManifest) };
}

export function applyQaPatch(
  manifest: ArchiveManifestV2,
  patch: {
    qa_status: QAStatus;
    qa_error?: string;
    invalidated_by?: string;
  },
): ArchiveManifestV2 {
  return {
    ...manifest,
    qa_status: patch.qa_status,
    qa_at: new Date().toISOString(),
    qa_error: patch.qa_error,
    invalidated_by: patch.invalidated_by ?? manifest.invalidated_by,
  };
}
