import { describe, expect, it } from 'vitest';

import {
  assertLmByggnaderGpkgInspection,
  assertLmByggnaderPilotAdmission,
  createBuildingFeatureIdentityV1,
  geometryContentHash,
} from '../src/LegacyMasterByggnaderMaterialization';
import type { LegacyMasterAdmissionArtifact } from '../src/LegacyMasterAdmission';

function artifact(overrides: Record<string, unknown> = {}): LegacyMasterAdmissionArtifact {
  return {
    artifact_id: 'legacy-master-admission-test-1762',
    artifact_type: 'LEGACY_MASTER_ADMISSION',
    content_hash: 'a'.repeat(64),
    payload: {
      source_registry_ref: {
        source_id: 'lantmateriet-stac-byggnader',
        registry_artifact_id: 'reg-lantmateriet-stac-byggnader-001',
        source_content_hash: 'b'.repeat(64),
      },
      local_object_ref: {
        path: 'H:/master/1762.zip',
        filename: '1762.zip',
        size_bytes: 609654,
        sha256: 'c'.repeat(64),
      },
      current_byte_observation_ref: `sha256:${'c'.repeat(64)}`,
      content_family: 'LANTMATERIET_STAC_BYGGNADER',
      municipality_id: '1762',
      internal_asset_name: 'byggnad_kn1762.gpkg',
      media_type: 'application/zip',
      historical_acquisition: {
        status: 'UNKNOWN',
        source_url: null,
        item_updated: null,
        retrieved_at: null,
        manifest_ref: null,
        quarantine_ref: null,
      },
      reconciliation_basis: {
        filename_structure: 'NNNN.zip',
        internal_asset_name: 'byggnad_kn1762.gpkg',
        required_schema_fields: ['objektidentitet', 'geometri'],
        crs: 'EPSG:3006',
        geometry_type: 'MULTIPOLYGON',
      },
      admission_mode: 'LEGACY_MASTER_RECONCILIATION_V1',
      admitted_at: '2026-08-20T12:00:00.000Z',
      ...overrides,
    },
    admission_attestation: {} as LegacyMasterAdmissionArtifact['admission_attestation'],
  };
}

const OGR_INFO = `
Layer name: byggnad
Geometry: Multi Polygon
Feature Count: 5313
    ID["EPSG",3006]]
Geometry Column = geometri
objektidentitet: String (0.0)
`;

describe('TOPO10-BUILDING-MATERIALIZATION-PILOT-1762', () => {
  it('accepts only the exact LM admission and preserves explicit unknown historic provenance', () => {
    expect(assertLmByggnaderPilotAdmission(artifact())).toEqual({
      governance_admission_artifact_id: 'legacy-master-admission-test-1762',
      source_registry_artifact_id: 'reg-lantmateriet-stac-byggnader-001',
      admitted_byte_sha256: 'c'.repeat(64),
      admission_mode: 'LEGACY_MASTER_RECONCILIATION_V1',
      historical_acquisition_status: 'UNKNOWN',
    });
  });

  it('rejects a different municipality, authority, or invented historical metadata', () => {
    expect(() => assertLmByggnaderPilotAdmission(artifact({ municipality_id: '1763' }))).toThrow(
      'REJECT_MUNICIPALITY',
    );
    expect(() =>
      assertLmByggnaderPilotAdmission(
        artifact({
          source_registry_ref: {
            ...artifact().payload.source_registry_ref,
            registry_artifact_id: 'another-authority',
          },
        }),
      ),
    ).toThrow('REJECT_SOURCE_AUTHORITY');
    expect(() =>
      assertLmByggnaderPilotAdmission(
        artifact({
          historical_acquisition: {
            ...artifact().payload.historical_acquisition,
            retrieved_at: '2026-01-01T00:00:00.000Z',
          },
        }),
      ),
    ).toThrow('REJECT_HISTORICAL_PROVENANCE');
  });

  it('requires the exact GPKG layer, CRS, geometry, feature count, and identity field', () => {
    expect(() => assertLmByggnaderGpkgInspection(OGR_INFO)).not.toThrow();
    expect(() =>
      assertLmByggnaderGpkgInspection(OGR_INFO.replace('Feature Count: 5313', 'Feature Count: 5312')),
    ).toThrow('REJECT_GPKG_CONTRACT');
    expect(() => assertLmByggnaderGpkgInspection(OGR_INFO.replace('objektidentitet', 'other'))).toThrow(
      'REJECT_GPKG_CONTRACT',
    );
  });

  it('scopes each feature part to object id, source fid, admitted bytes, and an explicit version', () => {
    const base = {
      source_object_id: 'building-object',
      source_part_key: 42,
      admitted_byte_sha256: 'a'.repeat(64),
    };
    const first = createBuildingFeatureIdentityV1(base);
    expect(createBuildingFeatureIdentityV1(base)).toEqual(first);
    expect(createBuildingFeatureIdentityV1({ ...base, source_part_key: 43 }).feature_ref).not.toBe(
      first.feature_ref,
    );
    expect(
      createBuildingFeatureIdentityV1({ ...base, admitted_byte_sha256: 'b'.repeat(64) }).feature_ref,
    ).not.toBe(first.feature_ref);
    expect(() => createBuildingFeatureIdentityV1({ ...base, source_part_key: '' })).toThrow(
      'REJECT_BUILDING_FEATURE_IDENTITY',
    );
  });

  it('uses normalized geometry bytes only as a replay checksum', () => {
    expect(geometryContentHash(new Uint8Array([1, 2, 3]))).toBe(
      geometryContentHash(new Uint8Array([1, 2, 3])),
    );
    expect(geometryContentHash(new Uint8Array([1, 2, 3]))).not.toBe(
      geometryContentHash(new Uint8Array([1, 2, 4])),
    );
  });
});
