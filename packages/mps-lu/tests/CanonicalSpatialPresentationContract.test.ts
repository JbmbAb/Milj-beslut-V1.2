import { describe, it, expect, beforeAll } from 'vitest';
import { ViewerKernel } from '../src/viewer/ViewerKernel';
import { buildAdmittedViewerCapability } from './fixtures/admittedViewerCapability';
import { MimersIntegration } from '../../mps-runtime/src/mimers';
import type { SpatialEvidenceArtifact } from '../src/artifacts/SpatialEvidenceArtifact';
import { SPATIAL_STACK_V1 } from '../src/artifacts/SpatialEngineFingerprint';
import {
  SPATIAL_RESULT_SEMANTICS_POLICY_V1,
  isAdmittedSemanticsKind,
} from '../src/artifacts/SpatialResultSemantics';
import { transformGeometryToWgs84 } from '../src/viewer/GeoJsonCoordinateTransform';
import {
  CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_SRID,
  assertCanonicalPresentationCollection,
  assertCanonicalPresentationFeature,
  presentationModeForGeometry,
  unknownPresentation3D,
} from '../src/viewer/CanonicalSpatialPresentationContract';
import {
  DEFAULT_PRESENTATION_FEATURE_BUDGET,
  SpatialPresentationError,
  assertNotStalePresentationResponse,
  enforceFeatureBudget,
  httpStatusForPresentationError,
  isStalePresentationResponse,
  parsePresentationBoundingBox,
} from '../src/viewer/SpatialPresentationRequest';

/**
 * CESIUM-CANONICAL-SPATIAL-PRESENTATION-3D-V1.
 *
 * These tests pin the convergence of three previously-disagreeing presentation shapes onto one
 * contract. The single most important assertion in the file is that a governed projection with
 * `geometry: null` is VALID: the superseded ungoverned validator required non-null geometry and
 * therefore rejected the governed path's own output, which is what let two incompatible contracts
 * coexist. The second most important is that nothing is synthesized -- no fabricated geometry, no
 * fabricated measured distance, no defaulted height.
 */

const SWEREF99TM = 3006;

function evidenceArtifact(overrides: {
  artifact_id: string;
  geometry: SpatialEvidenceArtifact['payload']['geometry'];
  srid: number;
  layerId?: string;
  distanceMeters?: number;
}): SpatialEvidenceArtifact {
  const hasGeometry = overrides.geometry !== null;
  return {
    artifact_id: overrides.artifact_id,
    artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: { algorithm: 'sha256', value: `hash-${overrides.artifact_id}` },
    references: [{ artifact_id: 'prop-1', artifact_type: 'PROPERTY' }],
    payload: {
      result_semantics: {
        kind: 'EXISTENCE_WITHIN_DISTANCE',
        query: {
          subject_ref: { artifact_id: 'prop-1', artifact_type: 'PROPERTY' },
          srid: overrides.srid,
          distance_meters: overrides.distanceMeters ?? 500,
        },
        result: {
          exists: hasGeometry,
          match_count_observed: hasGeometry ? 1 : 0,
          max_features_per_layer: 50,
        },
      },
      property_ref: { artifact_id: 'prop-1', artifact_type: 'PROPERTY' },
      geometry: overrides.geometry,
      srid: overrides.srid,
      operation: {
        algorithm: 'spatial.dwithin_existence',
        engine: 'PostGIS',
        engine_fingerprint: SPATIAL_STACK_V1,
      },
      layer_ref: {
        layer_id: overrides.layerId ?? 'water',
        version_hash: 'layer-version-hash-abc',
        layer_version: 'v1.2.3',
      },
      source_metadata: {
        provider: 'SGU',
        dataset: 'water',
        dataset_version: 'dataset-version-xyz',
        retrieved_at: '2026-01-15T10:00:00.000Z',
      },
      query_context: {
        query_id: 'q1',
        query_type: 'SPATIAL_DWITHIN',
        parameters: {
          property_ref: { artifact_id: 'prop-1', artifact_type: 'PROPERTY' },
          search_distance_meters: 500,
        },
      },
    },
  } as unknown as SpatialEvidenceArtifact;
}

