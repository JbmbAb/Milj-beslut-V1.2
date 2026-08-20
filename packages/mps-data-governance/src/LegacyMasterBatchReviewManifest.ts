import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';

import type { VerifiedSourceDefinition } from './SourceRegistry';

export const LEGACY_MASTER_BATCH_REVIEW_MANIFEST_VERSION =
  'lm-byggnader-legacy-master-batch-review-manifest-v1' as const;
export const EXPECTED_LEGACY_MASTER_BATCH_COUNT = 289 as const;

export interface LegacyMasterPrecheckEntry {
  readonly municipality_id: string;
  readonly status: 'PROVEN' | 'FAILED_CLOSED';
  readonly sha256?: string;
  readonly size_bytes?: number;
  readonly schema_check?: {
    readonly layer: 'byggnad';
    readonly geometry: 'MULTIPOLYGON';
    readonly crs: 'EPSG:3006';
    readonly required_fields: readonly ['objektidentitet', 'geometri'];
  };
}

export interface LegacyMasterBatchReviewInput {
  readonly checkpoint_sha256: string;
  readonly master_root: string;
  readonly source: VerifiedSourceDefinition;
  readonly entries: readonly LegacyMasterPrecheckEntry[];
  /** Observed again at review time, so a changed Master object cannot reuse a checkpoint. */
  readonly current_objects: ReadonlyMap<string, { readonly path: string; readonly size_bytes: number; readonly sha256: string }>;
}

export interface LegacyMasterBatchReviewEntry {
  readonly municipality_id: string;
  readonly draft_admission: {
    readonly source_registry_ref: {
      readonly source_id: 'lantmateriet-stac-byggnader';
      readonly registry_artifact_id: string;
      readonly source_content_hash: string;
    };
    readonly local_object_ref: {
      readonly path: string;
      readonly filename: string;
      readonly size_bytes: number;
      readonly sha256: string;
    };
    readonly current_byte_observation_ref: string;
    readonly content_family: 'LANTMATERIET_STAC_BYGGNADER';
    readonly municipality_id: string;
    readonly internal_asset_name: string;
    readonly media_type: 'application/zip';
    readonly historical_acquisition: {
      readonly status: 'UNKNOWN';
      readonly source_url: null;
      readonly item_updated: null;
      readonly retrieved_at: null;
      readonly manifest_ref: null;
      readonly quarantine_ref: null;
    };
    readonly reconciliation_basis: {
      readonly filename_structure: 'NNNN.zip';
      readonly internal_asset_name: string;
      readonly required_schema_fields: readonly ['objektidentitet', 'geometri'];
      readonly crs: 'EPSG:3006';
      readonly geometry_type: 'MULTIPOLYGON';
    };
    readonly admission_mode: 'LEGACY_MASTER_RECONCILIATION_V1';
    /** Admission time belongs to the later owner signing act, not this unsigned review. */
    readonly admitted_at: null;
  };
}

export interface LegacyMasterBatchReviewManifest {
  readonly manifest_version: typeof LEGACY_MASTER_BATCH_REVIEW_MANIFEST_VERSION;
  readonly checkpoint_sha256: string;
  readonly source_registry_ref: LegacyMasterBatchReviewEntry['draft_admission']['source_registry_ref'];
  readonly item_count: typeof EXPECTED_LEGACY_MASTER_BATCH_COUNT;
  readonly excluded_existing_admission_municipality_ids: readonly ['1762'];
  readonly entries: readonly LegacyMasterBatchReviewEntry[];
  readonly manifest_sha256: string;
}

export class LegacyMasterBatchReviewManifestError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = 'LegacyMasterBatchReviewManifestError';
  }
}

