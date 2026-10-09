import { UrlTemplateImageryProvider, type ImageryLayer, type Viewer } from 'cesium';

export type ImagerySeamKind = 'orthophoto' | 'topographic';

export type LocalImageryDataset = {
  readonly kind: ImagerySeamKind;
  readonly dataset_id: string;
  readonly urlTemplate: string;
  readonly minimumLevel: number;
  readonly maximumLevel: number;
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly attribution: string;
  readonly fixture: boolean;
};

/** Deterministic local fixture — not public online imagery, not production proof of national data. */
export const LOCAL_ORTHOPHOTO_FIXTURE: LocalImageryDataset = {
  kind: 'orthophoto',
  dataset_id: 'cesium.fixture.orthophoto.v1',
  urlTemplate: '/cesium/fixtures/imagery/orthophoto/{z}/{x}/{y}.png',
  minimumLevel: 0,
  maximumLevel: 4,
  west: 14.4,
  south: 61.05,
  east: 14.7,
  north: 61.25,
  attribution: 'Mimer deterministic orthophoto fixture (not national governed data)',
  fixture: true,
};

export const LOCAL_TOPOGRAPHIC_FIXTURE: LocalImageryDataset = {
  kind: 'topographic',
  dataset_id: 'cesium.fixture.topographic.v1',
  urlTemplate: '/cesium/fixtures/imagery/topographic/{z}/{x}/{y}.png',
  minimumLevel: 0,
  maximumLevel: 4,
  west: 14.4,
  south: 61.05,
  east: 14.7,
  north: 61.25,
  attribution: 'Mimer deterministic topographic fixture (not national governed data)',
  fixture: true,
};

export type ImagerySeamHandle = {
  readonly dataset: LocalImageryDataset;
  readonly layer: ImageryLayer;
};

export async function attachLocalImagery(
  viewer: Viewer,
  dataset: LocalImageryDataset,
  opacity = 1,
): Promise<ImagerySeamHandle> {
  const provider = await Promise.resolve(
    new UrlTemplateImageryProvider({
      url: dataset.urlTemplate,
      minimumLevel: dataset.minimumLevel,
      maximumLevel: dataset.maximumLevel,
      credit: dataset.attribution,
    }),
  );
  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha = opacity;
  layer.show = true;
  return { dataset, layer };
}

export function setImageryVisibility(handle: ImagerySeamHandle | null, visible: boolean): void {
  if (!handle) return;
  handle.layer.show = visible;
}

export function setImageryOpacity(handle: ImagerySeamHandle | null, opacity: number): void {
  if (!handle) return;
  handle.layer.alpha = Math.max(0, Math.min(1, opacity));
}

export function detachImagery(viewer: Viewer, handle: ImagerySeamHandle | null): void {
  if (!handle) return;
  viewer.imageryLayers.remove(handle.layer, true);
}