describe('CESIUM-CANONICAL-PRESENTATION: governed projection through ViewerKernel', () => {
  let viewer: ViewerKernel;
  let casRepo: any;

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;
    viewer = new ViewerKernel(casRepo, buildAdmittedViewerCapability('canonical-presentation'));
  });

  async function project(artifact: SpatialEvidenceArtifact) {
    await casRepo.put({
      artifact_id: artifact.artifact_id,
      content_hash: artifact.content_hash,
      body: artifact,
    });
    return viewer.exportAsGeoJSON([artifact.artifact_id]);
  }

  it('emits a collection that satisfies the canonical contract validator', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-contract-1', geometry: null, srid: SWEREF99TM }),
    );
    expect(assertCanonicalPresentationCollection(collection)).toEqual([]);
    expect(collection.presentation_contract_version).toBe(CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION);
  });

  it('a geometry:null observation is VALID -- the case the superseded validator rejected', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-null-valid', geometry: null, srid: SWEREF99TM }),
    );
    const feature = collection.features[0]!;
    expect(feature.geometry).toBeNull();
    expect(assertCanonicalPresentationFeature(feature)).toEqual([]);
    expect(feature.properties.presentation_mode).toBe('NON_GEOMETRIC_SPATIAL_OBSERVATION');
  });

  it('preserves layer identity: layer_id, version_hash and the human layer_version', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-layer', geometry: null, srid: SWEREF99TM, layerId: 'ebh' }),
    );
    const properties = collection.features[0]!.properties;
    expect(properties.layer_id).toBe('ebh');
    expect(properties.layer_version_hash).toBe('layer-version-hash-abc');
    expect(properties.layer_version).toBe('v1.2.3');
  });

  it('propagates provider, dataset_version and retrieved_at -- the fields the panel rendered as a dash', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-provenance', geometry: null, srid: SWEREF99TM }),
    );
    const properties = collection.features[0]!.properties;
    expect(properties.provider).toBe('SGU');
    expect(properties.dataset).toBe('water');
    expect(properties.dataset_version).toBe('dataset-version-xyz');
    expect(properties.retrieved_at).toBe('2026-01-15T10:00:00.000Z');
    // The pre-existing key keeps working for viewer code owned by the other lane.
    expect(properties.version).toBe('dataset-version-xyz');
  });

  it('preserves canonical evidence identity (artifact id + content hash) and its alias', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-identity', geometry: null, srid: SWEREF99TM }),
    );
    const properties = collection.features[0]!.properties;
    expect(properties.cas_artifact_id).toBe('ev-identity');
    expect(properties.cas_content_hash).toBe('hash-ev-identity');
    expect(properties.evidence_id).toBe('ev-identity');
    expect(properties.governance_status).toBe('VERIFIED_OBSERVATION');
  });

  it('distance is the QUERY BUFFER and is never presented as a measured distance', async () => {
    const collection = await project(
      evidenceArtifact({
        artifact_id: 'ev-distance',
        geometry: null,
        srid: SWEREF99TM,
        distanceMeters: 500,
      }),
    );
    const properties = collection.features[0]!.properties;
    expect(properties.distance_meters).toBe(500);
    // Same value under a name that cannot be misread as "500 m to the feature".
    expect(properties.query_distance_meters).toBe(500);
    // ADR section 2's "183 m" measured distance is NOT manufactured by presentation.
    expect(properties).not.toHaveProperty('measured_distance_meters');
  });

  /**
   * LOAD-BEARING ARCHITECTURAL FACT, pinned deliberately.
   *
   * SPATIAL_RESULT_SEMANTICS_POLICY_V1 admits exactly one kind, EXISTENCE_WITHIN_DISTANCE, and
   * that kind SHALL carry no geometry (assertGeometryMatchesSemantics). FEATURE_GEOMETRY is named
   * in the vocabulary but NOT admitted. So the governed presentation path emits `geometry: null`
   * for every feature it can currently produce -- the viewer renders no evidence geometry not
   * because presentation is broken but because no admitted semantics carries any.
   *
   * The contract below therefore supports GEOMETRIC_SPATIAL_OBSERVATION for the day
   * FEATURE_GEOMETRY is admitted, while this test pins that the day has not arrived and that
   * ViewerKernel refuses fabricated geometry in the meantime.
   */
  it('refuses fabricated geometry under v1 semantics -- geometry is always null on the governed path', async () => {
    const artifact = evidenceArtifact({
      artifact_id: 'ev-fabricated-geom',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [500000, 6800000],
            [500100, 6800000],
            [500100, 6800100],
            [500000, 6800000],
          ],
        ],
      } as SpatialEvidenceArtifact['payload']['geometry'],
      srid: SWEREF99TM,
    });
    await casRepo.put({
      artifact_id: artifact.artifact_id,
      content_hash: artifact.content_hash,
      body: artifact,
    });
    await expect(viewer.exportAsGeoJSON([artifact.artifact_id])).rejects.toThrow(/REJECT_SPATIAL_SEMANTICS/);
  });

  it('admits only EXISTENCE_WITHIN_DISTANCE in v1, so FEATURE_GEOMETRY cannot be produced', () => {
    expect(SPATIAL_RESULT_SEMANTICS_POLICY_V1.admitted_kinds).toEqual(['EXISTENCE_WITHIN_DISTANCE']);
    expect(isAdmittedSemanticsKind('FEATURE_GEOMETRY')).toBe(false);
  });

  it('transforms EPSG:3006 to real WGS84 degrees at the one canonical transform boundary', () => {
    // Tested against the pure boundary function rather than through ViewerKernel, because no
    // admitted v1 semantics can carry the geometry that would exercise it end to end.
    const transformed = transformGeometryToWgs84(
      {
        type: 'Polygon',
        coordinates: [
          [
            [500000, 6800000],
            [500100, 6800000],
            [500100, 6800100],
            [500000, 6800000],
          ],
        ],
      } as any,
      SWEREF99TM,
    );
    // Central Sweden: roughly 15E / 61.3N. Must be real degrees, not passed-through metres.
    const [lng, lat] = (transformed as any).coordinates[0][0];
    expect(lng).toBeGreaterThan(14);
    expect(lng).toBeLessThan(16);
    expect(lat).toBeGreaterThan(60);
    expect(lat).toBeLessThan(62);
  });

  it('fails closed on an SRID with no known projection rather than mis-projecting', () => {
    expect(() => transformGeometryToWgs84({ type: 'Point', coordinates: [1, 2] } as any, 31370)).toThrow(
      /REJECT_GEOJSON_COORDINATE_TRANSFORM/,
    );
  });

  it('emits an all-unknown 3D block: nothing is defaulted to zero and nothing is synthesized', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-3d', geometry: null, srid: SWEREF99TM }),
    );
    const threeD = collection.features[0]!.properties.three_d;
    expect(threeD).toEqual(unknownPresentation3D());
    expect(threeD.building_height_m).toBeNull();
    expect(threeD.ground_elevation_m).toBeNull();
    expect(threeD.height_provenance).toBeNull();
    // A 3D model reference is optional and must be absent when no governed derivation exists.
    expect(collection.features[0]!.properties.three_d_model).toBeUndefined();
  });

  it('keeps presentation style hints segregated from authority fields', async () => {
    const collection = await project(
      evidenceArtifact({ artifact_id: 'ev-style', geometry: null, srid: SWEREF99TM }),
    );
    const properties = collection.features[0]!.properties;
    expect(properties.style.color).toMatch(/^#/);
    expect(properties.style.title).toContain('Evidens');
    // Style must not leak into the top level where it could be mistaken for governed data.
    expect(properties).not.toHaveProperty('color');
  });
});

