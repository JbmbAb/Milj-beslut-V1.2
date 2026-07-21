import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_BBOX_LAYER_CONFIG,
  POSTGIS_LAKES_STYLE,
  POSTGIS_NVR_STYLE,
  POSTGIS_PROPERTY_STYLE,
  POSTGIS_STREAMS_STYLE,
  WATER_PROTECTION_STYLE,
  getSguGroundLayerStyle,
  getSguPermeabilityStyle,
} from '../../components/project/MapConfig';

describe('MapConfig', () => {
  it('defines endpoint and label for every dynamic bbox layer key', () => {
    for (const [key, config] of Object.entries(DYNAMIC_BBOX_LAYER_CONFIG)) {
      expect(config.endpoint.startsWith('/api/layers/')).toBe(true);
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.emptyMessage.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('exports stable style tokens for core overlays', () => {
    expect(POSTGIS_NVR_STYLE.fillColor).toBeTruthy();
    expect(POSTGIS_NVR_STYLE.fillOpacity).toBeGreaterThan(0);
    expect(POSTGIS_LAKES_STYLE.color).toBeTruthy();
    expect(POSTGIS_STREAMS_STYLE.weight).toBeGreaterThan(0);
    expect(POSTGIS_PROPERTY_STYLE.color).toBeTruthy();
    expect(WATER_PROTECTION_STYLE.fillOpacity).toBeGreaterThan(0);
  });

  it('returns distinct SGU ground styles for berg vs default', () => {
    const berg = getSguGroundLayerStyle({ properties: { layer_label: 'Berggrund' } });
    const defaultStyle = getSguGroundLayerStyle({ properties: { layer_label: 'Morän' } });

    expect(berg.fillColor).not.toBe(defaultStyle.fillColor);
  });

  it('returns permeability style with fill opacity', () => {
    const style = getSguPermeabilityStyle({ properties: { permeability: 'high' } });
    expect(style.fillOpacity).toBeGreaterThan(0);
    expect(style.color).toBeTruthy();
  });
});