function reject(reasonCode: string, message: string): never {
  throw new LegacyMasterBatchReviewManifestError(`${reasonCode}: ${message}`, reasonCode);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSha256(value: string | undefined, field: string): string {
  const normalized = value?.trim().toLowerCase().replace(/^sha256:/, '') ?? '';
  if (!/^[a-f0-9]{64}$/.test(normalized)) reject('REJECT_CHECKPOINT_BINDING', `${field} must be a SHA-256 hex digest.`);
  return normalized;
}

function assertSource(source: VerifiedSourceDefinition): void {
  if (source.sourceId !== 'lantmateriet-stac-byggnader' || source.adapter !== 'LM_STAC_BYGGNADER_V1') {
    reject('REJECT_SOURCE_FAMILY', 'review manifest is restricted to verified Lantmateriet STAC byggnader authority.');
  }
}

function contentWithoutDigest(manifest: Omit<LegacyMasterBatchReviewManifest, 'manifest_sha256'>): Omit<LegacyMasterBatchReviewManifest, 'manifest_sha256'> {
  return manifest;
}

export function buildLegacyMasterBatchReviewManifest(input: LegacyMasterBatchReviewInput): LegacyMasterBatchReviewManifest {
  assertSource(input.source);
  const checkpointSha = normalizeSha256(input.checkpoint_sha256, 'checkpoint_sha256');
  if (input.entries.length !== EXPECTED_LEGACY_MASTER_BATCH_COUNT) {
    reject('REJECT_BATCH_SCOPE', `expected ${EXPECTED_LEGACY_MASTER_BATCH_COUNT} checkpoint entries, got ${input.entries.length}.`);
  }

  const municipalities = new Set<string>();
  const entries = [...input.entries]
    .sort((left, right) => left.municipality_id.localeCompare(right.municipality_id))
    .map((entry): LegacyMasterBatchReviewEntry => {
      if (!/^\d{4}$/.test(entry.municipality_id) || entry.municipality_id === '1762') {
        reject('REJECT_MUNICIPALITY_BINDING', 'every review municipality must be NNNN and exclude already-admitted 1762.');
      }
      if (municipalities.has(entry.municipality_id)) {
        reject('REJECT_BATCH_SCOPE', `duplicate municipality ${entry.municipality_id} in checkpoint.`);
      }
      municipalities.add(entry.municipality_id);
      if (entry.status !== 'PROVEN') {
        reject('REJECT_PRECHECK_STATUS', `municipality ${entry.municipality_id} is ${entry.status}, not PROVEN.`);
      }
      const checkpointHash = normalizeSha256(entry.sha256, `checkpoint SHA for ${entry.municipality_id}`);
      if (!Number.isSafeInteger(entry.size_bytes) || (entry.size_bytes ?? 0) <= 0) {
        reject('REJECT_CHECKPOINT_BINDING', `municipality ${entry.municipality_id} has no valid checkpoint size.`);
      }
      const schema = entry.schema_check;
      if (
        schema?.layer !== 'byggnad' || schema.geometry !== 'MULTIPOLYGON' || schema.crs !== 'EPSG:3006' ||
        schema.required_fields[0] !== 'objektidentitet' || schema.required_fields[1] !== 'geometri'
      ) {
        reject('REJECT_GPKG_CONTRACT', `municipality ${entry.municipality_id} lacks the frozen building schema check.`);
      }
      const current = input.current_objects.get(entry.municipality_id);
      if (!current || !current.path.endsWith(`\\${entry.municipality_id}.zip`)) {
        reject('REJECT_LOCAL_OBJECT', `municipality ${entry.municipality_id} has no exact Master ZIP at its expected path.`);
      }
      if (current.size_bytes !== entry.size_bytes || normalizeSha256(current.sha256, `current SHA for ${entry.municipality_id}`) !== checkpointHash) {
        reject('REJECT_CHECKPOINT_BINDING', `municipality ${entry.municipality_id} bytes changed after precheck.`);
      }
      const filename = `${entry.municipality_id}.zip`;
      const source_registry_ref = {
        source_id: 'lantmateriet-stac-byggnader' as const,
        registry_artifact_id: input.source.registryArtifactId,
        source_content_hash: input.source.sourceContentHash,
      };
      const internal_asset_name = `byggnad_kn${entry.municipality_id}.gpkg`;
      return {
        municipality_id: entry.municipality_id,
        draft_admission: {
          source_registry_ref,
          local_object_ref: { path: current.path, filename, size_bytes: current.size_bytes, sha256: checkpointHash },
          current_byte_observation_ref: `sha256:${checkpointHash}`,
          content_family: 'LANTMATERIET_STAC_BYGGNADER',
          municipality_id: entry.municipality_id,
          internal_asset_name,
          media_type: 'application/zip',
          historical_acquisition: {
            status: 'UNKNOWN', source_url: null, item_updated: null, retrieved_at: null, manifest_ref: null, quarantine_ref: null,
          },
          reconciliation_basis: {
            filename_structure: 'NNNN.zip', internal_asset_name, required_schema_fields: ['objektidentitet', 'geometri'],
            crs: 'EPSG:3006', geometry_type: 'MULTIPOLYGON',
          },
          admission_mode: 'LEGACY_MASTER_RECONCILIATION_V1',
          admitted_at: null,
        },
      };
    });

  const unsigned = {
    manifest_version: LEGACY_MASTER_BATCH_REVIEW_MANIFEST_VERSION,
    checkpoint_sha256: checkpointSha,
    source_registry_ref: {
      source_id: 'lantmateriet-stac-byggnader' as const,
      registry_artifact_id: input.source.registryArtifactId,
      source_content_hash: input.source.sourceContentHash,
    },
    item_count: EXPECTED_LEGACY_MASTER_BATCH_COUNT,
    excluded_existing_admission_municipality_ids: ['1762'] as const,
    entries,
  } satisfies Omit<LegacyMasterBatchReviewManifest, 'manifest_sha256'>;
  return { ...unsigned, manifest_sha256: sha256(canonicalizeStrict(contentWithoutDigest(unsigned))) };
}