describe('CESIUM-CANONICAL-PRESENTATION: contract validator', () => {
  function validFeature(geometry: unknown = null) {
    return {
      type: 'Feature' as const,
      id: 'ev-1',
      geometry,
      properties: {
        presentation_contract_version: CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION,
        cas_artifact_id: 'ev-1',
        cas_content_hash: 'hash-1',
        evidence_id: 'ev-1',
        provider: 'SGU',
        dataset: 'water',
        version: 'v1',
        dataset_version: 'v1',
        retrieved_at: '2026-01-15T10:00:00.000Z',
        engine: 'PostGIS',
        algorithm: 'spatial.dwithin_existence',
        result_semantics_kind: 'EXISTENCE_WITHIN_DISTANCE',
        exists: true,
        distance_meters: 500,
        query_distance_meters: 500,
        match_count_observed: 1,
        max_features_per_layer: 50,
        subject_artifact_id: 'prop-1',
        layer_id: 'water',
        layer_version_hash: 'lvh',
        layer_version: 'v1',
        governance_status: 'VERIFIED_OBSERVATION',
        viewer_capability_id: 'cap-1',
        viewer_release_hash: 'rel-1',
        viewer_identity_ref: 'vid-1',
        presentation_srid: PRESENTATION_SRID,
        presentation_mode: presentationModeForGeometry(geometry as null),
        style: { color: '#3b82f6', title: 'T', description: 'D' },
        three_d: unknownPresentation3D(),
      },
    };
  }

  it('accepts a valid null-geometry feature', () => {
    expect(assertCanonicalPresentationFeature(validFeature(null))).toEqual([]);
  });

  it('rejects a missing provenance field rather than rendering a blank panel', () => {
    const feature = validFeature(null);
    (feature.properties as any).cas_content_hash = '';
    expect(assertCanonicalPresentationFeature(feature)).toContain('properties.cas_content_hash is required');
  });

  it('rejects a governance_status other than VERIFIED_OBSERVATION', () => {
    const feature = validFeature(null);
    (feature.properties as any).governance_status = 'AUTHORITATIVE';
    expect(assertCanonicalPresentationFeature(feature)).toContain(
      'properties.governance_status must be VERIFIED_OBSERVATION',
    );
  });

  it('rejects a presentation_mode that contradicts the geometry actually present', () => {
    const feature = validFeature(null);
    (feature.properties as any).presentation_mode = 'GEOMETRIC_SPATIAL_OBSERVATION';
    expect(assertCanonicalPresentationFeature(feature)).toContain(
      'properties.presentation_mode must be NON_GEOMETRIC_SPATIAL_OBSERVATION for this geometry',
    );
  });

  it('rejects source_srid on a null geometry -- that would claim a projection that never happened', () => {
    const feature = validFeature(null);
    (feature.properties as any).source_srid = 3006;
    expect(assertCanonicalPresentationFeature(feature)).toContain(
      'properties.source_srid must be absent when geometry is null',
    );
  });

  it('requires source_srid when geometry IS present', () => {
    const feature = validFeature({ type: 'Point', coordinates: [15, 61] });
    expect(assertCanonicalPresentationFeature(feature)).toContain(
      'properties.source_srid is required when geometry is present',
    );
  });

  it('rejects a height with no stated provenance -- a fallback must never read as measurement', () => {
    const feature = validFeature(null);
    (feature.properties as any).three_d = { ...unknownPresentation3D(), building_height_m: 12 };
    expect(assertCanonicalPresentationFeature(feature)).toContain(
      'properties.three_d.height_provenance is required when any height is present',
    );
  });

  it('accepts a height that declares itself a presentation fallback', () => {
    const feature = validFeature(null);
    (feature.properties as any).three_d = {
      ...unknownPresentation3D(),
      building_height_m: 12,
      height_provenance: 'PRESENTATION_FALLBACK',
    };
    expect(assertCanonicalPresentationFeature(feature)).toEqual([]);
  });

  it('reports per-feature errors with their index at collection level', () => {
    const bad = validFeature(null);
    (bad.properties as any).dataset = '';
    const errors = assertCanonicalPresentationCollection({
      type: 'FeatureCollection',
      presentation_contract_version: CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION,
      features: [validFeature(null), bad],
    });
    expect(errors).toContain('features[1]: properties.dataset is required');
  });
});

