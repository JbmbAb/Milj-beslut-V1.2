/**
 * CESIUM-MAP-RENDERING-RUNTIME-01.
 *
 * Same basemap policy as the 2D MapView: OSM by default, optional local XYZ via
 * VITE_LOCAL_BASEMAP_XYZ_URL. Never Cesium Ion World Imagery unless an Ion token is
 * actually configured -- the Ion default layer is what hits api.cesium.com / assets.cesium.com.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/';

export type CesiumBasemapEnv = {
  readonly VITE_CESIUM_ION_ACCESS_TOKEN?: string;
  readonly VITE_CESIUM_ION_IMAGERY?: string;
  readonly VITE_LOCAL_BASEMAP_XYZ_URL?: string;
  readonly VITE_LOCAL_BASEMAP_ATTRIBUTION?: string;
};

export type CesiumBasemapChoice =
  | { readonly kind: 'ion-world-imagery' }
  | { readonly kind: 'local-xyz'; readonly url: string; readonly credit: string }
  | { readonly kind: 'osm'; readonly url: string };

function truthyFlag(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function resolveCesiumBasemapChoice(env: object): CesiumBasemapChoice {
  const record = env as Record<string, unknown>;
  const localXyz = String(record.VITE_LOCAL_BASEMAP_XYZ_URL ?? '').trim();
  if (localXyz) {
    const credit = String(record.VITE_LOCAL_BASEMAP_ATTRIBUTION ?? 'Lokal basemap (PostGIS/arkiv)').trim();
    return { kind: 'local-xyz', url: localXyz, credit };
  }

  const ionToken = String(record.VITE_CESIUM_ION_ACCESS_TOKEN ?? '').trim();
  if (ionToken && truthyFlag(record.VITE_CESIUM_ION_IMAGERY as string | undefined)) {
    return { kind: 'ion-world-imagery' };
  }

  return { kind: 'osm', url: OSM_TILE_URL };
}
