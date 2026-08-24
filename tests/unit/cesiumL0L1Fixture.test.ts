import { describe, it, expect } from 'vitest';
import {
  loadCesiumL0L1FixtureSceneFromDisk,
  validateCesiumL0L1FixtureScene,
  CESIUM_L0_L1_SCENE_ID,
} from '../../server/services/cesiumL0L1Fixtures';
import {
  assertPresentationFeatureContract,
  buildWgs84PresentationFeature,
  CESIUM_L0_L1_LAYER_IDS,
  LOGICAL_TO_ADMIT_LAYER,
  styleForLayerId,
} from '../../server/services/geoPresentationContract';
import { GeoPresentationAdapter, SpatialEvidenceArtifact } from '../../server/services/geoPresentationAdapter';
import { admitLayerIdForLogical } from '../../components/cesium/layerIdMapping';

describe('Cesium L0/L1 fixture scene (no PostGIS)', () => {
  it('loads frozen WGS84 fixture from public/cesium/fixtures', () => {
    const scene = loadCesiumL0L1FixtureSceneFromDisk();
    expect(scene.scene_id).toBe(CESIUM_L0_L1_SCENE_ID);
    expect(scene.srid).toBe(4326);
    expect(scene.governance_status).toBe('FIXTURE_OBSERVATION');
  });

  it('satisfies presentation contract for all L0/L1 layers', () => {
    const scene = loadCesiumL0L1FixtureSceneFromDisk();
    const errors = validateCesiumL0L1FixtureScene(scene);
    expect(errors).toEqual([]);

    for (const layerId of CESIUM_L0_L1_LAYER_IDS) {
      const feature = scene.evidence.features.find((f) => f.properties.layer_id === layerId);
      expect(feature, `layer ${layerId}`).toBeTruthy();
      expect(assertPresentationFeatureContract(feature!)).toEqual([]);
      expect(feature!.properties.color).toBe(styleForLayerId(layerId).color);
    }
  });

  it('projects already-WGS84 artifacts without calling PostGIS', async () => {
    const adapter = new GeoPresentationAdapter();
    const artifact: SpatialEvidenceArtifact = {
      artifact_id: 'wgs84-direct-1',
      artifact_type: 'SPATIAL_EVIDENCE',
      content_hash: { value: 'sha256-direct' },
      payload: {
        property_ref: { artifact_id: 'prop' },
        srid: 4326,
        geometry: { type: 'Point', coordinates: [14.99, 61.12] },
        layer_ref: { layer_id: 'water', layer_version: 'v1' },
        source_metadata: {
          provider: 'SGU',
          dataset: 'Wells',
          dataset_version: 'v1',
          retrieved_at: '2026-08-08T00:00:00.000Z',
        },
      },
    };

    const feature = await adapter.projectEvidenceToWgs84(artifact);
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [14.99, 61.12] });
    expect(assertPresentationFeatureContract(feature)).toEqual([]);
  });

  it('emits Cesium presentation metadata for live evidence collections', async () => {
    const adapter = new GeoPresentationAdapter();
    const collection = await adapter.projectEvidenceCollectionToWgs84([
      {
        artifact_id: 'meta-live-1',
        artifact_type: 'SPATIAL_EVIDENCE',
        content_hash: { value: 'sha256-meta' },
        payload: {
          srid: 4326,
          geometry: { type: 'Point', coordinates: [15, 62] },
          layer_ref: { layer_id: 'protected_area', layer_version: 'v1' },
          source_metadata: {
            provider: 'Naturvårdsverket',
            dataset: 'Protected areas',
            retrieved_at: '2026-08-08T00:00:00.000Z',
          },
        },
      },
    ]);

    expect(collection.meta).toMatchObject({
      presentation: 'cesium-l0-l1',
      srid: 4326,
      governance_status: 'VERIFIED_OBSERVATION',
      feature_count: 1,
    });
  });

  it('buildWgs84PresentationFeature matches fixture styling rules', () => {
    const feature = buildWgs84PresentationFeature({
      artifact_id: 'x',
      content_hash: 'h',
      layer_id: 'ebh',
      layer_version: 'v1',
      provider: 'LST',
      dataset: 'EBH',
      retrieved_at: '2026-08-08T00:00:00.000Z',
      geometry: {
        type: 'Polygon',
        coordinates: [[[14.99, 61.12], [15.0, 61.12], [15.0, 61.13], [14.99, 61.13], [14.99, 61.12]]],
      },
    });
    expect(feature.properties.color).toBe('#ef4444');
    expect(feature.properties.title).toBe('EBH Evidens');
  });

  it('fail-closed when presentation props are missing', () => {
    const errors = assertPresentationFeatureContract({
      type: 'Feature',
      geometry: { type: 'Point' },
      properties: { layer_id: 'water' },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('cas_content_hash'))).toBe(true);
    expect(errors.some((e) => e.includes('evidence_id'))).toBe(true);
  });

  it('maps L0/L1 logical layer_id to Admit v1 contracts', () => {
    for (const layerId of CESIUM_L0_L1_LAYER_IDS) {
      expect(admitLayerIdForLogical(layerId)).toBe(LOGICAL_TO_ADMIT_LAYER[layerId]);
    }
    expect(admitLayerIdForLogical('unknown')).toBeNull();
  });
});
