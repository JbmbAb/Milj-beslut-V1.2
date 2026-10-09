import { EllipsoidTerrainProvider, type TerrainProvider, type Viewer } from 'cesium';
import { ACTIVE_CESIUM_HEIGHT_REFERENCE, assertPresentationHeightMode } from './heightReferenceContract';

export type TerrainSeamMode = 'ellipsoid' | 'local_fixture' | 'governed_pending';

export type TerrainSeamState = {
  readonly mode: TerrainSeamMode;
  readonly provider_id: string;
  readonly fixture: boolean;
  readonly height_contract_id: string;
  readonly note: string;
};

export const ELLIPSOID_TERRAIN_STATE: TerrainSeamState = {
  mode: 'ellipsoid',
  provider_id: 'cesium.terrain.ellipsoid',
  fixture: false,
  height_contract_id: ACTIVE_CESIUM_HEIGHT_REFERENCE.contract_id,
  note: 'WGS84 ellipsoid fallback — presentation only until governed terrain product exists.',
};

/**
 * Local fixture marker. Cesium QuantizedMesh terrain packaging for national DEM is
 * BLOCKED_BY_GOVERNED_DATA; the seam remains executable with ellipsoid + explicit fixture id.
 */
export const LOCAL_TERRAIN_FIXTURE_STATE: TerrainSeamState = {
  mode: 'local_fixture',
  provider_id: 'cesium.fixture.terrain.ellipsoid-marker.v1',
  fixture: true,
  height_contract_id: ACTIVE_CESIUM_HEIGHT_REFERENCE.contract_id,
  note:
    'Deterministic local terrain proof uses ellipsoid provider with fixture provenance. ' +
    'National DEM / RH2000 terrain tiles are not claimed.',
};

export function createEllipsoidTerrainProvider(): TerrainProvider {
  assertPresentationHeightMode('ELLIPSOID_WGS84_PRESENTATION_ONLY');
  return new EllipsoidTerrainProvider();
}

export async function applyTerrainSeam(
  viewer: Viewer,
  mode: TerrainSeamMode,
): Promise<TerrainSeamState> {
  if (mode === 'governed_pending') {
    throw new Error(
      'Governed terrain product is not configured. Use ellipsoid or local_fixture seam.',
    );
  }
  const provider = createEllipsoidTerrainProvider();
  viewer.terrainProvider = provider;
  return mode === 'local_fixture' ? LOCAL_TERRAIN_FIXTURE_STATE : ELLIPSOID_TERRAIN_STATE;
}

export function disableTerrain(viewer: Viewer): TerrainSeamState {
  viewer.terrainProvider = createEllipsoidTerrainProvider();
  return ELLIPSOID_TERRAIN_STATE;
}
