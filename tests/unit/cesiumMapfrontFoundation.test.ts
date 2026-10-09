import { describe, expect, it } from 'vitest';
import { ACTIVE_CESIUM_HEIGHT_REFERENCE } from '../../components/cesium/heightReferenceContract';
import { MAPFRONT_LAYER_REGISTRY, getMapfrontLayer } from '../../components/cesium/layerRegistry';
import { deriveFeatureCollectionState, mapfrontStateLabelSv } from '../../components/cesium/loadingState';
import { resolvePropertyIdentity } from '../../components/cesium/propertySelection';
import { LOGICAL_TO_ADMIT_LAYER } from '../../components/cesium/layerIdMapping';
import {
  MAP_PRESENTATION_MAX_SPAN_DEGREES,
  parseViewportBbox,
} from '../../server/modules/map-presentation/mapPresentationService';

describe('CESIUM-TV4 mapfront foundation', () => {
  it('keeps height reference undecided and ellipsoid-only', () => {
    expect(ACTIVE_CESIUM_HEIGHT_REFERENCE.owner_decision).toBe('UNDECIDED');
    expect(ACTIVE_CESIUM_HEIGHT_REFERENCE.vertical_crs).toBeNull();
    expect(ACTIVE_CESIUM_HEIGHT_REFERENCE.mode).toBe('ELLIPSOID_WGS84_PRESENTATION_ONLY');
  });

  it('registers presentation seams for buildings/terrain/imagery/land cover/topo/hydro', () => {
    expect(getMapfrontLayer('buildings')?.client_status).toBe('READY');
    expect(getMapfrontLayer('buildings')?.presentation).toBe('3d_tiles');
    expect(getMapfrontLayer('land_cover')?.client_status).toBe('SEAM_ONLY');
    expect(getMapfrontLayer('hydrography')?.client_status).toBe('SEAM_ONLY');
    expect(MAPFRONT_LAYER_REGISTRY.length).toBeGreaterThanOrEqual(10);
  });

  it('EMPTY is distinct from UNAVAILABLE and NO-EVIDENCE messaging stays presentation-only', () => {
    expect(deriveFeatureCollectionState({ loading: false, featureCount: 0 })).toBe('EMPTY');
    expect(
      deriveFeatureCollectionState({ loading: false, unavailable: true, featureCount: null }),
    ).toBe('UNAVAILABLE');
    expect(mapfrontStateLabelSv('EMPTY')).toContain('Tom');
  });

  it('decouples property identity from geometry bytes', () => {
    expect(resolvePropertyIdentity({ feature_ref: 'prop:abc' }, 'ignored')).toBe('prop:abc');
    expect(resolvePropertyIdentity({ sourceKey: 'merged:1' })).toBe('sourceKey:merged:1');
    expect(resolvePropertyIdentity({}, undefined)).toBeNull();
  });

  it('maps natura2000 and water_protection_area admit ids', () => {
    expect(LOGICAL_TO_ADMIT_LAYER.natura2000).toBe('lu.natura2000');
    expect(LOGICAL_TO_ADMIT_LAYER.water_protection_area).toBe('lu.water_protection_area');
  });

  it('rejects oversized viewport bbox (no national dump)', () => {
    expect(MAP_PRESENTATION_MAX_SPAN_DEGREES).toBeLessThanOrEqual(2.5);
    expect(parseViewportBbox('10,50,20,60')).toBeNull();
    expect(parseViewportBbox('14.40,61.10,14.45,61.15')).not.toBeNull();
  });
});
