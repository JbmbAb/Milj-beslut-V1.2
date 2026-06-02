/**
 * svensktVattenService.ts
 * 
 * Implementering av Svenskt Vattens beräkningsmodeller:
 * 1. P110 Dagvattenavledning: Rationella metoden + Dahlströms regnintensitetsformel (2010)
 *    inklusive sweep-analys för fördröjningsmagasin.
 * 2. Klimatberäkningsverktyg för VA-anläggningsprojekt: Utsläpp av växthusgaser (CO2e)
 *    vid schaktning, rörläggning och transport.
 */

import { logger } from '../logger';

// ==========================================
// 1. P110 & DAHLSTRÖM 2010 MODEL TYPES
// ==========================================

export interface StormwaterCalculationInput {
  areaM2: number;               // Avrinningsområdets totala area i kvm
  runoffCoefficient: number;    // Avrinningskoefficient (0 - 1.0)
  returnPeriodYears: number;    // Återkomsttid i år (t.ex. 2, 5, 10, 20)
  durationMinutes: number;      // Regnvaraktighet/rinntid i minuter (minst 5)
  climateFactor: number;        // Klimatfaktor (t.ex. 1.25)
  allowedOutflowLs?: number;    // Tillåtet utflöde i l/s (valfritt, för magasinberäkning)
}

export interface VolumeSweepPoint {
  durationMinutes: number;
  intensityLsHa: number;
  inflowLs: number;
  volumeM3: number;
}

export interface StormwaterCalculationResult {
  modelType: string;
  catchmentAreaHa: number;
  reducedAreaHa: number;
  rainIntensityLsHa: number;
  dimensioningFlowLs: number;
  climateFactor: number;
  allowedOutflowLs?: number;
  requiredVolumeM3?: number;
  criticalDurationMinutes?: number;
  maxRequiredVolumeM3?: number;
  volumeCurve?: VolumeSweepPoint[];
}

// ==========================================
// 2. KLIMATBERÄKNING (VA-ANLÄGGNING) TYPES
// ==========================================

export interface PipeInput {
  material: 'PVC' | 'PE' | 'PP' | 'CONCRETE' | 'DUCTILE_IRON';
  diameterMm: number;           // Ytterdiameter (DN) i mm
  lengthM: number;              // Längd i meter
}

export interface VaClimateInput {
  trenchLengthM: number;        // Schaktlängd i meter
  trenchWidthM: number;         // Schaktbredd i meter
  trenchDepthM: number;         // Schaktdjup i meter
  reusePercentage: number;      // Andel schaktmassor som återanvänds på plats (%)
  pipes: PipeInput[];           // Rörledningar
  transportDistanceKm: number;  // Genomsnittligt transportavstånd för massor och material
}

export interface VaClimateResult {
  modelType: string;
  excavationEmissionsKgCo2e: number;
  pipeMaterialEmissionsKgCo2e: number;
  transportEmissionsKgCo2e: number;
  totalEmissionsKgCo2e: number;
  summary: {
    excavatedVolumeM3: number;
    excavatedWeightTons: number;
    reusedWeightTons: number;
    importedWeightTons: number;
    totalPipeWeightKg: number;
  };
}

// ==========================================
// DAHLSTRÖMS REGNINTENSITET FORMEL (2010)
// ==========================================

/**
 * Beräknar dimensionerande regnintensitet (l/(s * ha)) enligt Dahlström (2010).
 * Formel: i = 190 * T^(1/3) * ln(t_i) / (t_i^0.98) + 2
 * @param returnPeriodMonths Återkomsttid i månader (1 till 120 månader rekommenderat)
 * @param durationMinutes Varaktighet i minuter (5 till 1440 minuter)
 */
export function calculateDahlstromIntensity(returnPeriodMonths: number, durationMinutes: number): number {
  const d = Math.max(5, durationMinutes); // Dahlströms formel är giltig för t >= 5 min
  const t = Math.max(1, returnPeriodMonths); // Återkomsttid i månader

  const lnD = Math.log(d);
  const term1 = 190 * Math.pow(t, 1 / 3);
  const term2 = lnD / Math.pow(d, 0.98);
  
  return term1 * term2 + 2;
}

// ==========================================
// P110 STORMWATER DIMENSIONING & DETENTION
// ==========================================

/**
 * Utför P110 dagvattenavledning och magasinsdimensionering.
 */
