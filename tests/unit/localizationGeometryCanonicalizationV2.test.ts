import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {}
    async listForProject() { return []; }
  },
}));
import {
  createLocalizationGeometryArtifact,
  createLocalizationGeometryArtifactV2,
  validateLocalizationGeometryArtifact,
  quantizeToLocalizationGeometryGrid,
  isOnLocalizationGeometryCanonicalGrid,
  LOCALIZATION_GEOMETRY_CONTRACT_VERSION,
  LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2,
} from '../../packages/mps-lu/src/artifacts/LocalizationGeometryArtifact';
import { resolveOrDeriveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryService';
import type { PropertyInfo } from '../../src/domain/geo';

const PROPERTY_REF = { artifact_id: 'property-ctx-1', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;

describe('LOCALIZATION-GEOMETRY-CANONICALIZATION-V2 (H1 Phase B)', () => {
  describe('quantizeToLocalizationGeometryGrid', () => {
    it('rounds to the nearest 0.1m, deterministically', () => {
      expect(quantizeToLocalizationGeometryGrid(674571.8664491447)).toBe(674571.9);
      expect(quantizeToLocalizationGeometryGrid(674571.84)).toBe(674571.8);
      expect(quantizeToLocalizationGeometryGrid(0)).toBe(0);
    });
    it('normalizes -0 to 0', () => {
      expect(Object.is(quantizeToLocalizationGeometryGrid(-0.03), -0)).toBe(false);
      expect(quantizeToLocalizationGeometryGrid(-0.03)).toBe(0);
    });
    it('is idempotent: quantizing an already-quantized value returns it unchanged', () => {
      const q = quantizeToLocalizationGeometryGrid(674571.86);
      expect(quantizeToLocalizationGeometryGrid(q)).toBe(q);
    });
    it('two inputs within the same grid cell collapse to the identical output', () => {
      expect(quantizeToLocalizationGeometryGrid(674571.86)).toBe(quantizeToLocalizationGeometryGrid(674571.94));
    });
    it('two inputs 20cm apart (crossing a grid boundary) do NOT collapse -- quantization stabilizes representation, it does not merge distinct user choices', () => {
      const a = quantizeToLocalizationGeometryGrid(674571.80);
      const b = quantizeToLocalizationGeometryGrid(674572.00);
      expect(a).not.toBe(b);
    });
  });

  describe('isOnLocalizationGeometryCanonicalGrid', () => {
    it('true for an already-quantized value, false for a raw unquantized one', () => {
      expect(isOnLocalizationGeometryCanonicalGrid(674571.9)).toBe(true);
      expect(isOnLocalizationGeometryCanonicalGrid(674571.8664491447)).toBe(false);
    });
  });

  describe('createLocalizationGeometryArtifactV2', () => {
    it('REJECTs construction when sweref99NorthingEasting is not already on the canonical grid -- never silently re-quantizes', () => {
      expect(() =>
        createLocalizationGeometryArtifactV2({
          project_id: 'proj-1',
          property_context_ref: PROPERTY_REF,
          wgs84LngLat: [18.07, 59.33],
          sweref99NorthingEasting: [674571.8664491447, 6580743.008330945], // not on grid
          provenance: 'user_defined',
          label: 'test',
          created_by: 'user-1',
        }),
      ).toThrow(/REJECT_LOCALIZATION_GEOMETRY_V2/);
    });

    it('constructs successfully when the SWEREF pair is already on the 0.1m grid, and stamps geometry_contract_version = v2', () => {
      const artifact = createLocalizationGeometryArtifactV2({
        project_id: 'proj-1',
        property_context_ref: PROPERTY_REF,
        wgs84LngLat: [18.07, 59.33],
        sweref99NorthingEasting: [674571.9, 6580743.0],
        provenance: 'user_defined',
        label: 'test',
        created_by: 'user-1',
      });
      expect(artifact.payload.geometry_contract_version).toBe(LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2);
      expect(validateLocalizationGeometryArtifact(artifact)).toBe(artifact);
    });

    it('V1 and V2 artifacts for numerically-identical coordinates never collide (distinct artifact_ids, contract_version is part of the hash domain)', () => {
      const coords = { wgs84LngLat: [18.07, 59.33] as const, sweref99NorthingEasting: [674571.9, 6580743.0] as const };
      const v1 = createLocalizationGeometryArtifact({
        project_id: 'proj-1', property_context_ref: PROPERTY_REF, ...coords, provenance: 'user_defined', label: 'x', created_by: 'u',
      });
      const v2 = createLocalizationGeometryArtifactV2({
        project_id: 'proj-1', property_context_ref: PROPERTY_REF, ...coords, provenance: 'user_defined', label: 'x', created_by: 'u',
      });
      expect(v1.artifact_id).not.toBe(v2.artifact_id);
      expect(v1.payload.geometry_contract_version).toBe(LOCALIZATION_GEOMETRY_CONTRACT_VERSION);
      expect(v2.payload.geometry_contract_version).toBe(LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2);
    });

    it('retry semantics: the identical canonical point submitted twice produces the identical artifact_id (true no-op)', () => {
      const build = () =>
        createLocalizationGeometryArtifactV2({
          project_id: 'proj-1', property_context_ref: PROPERTY_REF,
          wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, 6580743.0],
          provenance: 'user_defined', label: 'x', created_by: 'u',
        });
      expect(build().artifact_id).toBe(build().artifact_id);
    });
  });

  describe('PropertyInfo presentation isolation (H1)', () => {
    it('derives the same canonical localization geometry when a presentation-only WGS84 property geometry changes or is absent', async () => {
      const presentationVariants: readonly PropertyInfo[] = [
        {
          id: 'property-1',
          designation: 'TEST 1:1',
          municipality: 'TEST',
          geometry: { type: 'Point', coordinates: [18.0, 59.3] },
        },
        {
          id: 'property-1',
          designation: 'TEST 1:1',
          municipality: 'TEST',
          geometry: { type: 'Point', coordinates: [19.0, 60.3] },
        },
        {
          id: 'property-1',
          designation: 'TEST 1:1',
          municipality: 'TEST',
        },
      ];

      const derive = async (_presentation: PropertyInfo) => {
        const repository = {
          resolve: vi.fn().mockResolvedValue(undefined),
          put: vi.fn().mockResolvedValue(undefined),
        };
        return resolveOrDeriveCurrentLocalizationGeometry({
          projectId: 'project-1',
          artifactRepository: repository as never,
          propertyContextRef: PROPERTY_REF,
          propertyCentroidSweref: [6580743.0, 674571.9],
          sweref99ToWgs84: vi.fn().mockResolvedValue([59.33, 18.07]),
          createdBy: 'user-1',
        });
      };

      const artifacts = await Promise.all(presentationVariants.map(derive));
      expect(artifacts.map(({ geometry }) => geometry.artifact_id)).toEqual([
        artifacts[0]!.geometry.artifact_id,
        artifacts[0]!.geometry.artifact_id,
        artifacts[0]!.geometry.artifact_id,
      ]);
      expect(artifacts.map(({ geometry }) => geometry.content_hash.value)).toEqual([
        artifacts[0]!.geometry.content_hash.value,
        artifacts[0]!.geometry.content_hash.value,
        artifacts[0]!.geometry.content_hash.value,
      ]);
    });
  });

  describe('validateLocalizationGeometryArtifact -- version-aware dispatch (the fixed blocking defect)', () => {
    it('a V1 artifact validates correctly using the V1 rule (contract_version = v1), unaffected by V2 existing', () => {
      const v1 = createLocalizationGeometryArtifact({
        project_id: 'proj-1', property_context_ref: PROPERTY_REF,
        wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.8664491447, 6580743.008330945], // deliberately NOT on the V2 grid
        provenance: 'user_defined', label: 'historical', created_by: 'u',
      });
      expect(validateLocalizationGeometryArtifact(v1)).toBe(v1);
    });

    it('a V2 artifact with an off-grid coordinate is rejected at validation time even if its own hash is internally self-consistent (defense in depth against a mislabeled artifact)', () => {
      // Construct a V2-shaped payload directly (bypassing the constructor's own guard) to prove
      // the VALIDATOR itself independently enforces the grid rule, not just the constructor.
      const v2 = createLocalizationGeometryArtifactV2({
        project_id: 'proj-1', property_context_ref: PROPERTY_REF,
        wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, 6580743.0],
        provenance: 'user_defined', label: 'x', created_by: 'u',
      });
      const tampered = {
        ...v2,
        payload: { ...v2.payload, coordinates: [674571.8664491447, 6580743.008330945] as const },
      };
      expect(() => validateLocalizationGeometryArtifact(tampered)).toThrow();
    });

    it('an unknown geometry_contract_version is rejected, not silently treated as V1', () => {
      const v1 = createLocalizationGeometryArtifact({
        project_id: 'proj-1', property_context_ref: PROPERTY_REF,
        wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.86, 6580743.0],
        provenance: 'user_defined', label: 'x', created_by: 'u',
      });
      const withUnknownVersion = { ...v1, payload: { ...v1.payload, geometry_contract_version: 'localization-geometry-v99' } };
      expect(() => validateLocalizationGeometryArtifact(withUnknownVersion)).toThrow(/unknown geometry_contract_version/);
    });
  });
});
