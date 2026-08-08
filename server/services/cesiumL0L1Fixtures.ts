import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertPresentationFeatureContract,
  CESIUM_L0_L1_LAYER_IDS,
} from './geoPresentationContract';

export const CESIUM_L0_L1_SCENE_ID = 'cesium.l0l1.fixture.v1';

export type CesiumL0L1FixtureScene = {
  scene_id: string;
  srid: number;
  governance_status: string;
  note?: string;
  center: { lat: number; lng: number };
  property: {
    type: 'Feature';
    id?: string;
    geometry: { type: string; coordinates: unknown };
    properties?: Record<string, unknown>;
  };
  evidence: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id?: string;
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown>;
    }>;
  };
};

let cachedScene: CesiumL0L1FixtureScene | null = null;

export function loadCesiumL0L1FixtureSceneFromDisk(): CesiumL0L1FixtureScene {
  if (cachedScene) return cachedScene;

  const path = join(process.cwd(), 'public', 'cesium', 'fixtures', 'l0-l1-scene.wgs84.json');
  const raw = readFileSync(path, 'utf8');
  const scene = JSON.parse(raw) as CesiumL0L1FixtureScene;

  if (scene.scene_id !== CESIUM_L0_L1_SCENE_ID) {
    throw new Error(`Unexpected Cesium fixture scene_id: ${scene.scene_id}`);
  }
  if (scene.srid !== 4326) {
    throw new Error(`Cesium fixture must be WGS84 (srid 4326), got ${scene.srid}`);
  }

  cachedScene = scene;
  return scene;
}

export function validateCesiumL0L1FixtureScene(scene: CesiumL0L1FixtureScene): string[] {
  const errors: string[] = [];

  if (scene.evidence?.type !== 'FeatureCollection') {
    errors.push('evidence.type must be FeatureCollection');
  }

  const features = scene.evidence?.features ?? [];
  if (features.length === 0) {
    errors.push('evidence.features must be non-empty');
  }

  const seenLayers = new Set<string>();
  for (const feature of features) {
    errors.push(...assertPresentationFeatureContract(feature).map((e) => `${feature.id ?? '?'}: ${e}`));
    const layerId = String(feature.properties?.layer_id ?? '');
    seenLayers.add(layerId);
  }

  for (const required of CESIUM_L0_L1_LAYER_IDS) {
    if (!seenLayers.has(required)) {
      errors.push(`missing required L0/L1 layer_id: ${required}`);
    }
  }

  if (!scene.property?.geometry) {
    errors.push('property.geometry is required');
  }

  return errors;
}