describe('CESIUM-CANONICAL-PRESENTATION: bounds, budget and error model', () => {
  const validBbox = {
    minEasting: 400_000,
    minNorthing: 6_700_000,
    maxEasting: 410_000,
    maxNorthing: 6_710_000,
  };

  it('accepts a well-formed SWEREF99 TM viewport', () => {
    expect(parsePresentationBoundingBox(validBbox)).toEqual({ ...validBbox, srid: 3006 });
  });

  it('rejects an inverted or degenerate box', () => {
    expect(() => parsePresentationBoundingBox({ ...validBbox, maxEasting: validBbox.minEasting })).toThrow(
      SpatialPresentationError,
    );
  });

  it('rejects degrees supplied where metres were required -- the classic unit confusion', () => {
    expect(() =>
      parsePresentationBoundingBox({
        minEasting: 14.6,
        minNorthing: 61.1,
        maxEasting: 14.7,
        maxNorthing: 61.2,
      }),
    ).toThrow(/INVALID_BOUNDS/);
  });

  it('rejects a viewport large enough to be a national table scan', () => {
    expect(() =>
      parsePresentationBoundingBox({
        minEasting: 300_000,
        minNorthing: 6_200_000,
        maxEasting: 900_000,
        maxNorthing: 6_900_000,
      }),
    ).toThrow(/INVALID_BOUNDS/);
  });

  it('rejects a bbox declared in a CRS other than the canonical query CRS', () => {
    expect(() => parsePresentationBoundingBox({ ...validBbox, srid: 4326 })).toThrow(
      /bbox srid must be 3006/,
    );
  });

  it('enforces the feature budget by FAILING, never by silently truncating', () => {
    expect(() => enforceFeatureBudget(10, 10)).not.toThrow();
    try {
      enforceFeatureBudget(11, 10);
      throw new Error('expected BUDGET_EXCEEDED');
    } catch (error) {
      expect(error).toBeInstanceOf(SpatialPresentationError);
      expect((error as SpatialPresentationError).code).toBe('BUDGET_EXCEEDED');
    }
  });

  it('has a positive default budget', () => {
    expect(DEFAULT_PRESENTATION_FEATURE_BUDGET).toBeGreaterThan(0);
    expect(() => enforceFeatureBudget(DEFAULT_PRESENTATION_FEATURE_BUDGET)).not.toThrow();
  });

  it('detects a stale viewport response so it cannot overwrite a newer one', () => {
    expect(isStalePresentationResponse(1, 2)).toBe(true);
    expect(isStalePresentationResponse(2, 2)).toBe(false);
    expect(() => assertNotStalePresentationResponse(1, 2)).toThrow(/STALE_RESPONSE/);
    expect(() => assertNotStalePresentationResponse(3, 3)).not.toThrow();
  });

  it('maps each failure to a status that distinguishes caller error from server failure', () => {
    expect(httpStatusForPresentationError('INVALID_BOUNDS')).toBe(422);
    expect(httpStatusForPresentationError('UNSUPPORTED_LAYER')).toBe(422);
    expect(httpStatusForPresentationError('BUDGET_EXCEEDED')).toBe(422);
    expect(httpStatusForPresentationError('STALE_RESPONSE')).toBe(409);
    expect(httpStatusForPresentationError('UNAVAILABLE')).toBe(503);
    expect(httpStatusForPresentationError('QUERY_FAILED')).toBe(500);
    expect(httpStatusForPresentationError('PROJECTION_FAILED')).toBe(500);
  });

  it('never converts a failure into an empty successful result', () => {
    // An empty collection is a legitimate answer; a failure must arrive as a thrown, coded error so
    // the two can never be confused at the viewer.
    const empty = {
      type: 'FeatureCollection' as const,
      presentation_contract_version: CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION,
      features: [],
    };
    expect(assertCanonicalPresentationCollection(empty)).toEqual([]);
    expect(() => enforceFeatureBudget(5, 1)).toThrow(SpatialPresentationError);
  });
});
