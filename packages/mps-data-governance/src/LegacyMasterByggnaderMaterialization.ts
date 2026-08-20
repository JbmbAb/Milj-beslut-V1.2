import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';

import { LEGACY_MASTER_ADMISSION_MODE, type LegacyMasterAdmissionArtifact } from './LegacyMasterAdmission';

export const LM_BYGGNADER_PILOT_MUNICIPALITY = '1762' as const;
export const LM_BYGGNADER_PILOT_FEATURE_COUNT = 5313 as const;
export const BUILDING_FEATURE_IDENTITY_VERSION = 'V1' as const;
export const BUILDING_FEATURE_LAYER_ID = 'topo10-building' as const;

export interface LegacyMasterBuildingMaterializationProvenance {
  readonly governance_admission_artifact_id: string;
  readonly source_registry_artifact_id: string;
  readonly admitted_byte_sha256: string;
  readonly admission_mode: typeof LEGACY_MASTER_ADMISSION_MODE;
  readonly historical_acquisition_status: 'UNKNOWN';
}

/** A source-version-scoped identity, never a claim of permanent physical-building identity. */
export interface BuildingFeatureIdentityV1 {
  readonly layer_id: typeof BUILDING_FEATURE_LAYER_ID;
  readonly source_object_id: string;
  readonly source_part_key: string;
  readonly identity_scope: string;
  readonly identity_version: typeof BUILDING_FEATURE_IDENTITY_VERSION;
  readonly feature_ref: string;
}

export class LegacyMasterBuildingMaterializationError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = 'LegacyMasterBuildingMaterializationError';
  }
}

function reject(reasonCode: string, message: string): never {
  throw new LegacyMasterBuildingMaterializationError(`${reasonCode}: ${message}`, reasonCode);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) reject('REJECT_BUILDING_FEATURE_IDENTITY', `${field} is required.`);
  return normalized;
}

/**
 * `fid` is source-native only within this exact admitted GPKG. The admitted content hash scopes
 * it, so a later source release intentionally receives new feature refs even if a row number is
 * reused. Geometry is deliberately excluded from identity and recorded as a replay checksum.
 */
export function createBuildingFeatureIdentityV1(args: {
  readonly source_object_id: string;
  readonly source_part_key: string | number;
  readonly admitted_byte_sha256: string;
}): BuildingFeatureIdentityV1 {
  const source_object_id = requiredText(args.source_object_id, 'source_object_id');
  const source_part_key = requiredText(String(args.source_part_key), 'source_part_key');
  const admitted_byte_sha256 = requiredText(args.admitted_byte_sha256, 'admitted_byte_sha256').replace(
    /^sha256:/,
    '',
  );
  if (!/^[a-f0-9]{64}$/i.test(admitted_byte_sha256)) {
    reject('REJECT_BUILDING_FEATURE_IDENTITY', 'admitted_byte_sha256 must be a SHA-256 digest.');
  }
  const canonical = canonicalizeStrict({
    layer_id: BUILDING_FEATURE_LAYER_ID,
    source_object_id,
    source_part_key,
    identity_scope: `sha256:${admitted_byte_sha256.toLowerCase()}`,
    identity_version: BUILDING_FEATURE_IDENTITY_VERSION,
  });
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return {
    layer_id: BUILDING_FEATURE_LAYER_ID,
    source_object_id,
    source_part_key,
    identity_scope: `sha256:${admitted_byte_sha256.toLowerCase()}`,
    identity_version: BUILDING_FEATURE_IDENTITY_VERSION,
    feature_ref: `topo10:byggnad:sha256:${digest}`,
  };
}

export function geometryContentHash(normalizedGeometryWkb: Uint8Array): string {
  if (normalizedGeometryWkb.byteLength === 0) {
    reject('REJECT_GEOMETRY_CONTENT', 'normalized geometry bytes are required.');
  }
  return createHash('sha256').update(normalizedGeometryWkb).digest('hex');
}

/**
 * The materializer consumes a resolved, already verified legacy admission. It deliberately does
 * not take a filename, SourceRegistry id, manifest, quarantine record, or network URL as input.
 */
export function assertLmByggnaderPilotAdmission(
  artifact: LegacyMasterAdmissionArtifact,
): LegacyMasterBuildingMaterializationProvenance {
  const payload = artifact.payload;
  if (payload.municipality_id !== LM_BYGGNADER_PILOT_MUNICIPALITY) {
    reject('REJECT_MUNICIPALITY', 'this bounded materialization unit admits municipality 1762 only.');
  }
  if (payload.internal_asset_name !== 'byggnad_kn1762.gpkg') {
    reject('REJECT_INTERNAL_ASSET', 'the admitted object must bind byggnad_kn1762.gpkg.');
  }
  if (
    payload.source_registry_ref.source_id !== 'lantmateriet-stac-byggnader' ||
    payload.source_registry_ref.registry_artifact_id !== 'reg-lantmateriet-stac-byggnader-001'
  ) {
    reject('REJECT_SOURCE_AUTHORITY', 'the pilot accepts only the installed LM byggnader authority.');
  }
  if (payload.admission_mode !== LEGACY_MASTER_ADMISSION_MODE) {
    reject('REJECT_ADMISSION_MODE', 'the pilot requires LEGACY_MASTER_RECONCILIATION_V1.');
  }
  const historical = payload.historical_acquisition;
  if (
    historical.status !== 'UNKNOWN' ||
    historical.source_url !== null ||
    historical.item_updated !== null ||
    historical.retrieved_at !== null ||
    historical.manifest_ref !== null ||
    historical.quarantine_ref !== null
  ) {
    reject('REJECT_HISTORICAL_PROVENANCE', 'the materialization must preserve unknown historic acquisition.');
  }
  return {
    governance_admission_artifact_id: artifact.artifact_id,
    source_registry_artifact_id: payload.source_registry_ref.registry_artifact_id,
    admitted_byte_sha256: payload.local_object_ref.sha256,
    admission_mode: LEGACY_MASTER_ADMISSION_MODE,
    historical_acquisition_status: 'UNKNOWN',
  };
}

export function assertLmByggnaderGpkgInspection(ogrInfo: string): void {
  const expected: ReadonlyArray<readonly [RegExp, string]> = [
    [/Layer name:\s*byggnad/i, 'layer byggnad'],
    [/Geometry:\s*Multi Polygon/i, 'Multi Polygon geometry'],
    [/Feature Count:\s*5313/i, '5313 features'],
    [/EPSG",3006/i, 'EPSG:3006'],
    [/Geometry Column\s*=\s*geometri/i, 'geometri geometry column'],
    [/objektidentitet\s*:/i, 'objektidentitet field'],
  ];
  const missing = expected.filter(([pattern]) => !pattern.test(ogrInfo)).map(([, label]) => label);
  if (missing.length > 0) {
    reject('REJECT_GPKG_CONTRACT', `admitted GPKG inspection is missing: ${missing.join(', ')}.`);
  }
}
