import { describe, it, expect } from 'vitest';
import {
  calculateRadialOpenAquifer,
  calculateOneDimOpenAquifer,
  estimateInfluenceRadiusSichardt,
} from '../../server/services/groundwaterInfluenceService';

describe('groundwaterInfluenceService', () => {
  it('calculates radial flow for open aquifer correctly', () => {
    // Exempelvärden
    const result = calculateRadialOpenAquifer({
      hydraulicConductivityK: 0.001, // 10^-3 m/s (grus)
      initialSaturatedThicknessH: 10,
      waterLevelInExcavationHw: 5,
      influenceRadiusR: 100,
      excavationRadiusRw: 5,
    });

    expect(result.drawdown).toBe(5);
    expect(result.flowRate).toBeGreaterThan(0);
    expect(result.flowRateUnit).toBe('m3/s');
    // Q = pi * 0.001 * (100 - 25) / ln(100/5)
    // Q = pi * 0.001 * 75 / 2.9957 ~= 0.0786
    expect(result.flowRate).toBeCloseTo(0.0786, 3);
  });

  it('calculates 1D flow for open aquifer correctly', () => {
    const result = calculateOneDimOpenAquifer({
      hydraulicConductivityK: 0.0001,
      initialSaturatedThicknessH: 8,
      waterLevelInExcavationHw: 2,
      influenceDistanceL: 50,
    });

    expect(result.drawdown).toBe(6);
    expect(result.flowRateUnit).toBe('m3/s/m');
    // q = K * (H2 - hw2) / (2 * L)
    // q = 0.0001 * (64 - 4) / 100 = 0.0001 * 60 / 100 = 0.00006
    expect(result.flowRate).toBe(0.00006);
  });

  it('estimates influence radius using Sichardt formula', () => {
    const radius = estimateInfluenceRadiusSichardt(5, 0.001);
    // R = 3000 * 5 * sqrt(0.001) = 15000 * 0.03162 ~= 474.3
    expect(radius).toBeCloseTo(474.3, 1);
  });

  it('throws error if R <= rw', () => {
    expect(() =>
      calculateRadialOpenAquifer({
        hydraulicConductivityK: 0.001,
        initialSaturatedThicknessH: 10,
        waterLevelInExcavationHw: 5,
        influenceRadiusR: 5,
        excavationRadiusRw: 5,
      }),
    ).toThrow('Influensradie R måste vara större än anläggningens radie rw');
  });
});
