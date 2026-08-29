/**
 * CESIUM-BASEMAP-LIFECYCLE-01.
 *
 * Camera-fit is not this unit. The standing defect is: canvas and camera can be valid,
 * the property entity visible, Ion unused, OSM chosen — and the globe still requests
 * zero imagery tiles. That happens when the Viewer is constructed with a pre-scene
 * ImageryLayer (or Ion fromWorldImagery) against a 0×0 canvas: the quadtree may load
 * terrain-only tiles, and later size/camera changes do not by themselves schedule OSM.
 *
 * Policy: construct Viewer with baseLayer: false (never the Ion default), then attach
 * the chosen provider to the live imageryLayers collection only after the canvas has a
 * positive drawing size. Adding the layer at that point runs GlobeSurfaceTileProvider's
 * layerAdded path, which creates imagery skeletons on already-loaded tiles.
 */
export type CesiumBasemapAttachAction = 'attach' | 'defer' | 'skip';

export type CesiumBasemapAttachReason =
  | 'destroyed'
  | 'already-attached'
  | 'zero-canvas'
  | 'positive-canvas-no-layer';

export type CesiumBasemapAttachDecision = {
  readonly action: CesiumBasemapAttachAction;
  readonly reason: CesiumBasemapAttachReason;
};

export type CesiumBasemapAttachInput = {
  readonly destroyed: boolean;
  readonly attached: boolean;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly layerCount: number;
};

export function hasPositiveCanvasSize(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

export function decideBasemapAttach(input: CesiumBasemapAttachInput): CesiumBasemapAttachDecision {
  if (input.destroyed) {
    return { action: 'skip', reason: 'destroyed' };
  }
  if (input.attached && input.layerCount > 0) {
    return { action: 'skip', reason: 'already-attached' };
  }
  if (!hasPositiveCanvasSize(input.canvasWidth, input.canvasHeight)) {
    return { action: 'defer', reason: 'zero-canvas' };
  }
  if (input.layerCount > 0) {
    return { action: 'skip', reason: 'already-attached' };
  }
  return { action: 'attach', reason: 'positive-canvas-no-layer' };
}

export type CesiumBasemapLifecycleSnapshot = {
  readonly choiceKind: 'osm' | 'local-xyz' | 'ion-world-imagery';
  readonly action: CesiumBasemapAttachAction;
  readonly reason: CesiumBasemapAttachReason;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly layerCount: number;
  readonly layerReady: boolean | null;
  readonly globeShow: boolean;
  readonly tilesLoaded: boolean | null;
};
