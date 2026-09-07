import { describe, expect, it } from 'vitest';
import { decideBasemapAttach } from '../../components/cesium/cesiumBasemapLifecycle';

describe('CESIUM-BASEMAP-LIFECYCLE-01', () => {
  it('defers attach while the canvas is 0×0 so the quadtree cannot load terrain-only tiles first', () => {
    expect(
      decideBasemapAttach({
        destroyed: false,
        attached: false,
        canvasWidth: 0,
        canvasHeight: 0,
        layerCount: 0,
      }),
    ).toEqual({ action: 'defer', reason: 'zero-canvas' });
    expect(
      decideBasemapAttach({
        destroyed: false,
        attached: false,
        canvasWidth: 701,
        canvasHeight: 0,
        layerCount: 0,
      }),
    ).toEqual({ action: 'defer', reason: 'zero-canvas' });
  });

  it('attaches the provider only after a positive canvas and an empty live imagery collection', () => {
    expect(
      decideBasemapAttach({
        destroyed: false,
        attached: false,
        canvasWidth: 701,
        canvasHeight: 617,
        layerCount: 0,
      }),
    ).toEqual({ action: 'attach', reason: 'positive-canvas-no-layer' });
  });

  it('does not construct a second layer after the live collection already has one', () => {
    expect(
      decideBasemapAttach({
        destroyed: false,
        attached: true,
        canvasWidth: 701,
        canvasHeight: 617,
        layerCount: 1,
      }),
    ).toEqual({ action: 'skip', reason: 'already-attached' });
    expect(
      decideBasemapAttach({
        destroyed: false,
        attached: false,
        canvasWidth: 701,
        canvasHeight: 617,
        layerCount: 1,
      }),
    ).toEqual({ action: 'skip', reason: 'already-attached' });
  });

  it('never attaches after the adapter was destroyed', () => {
    expect(
      decideBasemapAttach({
        destroyed: true,
        attached: false,
        canvasWidth: 701,
        canvasHeight: 617,
        layerCount: 0,
      }),
    ).toEqual({ action: 'skip', reason: 'destroyed' });
  });
});
