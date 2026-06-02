import { describe, it, expect } from 'vitest';
import {
  calculateDahlstromIntensity,
  calculateStormwaterDetention,
  calculateVaProjectClimate,
} from '../../server/services/svensktVattenService';

describe('svensktVattenService', () => {
  describe('Dahlströms regnintensitetsformel (2010)', () => {
    it('beräknar regnintensitet korrekt för typiska värden', () => {
      // T = 5 år (60 månader), varaktighet = 10 minuter
      const intensity = calculateDahlstromIntensity(60, 10);
      
      // För T=60, d=10:
      // term1 = 190 * (60^(1/3)) = 190 * 3.9148676 = 743.8248
      // term2 = ln(10) / (10^0.98) = 2.302585 / 9.5499258 = 0.241110
      // intensity = 743.8248 * 0.241110 + 2 = 179.343 + 2 = 181.343 l/(s*ha)
      expect(intensity).toBeCloseTo(181.34, 1);
    });

    it('begränsar varaktighet till lägst 5 minuter', () => {
      const intensityUnder5 = calculateDahlstromIntensity(60, 3);
      const intensityAt5 = calculateDahlstromIntensity(60, 5);
      
      expect(intensityUnder5).toBe(intensityAt5);
    });
  });

  describe('P110 Dagvattenberäkning', () => {
    it('beräknar avrinningsareor och dimensionerande flöde korrekt utan magasinering', () => {
      const result = calculateStormwaterDetention({
        areaM2: 10000,           // 1 ha
        runoffCoefficient: 0.5,  // Reducerad area = 0.5 ha
        returnPeriodYears: 5,    // T = 60 månader
        durationMinutes: 10,     // i = 181.34 l/(s*ha)
        climateFactor: 1.25,     // Q = 0.5 * 181.34 * 1.25 = 113.34 l/s
      });

      expect(result.catchmentAreaHa).toBe(1.0);
      expect(result.reducedAreaHa).toBe(0.5);
      expect(result.rainIntensityLsHa).toBeCloseTo(181.34, 1);
      expect(result.dimensioningFlowLs).toBeCloseTo(113.34, 1);
      expect(result.allowedOutflowLs).toBeUndefined();
      expect(result.requiredVolumeM3).toBeUndefined();
      expect(result.volumeCurve).toBeUndefined();
    });

    it('beräknar magasinsvolym och kör svepanalys om tillåtet utflöde anges', () => {
      const result = calculateStormwaterDetention({
        areaM2: 10000,
        runoffCoefficient: 0.5,
        returnPeriodYears: 5,
        durationMinutes: 10,
        climateFactor: 1.25,
        allowedOutflowLs: 20.0,  // Tillåtet utflöde 20 l/s
      });

      // Flöde = 113.34 l/s. Överskott = 113.34 - 20 = 93.34 l/s.
      // Volym för 10 min = 93.34 * 10 * 60 / 1000 = 56.00 m³
      expect(result.allowedOutflowLs).toBe(20.0);
      expect(result.requiredVolumeM3).toBeCloseTo(56.0, 1);
      
      // Kontrollera svepet
      expect(result.criticalDurationMinutes).toBeGreaterThan(0);
      expect(result.maxRequiredVolumeM3).toBeGreaterThanOrEqual(result.requiredVolumeM3!);
      expect(result.volumeCurve).toHaveLength(16);
      
      // Kurvan ska innehålla giltiga värden
      const curvePoint10 = result.volumeCurve!.find(p => p.durationMinutes === 10);
      expect(curvePoint10).toBeDefined();
      expect(curvePoint10!.volumeM3).toBeCloseTo(56.0, 1);
    });

    it('kastar fel för ogiltiga parametrar', () => {
      expect(() => calculateStormwaterDetention({
        areaM2: -100,
        runoffCoefficient: 0.5,
        returnPeriodYears: 5,
        durationMinutes: 10,
        climateFactor: 1.25,
      })).toThrow();

      expect(() => calculateStormwaterDetention({
        areaM2: 10000,
        runoffCoefficient: 1.5,
        returnPeriodYears: 5,
        durationMinutes: 10,
        climateFactor: 1.25,
      })).toThrow();
    });
  });

  describe('Klimatberäkning för VA-anläggningsprojekt', () => {
    it('beräknar CO2e-emissioner korrekt för schakt, rör och transport', () => {
      const result = calculateVaProjectClimate({
        trenchLengthM: 100,
        trenchWidthM: 1.0,
        trenchDepthM: 2.0,       // Volym = 200 m3. Vikt = 360 ton (vid 1.8 ton/m3)
        reusePercentage: 50,     // 180 ton återanvänds, 180 ton importeras
        pipes: [
          {
            material: 'PP',
            diameterMm: 160,
            lengthM: 100,        // Vikt = 0.00011 * 160^2 * 100 = 281.6 kg
          }
        ],
        transportDistanceKm: 20, // Distans = 20 km
      });

      // 1. Schaktutsläpp: 200 m3 * 3.5 = 700 kg CO2e
      expect(result.excavationEmissionsKgCo2e).toBe(700);

      // 2. Rörutsläpp: 281.6 kg * 1.8 = 506.88 kg CO2e
      expect(result.pipeMaterialEmissionsKgCo2e).toBeCloseTo(506.88, 1);
      expect(result.summary.totalPipeWeightKg).toBeCloseTo(281.6, 1);

      // 3. Transportutsläpp:
      // Massor bort: 180 ton
      // Massor in: 180 ton
      // Rör in: 0.2816 ton
      // Totalt: 360.2816 ton
      // Utsläpp: 360.2816 ton * 20 km * 0.08 kg/ton-km = 576.45 kg CO2e
      expect(result.transportEmissionsKgCo2e).toBeCloseTo(576.45, 1);

      // Totalt: 700 + 506.88 + 576.45 = 1783.33 kg CO2e
      expect(result.totalEmissionsKgCo2e).toBeCloseTo(1783.33, 1);
    });

    it('kastar fel för ogiltiga schaktmått', () => {
      expect(() => calculateVaProjectClimate({
        trenchLengthM: 0,
        trenchWidthM: 1,
        trenchDepthM: 1,
        reusePercentage: 50,
        pipes: [],
        transportDistanceKm: 10,
      })).toThrow();
    });
  });
});
