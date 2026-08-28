import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyCesiumIonRuntimeConfiguration, readCesiumIonAccessToken } from '../../components/cesium/cesiumIonRuntime';
import { OSM_TILE_URL, resolveCesiumBasemapChoice } from '../../components/cesium/cesiumBasemapRuntime';

describe('CESIUM-MAP-RENDERING-RUNTIME-01', () => {
  it('reads Ion token only from runtime env and never treats empty as the bundled default', () => {
    expect(readCesiumIonAccessToken({})).toBeNull();
    expect(readCesiumIonAccessToken({ VITE_CESIUM_ION_ACCESS_TOKEN: '   ' })).toBeNull();
    expect(readCesiumIonAccessToken({ VITE_CESIUM_ION_ACCESS_TOKEN: 'env-token' })).toBe('env-token');

    const ion = { defaultAccessToken: 'bundled-default-must-not-remain' };
    expect(applyCesiumIonRuntimeConfiguration(ion, {})).toBe('disabled');
    expect(ion.defaultAccessToken).toBe('');

    expect(applyCesiumIonRuntimeConfiguration(ion, { VITE_CESIUM_ION_ACCESS_TOKEN: 'env-token' })).toBe('configured');
    expect(ion.defaultAccessToken).toBe('env-token');
  });

  it('uses OSM or local XYZ basemap unless Ion imagery is explicitly opted in with a token', () => {
    expect(resolveCesiumBasemapChoice({})).toEqual({ kind: 'osm', url: OSM_TILE_URL });
    expect(
      resolveCesiumBasemapChoice({
        VITE_LOCAL_BASEMAP_XYZ_URL: 'https://tiles.example/local/{z}/{x}/{y}.png',
        VITE_LOCAL_BASEMAP_ATTRIBUTION: 'Lokal',
      }),
    ).toEqual({
      kind: 'local-xyz',
      url: 'https://tiles.example/local/{z}/{x}/{y}.png',
      credit: 'Lokal',
    });
    expect(
      resolveCesiumBasemapChoice({
        VITE_CESIUM_ION_ACCESS_TOKEN: 'env-token',
      }),
    ).toEqual({ kind: 'osm', url: OSM_TILE_URL });
    expect(
      resolveCesiumBasemapChoice({
        VITE_CESIUM_ION_ACCESS_TOKEN: 'env-token',
        VITE_CESIUM_ION_IMAGERY: 'true',
      }),
    ).toEqual({ kind: 'ion-world-imagery' });
  });

  it('adapter source: no hardcoded Ion JWT, OSM/local basemap, resize after layout, fit after load', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const adapter = readFileSync(path.resolve(here, '../../components/cesium/CesiumAdapter.ts'), 'utf8');
    expect(adapter).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./);
    expect(adapter).toContain('applyCesiumIonRuntimeConfiguration');
    expect(adapter).toContain('OpenStreetMapImageryProvider');
    expect(adapter).toContain('EllipsoidTerrainProvider');
    expect(adapter).toContain('ResizeObserver');
    expect(adapter).toContain('resizeToContainer');
    expect(adapter).toContain('requestRender');
    expect(adapter).toContain('computePropertyCameraFit');
    expect(adapter).toContain('fitToPropertyGeoJson');
    expect(adapter).not.toContain('viewer.flyTo(dataSource');
    expect(adapter).not.toMatch(/0\.0 \/\/ auto-calculate range/);
  });

  it('LuWorkspace map panel has an explicit height so the Cesium container is not 0x0', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, '../../components/app/lu/LuWorkspace.tsx'), 'utf8');
    expect(source).toContain('data-testid="lu-cesium-front"');
    expect(source).toContain('h-[620px]');
    expect(source).toContain("useState<CesiumEvidenceMode>('live')");
  });

  it('governed LU still does not offer fixture as a product workaround', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, '../../components/CesiumMapView.tsx'), 'utf8');
    expect(source).toContain("mode === 'live' && !projectId");
    expect(source).toContain('resizeToContainer');
  });
});
