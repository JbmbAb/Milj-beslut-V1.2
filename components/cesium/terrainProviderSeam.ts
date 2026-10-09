import {
  CesiumTerrainProvider,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  type TerrainProvider,
  type Viewer,
} from 'cesium';
import { ACTIVE_CESIUM_HEIGHT_REFERENCE, assertPresentationHeightMode } from './heightReferenceContract';

export type TerrainSeamMode = 'ellipsoid' | 'local_fixture' | 'governed';

export type TerrainSeamState = {
  readonly mode: TerrainSeamMode;
  readonly provider_id: string;
  readonly fixture: boolean;
  readonly height_contract_id: string;
  readonly provider_kind: 'ellipsoid' | 'custom_heightmap' | 'cesium_terrain_url';
  readonly url: string | null;
  readonly note: string;
};

export type GovernedTerrainConfig = {
  /** Local or on-prem Cesium terrain tile endpoint (layer.json parent URL). */
  readonly url: string;
  readonly dataset_id?: string;
};

/** Default local fixture heightmap grid (presentation-only; not national DEM). */
export const LOCAL_TERRAIN_FIXTURE_URL = '/cesium/fixtures/terrain/layer.json';

export const ELLIPSOID_TERRAIN_STATE: TerrainSeamState = {
  mode: 'ellipsoid',
  provider_id: 'cesium.terrain.ellipsoid',
  fixture: false,
  height_contract_id: ACTIVE_CESIUM_HEIGHT_REFERENCE.contract_id,
  provider_kind: 'ellipsoid',
  url: null,
  note: 'WGS84 ellipsoid fallback — presentation only until governed terrain product exists.',
};

/**
 * Deterministic local CustomHeightmapTerrainProvider — real non-ellipsoid TerrainProvider.
 * National DEM / RH2000 terrain tiles remain BLOCKED_BY_GOVERNED_DATA.
 */
export const LOCAL_TERRAIN_FIXTURE_STATE: TerrainSeamState = {
  mode: 'local_fixture',
  provider_id: 'cesium.fixture.terrain.custom-heightmap.v1',
  fixture: true,
  height_contract_id: ACTIVE_CESIUM_HEIGHT_REFERENCE.contract_id,
  provider_kind: 'custom_heightmap',
  url: LOCAL_TERRAIN_FIXTURE_URL,
  note:
    'Deterministic local CustomHeightmapTerrainProvider proves the terrain-provider path. ' +
    'National DEM / RH2000 terrain tiles are not claimed.',
};

export function createEllipsoidTerrainProvider(): TerrainProvider {
  assertPresentationHeightMode('ELLIPSOID_WGS84_PRESENTATION_ONLY');
  return new EllipsoidTerrainProvider();
}

/**
 * Local fixture terrain: a real TerrainProvider (not ellipsoid) with a gentle
 * deterministic height field so TV-4.4 client path is executable offline.
 */
export function createLocalFixtureTerrainProvider(): TerrainProvider {
  assertPresentationHeightMode('ELLIPSOID_WGS84_PRESENTATION_ONLY');
  const width = 16;
  const height = 16;
  return new CustomHeightmapTerrainProvider({
    width,
    height,
    callback: (x, y, level) => {
      const buffer = new Float32Array(width * height);
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          // Deterministic gentle undulation — presentation fixture only.
          const u = (col + x * width) / (width * (1 << Math.max(0, level)));
          const v = (row + y * height) / (height * (1 << Math.max(0, level)));
          buffer[row * width + col] = 40 + 12 * Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2);
        }
      }
      return buffer;
    },
  });
}

export async function createGovernedTerrainProvider(config: GovernedTerrainConfig): Promise<TerrainProvider> {
  assertPresentationHeightMode('ELLIPSOID_WGS84_PRESENTATION_ONLY');
  const url = config.url.trim();
  if (!url) {
    throw new Error('Governed terrain URL is empty. Configure the on-prem terrain product endpoint.');
  }
  return CesiumTerrainProvider.fromUrl(url);
}

export async function applyTerrainSeam(
  viewer: Viewer,
  mode: TerrainSeamMode,
  governed?: GovernedTerrainConfig,
): Promise<TerrainSeamState> {
  if (mode === 'ellipsoid') {
    viewer.terrainProvider = createEllipsoidTerrainProvider();
    return ELLIPSOID_TERRAIN_STATE;
  }

  if (mode === 'local_fixture') {
    viewer.terrainProvider = createLocalFixtureTerrainProvider();
    return LOCAL_TERRAIN_FIXTURE_STATE;
  }

  // mode === 'governed'
  if (!governed?.url) {
    throw new Error(
      'Governed terrain product URL is not configured. Use ellipsoid fallback or local_fixture, ' +
        'or pass GovernedTerrainConfig.url for CesiumTerrainProvider.fromUrl.',
    );
  }
  const provider = await createGovernedTerrainProvider(governed);
  viewer.terrainProvider = provider;
  return {
    mode: 'governed',
    provider_id: governed.dataset_id ?? 'cesium.terrain.governed',
    fixture: false,
    height_contract_id: ACTIVE_CESIUM_HEIGHT_REFERENCE.contract_id,
    provider_kind: 'cesium_terrain_url',
    url: governed.url,
    note: 'Configured CesiumTerrainProvider.fromUrl seam — requires governed terrain product data.',
  };
}

export function disableTerrain(viewer: Viewer): TerrainSeamState {
  viewer.terrainProvider = createEllipsoidTerrainProvider();
  return ELLIPSOID_TERRAIN_STATE;
}