export function calculateStormwaterDetention(input: StormwaterCalculationInput): StormwaterCalculationResult {
  const { areaM2, runoffCoefficient, returnPeriodYears, durationMinutes, climateFactor, allowedOutflowLs } = input;

  if (areaM2 <= 0) throw new Error('Area måste vara större än 0 m²');
  if (runoffCoefficient < 0 || runoffCoefficient > 1) throw new Error('Avrinningskoefficienten måste vara mellan 0 och 1.0');
  if (returnPeriodYears <= 0) throw new Error('Återkomsttid måste vara större än 0 år');
  if (climateFactor <= 0) throw new Error('Klimatfaktor måste vara större än 0');

  const catchmentAreaHa = areaM2 / 10000;
  const reducedAreaHa = catchmentAreaHa * runoffCoefficient;
  const returnPeriodMonths = returnPeriodYears * 12;

  // 1. Beräkna intensitet och dimensionerande flöde för angiven duration
  const rainIntensityLsHa = calculateDahlstromIntensity(returnPeriodMonths, durationMinutes);
  const dimensioningFlowLs = reducedAreaHa * rainIntensityLsHa * climateFactor;

  const result: StormwaterCalculationResult = {
    modelType: 'Svenskt Vatten P110 (Rationella metoden + Dahlström 2010)',
    catchmentAreaHa: Math.round(catchmentAreaHa * 10000) / 10000,
    reducedAreaHa: Math.round(reducedAreaHa * 10000) / 10000,
    rainIntensityLsHa: Math.round(rainIntensityLsHa * 100) / 100,
    dimensioningFlowLs: Math.round(dimensioningFlowLs * 100) / 100,
    climateFactor,
  };

  // 2. Beräkna fördröjningsmagasin om tillåtet utflöde har angetts
  if (allowedOutflowLs !== undefined) {
    if (allowedOutflowLs < 0) throw new Error('Tillåtet utflöde kan inte vara negativt');

    result.allowedOutflowLs = allowedOutflowLs;
    
    // Volym för just det angivna varaktighetsvärdet
    const rawVolume = (dimensioningFlowLs - allowedOutflowLs) * durationMinutes * 60 / 1000;
    result.requiredVolumeM3 = Math.max(0, Math.round(rawVolume * 100) / 100);

    // 3. Regnvaraktighetssvep för att hitta kritiskt regn och max erforderlig magasinsvolym
    // Sveper från 5 min upp till 24 timmar (1440 min)
    const sweepDurations = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
    let maxRequiredVolumeM3 = 0;
    let criticalDurationMinutes = 5;
    const volumeCurve: VolumeSweepPoint[] = [];

    for (const d of sweepDurations) {
      const intens = calculateDahlstromIntensity(returnPeriodMonths, d);
      const inflow = reducedAreaHa * intens * climateFactor;
      const vol = Math.max(0, (inflow - allowedOutflowLs) * d * 60 / 1000);

      volumeCurve.push({
        durationMinutes: d,
        intensityLsHa: Math.round(intens * 100) / 100,
        inflowLs: Math.round(inflow * 100) / 100,
        volumeM3: Math.round(vol * 100) / 100,
      });

      if (vol > maxRequiredVolumeM3) {
        maxRequiredVolumeM3 = vol;
        criticalDurationMinutes = d;
      }
    }

    result.criticalDurationMinutes = criticalDurationMinutes;
    result.maxRequiredVolumeM3 = Math.round(maxRequiredVolumeM3 * 100) / 100;
    result.volumeCurve = volumeCurve;
  }

  return result;
}

// ==========================================
// VA PIPELINE CARBON FOOTPRINT CALCULATOR
// ==========================================

// Standard rörvikter per meter (kg/m) för typiska diametrar
function getPipeWeightPerMeter(material: PipeInput['material'], diameterMm: number): number {
  // Enkel regression / schablonvärden baserat på diameter
  switch (material) {
    case 'PVC':
    case 'PE':
    case 'PP':
      // Plast: ökar kvadratiskt med diameter. Schablon: ca 3 kg/m vid DN160, 11 kg/m vid DN315
      return 0.00011 * Math.pow(diameterMm, 2);
    case 'CONCRETE':
      // Betongrör: mycket tyngre. Schablon: ca 110 kg/m vid DN300, 260 kg/m vid DN500
      return 0.001 * Math.pow(diameterMm, 2);
    case 'DUCTILE_IRON':
      // Segjärnsrör: Schablon: ca 18 kg/m vid DN100, 62 kg/m vid DN300
      return 0.0006 * Math.pow(diameterMm, 2);
    default:
      return 0;
  }
}

