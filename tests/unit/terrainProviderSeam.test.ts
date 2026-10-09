import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CesiumTerrainProvider,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  type Viewer,
} from 'cesium';
import {
  applyTerrainSeam,
  createLocalFixtureTerrainProvider,
  LOCAL_TERRAIN_FIXTURE_STATE,
} from '../../components/cesium/terrainProviderSeam';

describe('F-003 terrain provider seam', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('local_fixture installs a non-ellipsoid CustomHeightmapTerrainProvider', async () => {
    const viewer = { terrainProvider: new EllipsoidTerrainProvider() } as unknown as Viewer;
    const state = await applyTerrainSeam(viewer, 'local_fixture');
    expect(state).toMatchObject({
      mode: 'local_fixture',
      fixture: true,
      provider_kind: 'custom_heightmap',
      provider_id: LOCAL_TERRAIN_FIXTURE_STATE.provider_id,
    });
    expect(viewer.terrainProvider).toBeInstanceOf(CustomHeightmapTerrainProvider);
    expect(viewer.terrainProvider).not.toBeInstanceOf(EllipsoidTerrainProvider);
  });

  it('ellipsoid remains explicit fallback', async () => {
    const viewer = { terrainProvider: null } as unknown as Viewer;
    const state = await applyTerrainSeam(viewer, 'ellipsoid');
    expect(state.mode).toBe('ellipsoid');
    expect(state.provider_kind).toBe('ellipsoid');
    expect(viewer.terrainProvider).toBeInstanceOf(EllipsoidTerrainProvider);
  });

  it('governed mode requires configurable URL and uses CesiumTerrainProvider.fromUrl', async () => {
    const viewer = { terrainProvider: new EllipsoidTerrainProvider() } as unknown as Viewer;
    await expect(applyTerrainSeam(viewer, 'governed')).rejects.toThrow(/URL is not configured/i);

    const fakeProvider = { __fixture: true };
    const spy = vi.spyOn(CesiumTerrainProvider, 'fromUrl').mockResolvedValue(fakeProvider as never);

    const state = await applyTerrainSeam(viewer, 'governed', {
      url: '/cesium/fixtures/terrain',
      dataset_id: 'test.governed.terrain',
    });
    expect(spy).toHaveBeenCalledWith('/cesium/fixtures/terrain');
    expect(state.mode).toBe('governed');
    expect(state.provider_kind).toBe('cesium_terrain_url');
    expect(state.url).toBe('/cesium/fixtures/terrain');
    expect(viewer.terrainProvider).toBe(fakeProvider);
  });

  it('createLocalFixtureTerrainProvider returns heightmap provider', () => {
    const provider = createLocalFixtureTerrainProvider();
    expect(provider).toBeInstanceOf(CustomHeightmapTerrainProvider);
  });
});
