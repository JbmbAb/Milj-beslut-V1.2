/**
 * Smallest map presentation product for Cesium viewport loading.
 * Consumes existing property read-model boundary only — does not expand query authority,
 * does not invent national dumps, and never acts as Decision Authority.
 */
import { getPropertyLayer } from '../../services/propertyUnitService';
import { loadCesiumL0L1FixtureSceneFromDisk } from '../../services/cesiumL0L1Fixtures';

export type ViewportBbox = {
  readonly minLng: number;
  readonly minLat: number;
  readonly maxLng: number;
  readonly maxLat: number;
};

export const MAP_PRESENTATION_MAX_FEATURES = 200;
export const MAP_PRESENTATION_MAX_SPAN_DEGREES = 2.5;

export function parseViewportBbox(raw: string | null | undefined): ViewportBbox | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  if (Math.abs(maxLng - minLng) > MAP_PRESENTATION_MAX_SPAN_DEGREES) return null;
  if (Math.abs(maxLat - minLat) > MAP_PRESENTATION_MAX_SPAN_DEGREES) return null;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) return null;
  return { minLng, minLat, maxLng, maxLat };
}

export type MapPresentationViewportResult = {
  readonly type: 'FeatureCollection';
  readonly features: unknown[];
  readonly meta: Record<string, unknown>;
};

export async function buildPropertyViewportPresentation(input: {
  readonly bbox: ViewportBbox;
  readonly bboxRaw: string;
  readonly limit: number;
  readonly source: 'live' | 'fixture';
}): Promise<MapPresentationViewportResult> {
  const limit = Math.max(1, Math.min(MAP_PRESENTATION_MAX_FEATURES, input.limit));

  if (input.source === 'fixture') {
    const scene = loadCesiumL0L1FixtureSceneFromDisk();
    const feature = scene.property;
    return {
      type: 'FeatureCollection',
      features: [feature],
      meta: {
        presentation: 'map-viewport-v1',
        source: 'fixture',
        layer_id: 'property',
        feature_count: 1,
        limit,
        bbox: input.bboxRaw,
        truncated: false,
        governance_status: 'FIXTURE_OBSERVATION',
        presentation_kind: 'read_model',
        identity_note: 'Stable identity ≠ geometry; fixture property Feature.id is presentation only.',
        scene_id: scene.scene_id,
        fixture: true,
      },
    };
  }

  const collection = await getPropertyLayer(input.bbox);
  const allFeatures = Array.isArray(collection.features) ? collection.features : [];
  const features = allFeatures.slice(0, limit);
  const truncated = allFeatures.length > features.length;

  return {
    type: 'FeatureCollection',
    features,
    meta: {
      presentation: 'map-viewport-v1',
      source: 'live',
      layer_id: 'property',
      feature_count: features.length,
      limit,
      bbox: input.bboxRaw,
      truncated,
      governance_status: collection.meta?.provenance_status ?? 'PARTIAL',
      presentation_kind: collection.meta?.presentation_kind ?? 'read_model',
      identity_note:
        'Property identity (feature_ref/sourceKey) is decoupled from geometry bytes per ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.',
      read_model_contract_version: collection.meta?.read_model_contract_version,
      ...(collection.meta?.dropped_feature_count
        ? {
            dropped_feature_count: collection.meta.dropped_feature_count,
            dropped_feature_reason: collection.meta.dropped_feature_reason,
          }
        : {}),
    },
  };
}