// CO2e emissionsfaktorer per kg rörmaterial (kg CO2e / kg rör)
const PIPE_EMISSION_FACTORS: Record<PipeInput['material'], number> = {
  PVC: 2.5,          // PVC: högre utsläpp vid tillverkning
  PE: 2.0,           // PE-HD: standard material
  PP: 1.8,           // PP
  CONCRETE: 0.15,    // Betong: lågt per kg men rörvikt är extremt hög
  DUCTILE_IRON: 1.6, // Segjärn
};

/**
 * Beräknar klimatpåverkan (CO2e) för ett VA-anläggningsprojekt.
 */
export function calculateVaProjectClimate(input: VaClimateInput): VaClimateResult {
  const { trenchLengthM, trenchWidthM, trenchDepthM, reusePercentage, pipes, transportDistanceKm } = input;

  if (trenchLengthM <= 0 || trenchWidthM <= 0 || trenchDepthM <= 0) {
    throw new Error('Schaktets dimensioner (längd, bredd, djup) måste vara större än 0');
  }
  if (reusePercentage < 0 || reusePercentage > 100) {
    throw new Error('Återanvändningsprocent måste vara mellan 0 och 100%');
  }

  // 1. Schaktberäkningar
  const excavatedVolumeM3 = trenchLengthM * trenchWidthM * trenchDepthM;
  const soilDensityTonM3 = 1.8; // Standarddensitet för jord/grusschakt
  const excavatedWeightTons = excavatedVolumeM3 * soilDensityTonM3;

  const reusedWeightTons = excavatedWeightTons * (reusePercentage / 100);
  const importedWeightTons = excavatedWeightTons * (1 - reusePercentage / 100);

  // Utsläpp för schaktning med grävmaskin (schablon: 3.5 kg CO2e / m3 schaktad volym)
  const EXCAVATION_FACTOR_KG_CO2E_PER_M3 = 3.5;
  const excavationEmissionsKgCo2e = excavatedVolumeM3 * EXCAVATION_FACTOR_KG_CO2E_PER_M3;

  // 2. Rörberäkningar
  let totalPipeWeightKg = 0;
  let pipeMaterialEmissionsKgCo2e = 0;

  for (const pipe of pipes) {
    if (pipe.lengthM <= 0 || pipe.diameterMm <= 0) continue;
    const weightPerMeter = getPipeWeightPerMeter(pipe.material, pipe.diameterMm);
    const pipeWeightKg = weightPerMeter * pipe.lengthM;
    const emissionFactor = PIPE_EMISSION_FACTORS[pipe.material];

    totalPipeWeightKg += pipeWeightKg;
    pipeMaterialEmissionsKgCo2e += pipeWeightKg * emissionFactor;
  }

  // 3. Transporter
  // Transportera bort överblivna massor: importerade vikten är lika med borttransporterad vikt (balans)
  const massToTransportAwayTons = excavatedWeightTons * (1 - reusePercentage / 100);
  const massToImportTons = importedWeightTons;
  const pipesToImportTons = totalPipeWeightKg / 1000;

  const totalTransportWeightTons = massToTransportAwayTons + massToImportTons + pipesToImportTons;

  // Transportschablon: 0.08 kg CO2e per ton-km
  const TRANSPORT_FACTOR_KG_CO2E_PER_TON_KM = 0.08;
  const transportEmissionsKgCo2e = totalTransportWeightTons * transportDistanceKm * TRANSPORT_FACTOR_KG_CO2E_PER_TON_KM;

  const totalEmissionsKgCo2e = excavationEmissionsKgCo2e + pipeMaterialEmissionsKgCo2e + transportEmissionsKgCo2e;

  return {
    modelType: 'Svenskt Vatten VA-anläggningsprojekt Klimatverktyg',
    excavationEmissionsKgCo2e: Math.round(excavationEmissionsKgCo2e * 100) / 100,
    pipeMaterialEmissionsKgCo2e: Math.round(pipeMaterialEmissionsKgCo2e * 100) / 100,
    transportEmissionsKgCo2e: Math.round(transportEmissionsKgCo2e * 100) / 100,
    totalEmissionsKgCo2e: Math.round(totalEmissionsKgCo2e * 100) / 100,
    summary: {
      excavatedVolumeM3: Math.round(excavatedVolumeM3 * 10) / 10,
      excavatedWeightTons: Math.round(excavatedWeightTons * 10) / 10,
      reusedWeightTons: Math.round(reusedWeightTons * 10) / 10,
      importedWeightTons: Math.round(importedWeightTons * 10) / 10,
      totalPipeWeightKg: Math.round(totalPipeWeightKg * 10) / 10,
    },
  };
}
