/**
 * JS mirror of manifestSchema.ts for .mjs tooling (archive-manifest-audit, rclone upload).
 * Keep in sync with scripts/import/types/manifestSchema.ts
 */

export const MANIFEST_SCHEMA_V2 = '2.0';

/** @typedef {'pending'|'staging_ok'|'passed'|'failed'} QAStatus */

/**
 * @param {object} input
 * @returns {import('./manifestSchema.ts').ArchiveManifestV2}
 */
export function buildArchiveManifestV2(input) {
  /** @type {Record<string, unknown>} */
  const manifest = {
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

  return /** @type {import('./manifestSchema.ts').ArchiveManifestV2} */ (manifest);
}

/**
 * @param {unknown} manifest
 * @returns {import('./manifestSchema.ts').ArchiveManifestV2}
 */
export function ensureArchiveManifestV2(manifest) {
  if (
    manifest
    && typeof manifest === 'object'
    && /** @type {{ schema_version?: string, qa_status?: string }} */ (manifest).schema_version === MANIFEST_SCHEMA_V2
    && isValidQAStatus(/** @type {{ qa_status?: string }} */ (manifest).qa_status)
  ) {
    return /** @type {import('./manifestSchema.ts').ArchiveManifestV2} */ (manifest);
  }

  const legacy = /** @type {Record<string, unknown>} */ (manifest ?? {});
  return buildArchiveManifestV2({
    provider: String(legacy.provider ?? ''),
    dataset: String(legacy.dataset ?? ''),
    version: String(legacy.version ?? ''),
    total_bytes: Number(legacy.total_bytes ?? 0),
    files: Array.isArray(legacy.files) ? legacy.files.map(String) : [],
    content_bundle_sha256: String(legacy.content_bundle_sha256 ?? ''),
    provenance: typeof legacy.provenance === 'string' ? legacy.provenance : 'legacy_v1_upgrade',
    source_url: typeof legacy.source_url === 'string' ? legacy.source_url : undefined,
    provider_version: typeof legacy.provider_version === 'string' ? legacy.provider_version : undefined,
    license: typeof legacy.license === 'string' ? legacy.license : undefined,
    qa_status: isValidQAStatus(legacy.qa_status) ? legacy.qa_status : 'pending',
    qa_at: typeof legacy.qa_at === 'string' ? legacy.qa_at : undefined,
    qa_error: typeof legacy.qa_error === 'string' ? legacy.qa_error : undefined,
    expected_columns: Array.isArray(legacy.expected_columns)
      ? legacy.expected_columns.filter((c) => typeof c === 'string')
      : undefined,
    supersedes: typeof legacy.supersedes === 'string' ? legacy.supersedes : undefined,
    invalidated_by: typeof legacy.invalidated_by === 'string' ? legacy.invalidated_by : undefined,
    files_detail: Array.isArray(legacy.files_detail) ? legacy.files_detail : undefined,
  });
}

/** @param {unknown} value @returns {value is QAStatus} */
export function isValidQAStatus(value) {
  return value === 'pending' || value === 'staging_ok' || value === 'passed' || value === 'failed';
}

/**
 * @param {unknown} m
 * @returns {{ ok: true, manifest: import('./manifestSchema.ts').ArchiveManifestV2 } | { ok: false, errors: string[] }}
 */
export function validateArchiveManifestStructure(m) {
  const errors = [];
  if (!m || typeof m !== 'object') {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }

  const o = /** @type {Record<string, unknown>} */ (m);

  for (const field of ['provider', 'dataset', 'version', 'provenance', 'content_bundle_sha256']) {
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

  return { ok: true, manifest: ensureArchiveManifestV2(o) };
}

/** @param {import('./manifestSchema.ts').ArchiveManifestV2} manifest */
export function applyQaPatch(manifest, patch) {
  return {
    ...manifest,
    qa_status: patch.qa_status,
    qa_at: new Date().toISOString(),
    qa_error: patch.qa_error,
    invalidated_by: patch.invalidated_by ?? manifest.invalidated_by,
  };
}

/** @param {unknown} m */
export function readQaStatus(m) {
  if (m && typeof m === 'object' && /** @type {{ schema_version?: string, qa_status?: string }} */ (m).schema_version === MANIFEST_SCHEMA_V2) {
    return /** @type {QAStatus} */ (/** @type {{ qa_status: QAStatus }} */ (m).qa_status);
  }
  return /** @type {QAStatus} */ ('pending');
}

/** @param {unknown} m */
export function isImportEligible(m) {
  const status = readQaStatus(m);
  return status === 'pending' || status === 'staging_ok';
}
