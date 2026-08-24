/**
 * Client-side Cesium L0/L1 fixture scene (WGS84).
 * Observation only — never spatial authority.
 */
import type { Feature, FeatureCollection } from 'geojson';

export const CESIUM_L0_L1_SCENE_ID = 'cesium.l0l1.fixture.v1';
export const CESIUM_L0_L1_FIXTURE_URL = '/cesium/fixtures/l0-l1-scene.wgs84.json';

export type CesiumL0L1Scene = {
  scene_id: string;
  srid: 4326;
  governance_status: string;
  note?: string;
  center: { lat: number; lng: number };
  property: Feature;
  evidence: FeatureCollection;
};

export async function loadCesiumL0L1FixtureScene(): Promise<CesiumL0L1Scene> {
  const res = await fetch(CESIUM_L0_L1_FIXTURE_URL);
  if (!res.ok) {
    throw new Error(`Failed to load Cesium L0/L1 fixture (HTTP ${res.status})`);
  }
  const scene = (await res.json()) as CesiumL0L1Scene;
  if (scene.srid !== 4326) {
    throw new Error(`Cesium fixture must be WGS84 (srid 4326), got ${scene.srid}`);
  }
  if (scene.scene_id !== CESIUM_L0_L1_SCENE_ID) {
    throw new Error(`Unexpected Cesium fixture scene_id: ${scene.scene_id}`);
  }
  return scene;
}
