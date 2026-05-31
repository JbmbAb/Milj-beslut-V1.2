/**
 * groundwaterInfluenceService.ts
 * 
 * Implementering av SGU:s analytiska modeller för bedömning av influensområde
 * avseende grundvatten (avsänkning vid schakter, brunnar och täkter).
 * 
 * Källa: https://www.sgu.se/anvandarstod-for-geologiska-fragor/bedomning-av-influensomrade-avseende-grundvatten/berakningsmodeller/analytiska-modeller/
 */

import { logger } from '../logger';

export interface GroundwaterModelInput {
  hydraulicConductivityK: number; // K (m/s)
  initialSaturatedThicknessH: number; // H (m)
  waterLevelInExcavationHw: number; // hw (m)
  influenceRadiusR?: number; // R (m) - för radiella modeller
  influenceDistanceL?: number; // L (m) - för endimensionella modeller
  excavationRadiusRw?: number; // rw (m) - för cirkulära modeller
  aquiferThicknessB?: number; // b (m) - för slutna magasin (används för Transmissivitet T = K * b)
}

export interface GroundwaterModelResult {
  modelType: string;
  flowRate: number; // Q (m3/s) eller q (m3/s per meter)
  flowRateUnit: 'm3/s' | 'm3/s/m';
  drawdown: number; // s = H - hw
  parameters: Record<string, number>;
}

/**
 * Modell 1: Radiellt flöde till cirkulär anläggning (Öppet magasin, tät botten)
 * Formel (Dupuit-Thiem): Q = pi * K * (H^2 - hw^2) / ln(R/rw)
 */
export function calculateRadialOpenAquifer(input: Required<Pick<GroundwaterModelInput, 'hydraulicConductivityK' | 'initialSaturatedThicknessH' | 'waterLevelInExcavationHw' | 'influenceRadiusR' | 'excavationRadiusRw'>>): GroundwaterModelResult {
  const { hydraulicConductivityK: K, initialSaturatedThicknessH: H, waterLevelInExcavationHw: hw, influenceRadiusR: R, excavationRadiusRw: rw } = input;
  
  if (R <= rw) throw new Error('Influensradie R måste vara större än anläggningens radie rw');

  const Q = (Math.PI * K * (Math.pow(H, 2) - Math.pow(hw, 2))) / Math.log(R / rw);

  return {
    modelType: 'Radiellt flöde (öppet magasin, tät botten)',
    flowRate: Q,
    flowRateUnit: 'm3/s',
    drawdown: H - hw,
    parameters: { K, H, hw, R, rw },
  };
}

/**
 * Modell 3: Endimensionellt flöde till långsträckt anläggning (Öppet magasin, tät botten)
 * Formel: q = K * (H^2 - hw^2) / (2 * L)
 */
export function calculateOneDimOpenAquifer(input: Required<Pick<GroundwaterModelInput, 'hydraulicConductivityK' | 'initialSaturatedThicknessH' | 'waterLevelInExcavationHw' | 'influenceDistanceL'>>): GroundwaterModelResult {
  const { hydraulicConductivityK: K, initialSaturatedThicknessH: H, waterLevelInExcavationHw: hw, influenceDistanceL: L } = input;

  if (L <= 0) throw new Error('Influensavstånd L måste vara positivt');

  const q = (K * (Math.pow(H, 2) - Math.pow(hw, 2))) / (2 * L);

  return {
    modelType: 'Endimensionellt flöde (öppet magasin, tät botten)',
    flowRate: q,
    flowRateUnit: 'm3/s/m',
    drawdown: H - hw,
    parameters: { K, H, hw, L },
  };
}

/**
 * Modell 4: Radiellt flöde till cirkulär anläggning (Slutet magasin, tät botten)
 * Formel (Thiem): Q = 2 * pi * T * (H - hw) / ln(R/rw)
 * Transmissivitet T = K * b
 */
export function calculateRadialConfinedAquifer(input: Required<Pick<GroundwaterModelInput, 'hydraulicConductivityK' | 'aquiferThicknessB' | 'initialSaturatedThicknessH' | 'waterLevelInExcavationHw' | 'influenceRadiusR' | 'excavationRadiusRw'>>): GroundwaterModelResult {
  const { hydraulicConductivityK: K, aquiferThicknessB: b, initialSaturatedThicknessH: H, waterLevelInExcavationHw: hw, influenceRadiusR: R, excavationRadiusRw: rw } = input;

  if (R <= rw) throw new Error('Influensradie R måste vara större än anläggningens radie rw');

  const T = K * b;
  const Q = (2 * Math.PI * T * (H - hw)) / Math.log(R / rw);

  return {
    modelType: 'Radiellt flöde (slutet magasin, tät botten)',
    flowRate: Q,
    flowRateUnit: 'm3/s',
    drawdown: H - hw,
    parameters: { K, b, T, H, hw, R, rw },
  };
}

/**
 * Modell 5: Endimensionellt flöde till långsträckt anläggning (Slutet magasin, tät botten)
 * Formel: q = T * (H - hw) / L
 */
export function calculateOneDimConfinedAquifer(input: Required<Pick<GroundwaterModelInput, 'hydraulicConductivityK' | 'aquiferThicknessB' | 'initialSaturatedThicknessH' | 'waterLevelInExcavationHw' | 'influenceDistanceL'>>): GroundwaterModelResult {
  const { hydraulicConductivityK: K, aquiferThicknessB: b, initialSaturatedThicknessH: H, waterLevelInExcavationHw: hw, influenceDistanceL: L } = input;

  if (L <= 0) throw new Error('Influensavstånd L måste vara positivt');

  const T = K * b;
  const q = (T * (H - hw)) / L;

  return {
    modelType: 'Endimensionellt flöde (slutet magasin, tät botten)',
    flowRate: q,
    flowRateUnit: 'm3/s/m',
    drawdown: H - hw,
    parameters: { K, b, T, H, hw, L },
  };
}

/**
 * Uppskattar influensradie R med Sichardts formel (empirisk approximation).
 * R = 3000 * s * sqrt(K)
 * s = avsänkning (m)
 * K = hydraulisk konduktivitet (m/s)
 */
export function estimateInfluenceRadiusSichardt(drawdown: number, K: number): number {
  if (K <= 0) return 0;
  return 3000 * drawdown * Math.sqrt(K);
}
