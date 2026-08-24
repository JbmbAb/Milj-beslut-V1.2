import { describe, expect, it } from 'vitest';
import { CESIUM_EVIDENCE_LAYERS } from '../../components/cesium/types';

describe('LU-FINDING-MAP-DRILLDOWN-V1: CESIUM_EVIDENCE_LAYERS', () => {
  it('proof 9: natura2000 and water_protection_area are registered with their own distinct color, matching the layers the governed rule engine (LU-BREADTH-01) already produces findings for', () => {
    const keys = CESIUM_EVIDENCE_LAYERS.map((l) => l.key);
    expect(keys).toContain('natura2000');
    expect(keys).toContain('water_protection_area');

    const natura2000 = CESIUM_EVIDENCE_LAYERS.find((l) => l.key === 'natura2000')!;
    const waterProtection = CESIUM_EVIDENCE_LAYERS.find((l) => l.key === 'water_protection_area')!;
    const water = CESIUM_EVIDENCE_LAYERS.find((l) => l.key === 'water')!;

    // Each layer's color must be distinct -- otherwise a natura2000 feature would be visually
    // indistinguishable from water on the map, exactly the gap this unit closes.
    const colors = CESIUM_EVIDENCE_LAYERS.map((l) => l.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(natura2000.color).not.toBe(water.color);
    expect(waterProtection.color).not.toBe(water.color);
  });
});
