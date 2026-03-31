/**
 * mpfThresholdService.ts
 *
 * Regelmotor för MPF-trösklar (Miljöprövningsförordning, SFS 2013:251).
 *
 * Funktioner:
 *   - getMpfThreshold()        — hämtar tröskelregel för ett givet EWC/SNI-kod-par
 *   - evaluateMpfCode()        — utvärderar om en aktivitet kräver tillstånd/anmälan
 *   - listMpfThresholds()      — listar alla konfigurerade trösklar
 *   - getMpfGateDecision()     — returnerar gate-beslut (PERMIT_REQUIRED / NOTIFICATION_REQUIRED / EXEMPT)
 *
 * Grunden för data är MPF bilaga 1 (A/B/C-verksamheter).
 * Utdata är screening-signaler – ersätter inte juridisk granskning.
 */

import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MpfPermitClass = "A" | "B" | "C" | "U";

export type MpfGateDecision =
  | "PERMIT_REQUIRED"
  | "NOTIFICATION_REQUIRED"
  | "EXEMPT"
  | "UNKNOWN_CODE";

export interface MpfThreshold {
  /** EWC-kod (European Waste Catalogue) eller SNI-kod */
  code: string;
  codeType: "EWC" | "SNI";
  description: string;
  /** MPF-verksamhetsklass: A = länsstyrelsens tillstånd, B = miljödomstol, C = anmälan, U = undantagen */
  permitClass: MpfPermitClass;
  /** Kvantitetströskel för klassificering (ton/år, m³/år beroende på enhet) */
  thresholdValue: number;
  thresholdUnit: string;
  /** Förordningsreferens i MPF */
  mpfReference: string;
  requiresEnvironmentalImpactAssessment: boolean;
}

export interface MpfEvaluationResult {
  code: string;
  codeType: "EWC" | "SNI";
  quantityPerYear: number;
  unit: string;
  threshold: MpfThreshold | null;
  gateDecision: MpfGateDecision;
  permitClass: MpfPermitClass | null;
  mpfReference: string | null;
  requiresEia: boolean;
  notes: string;
}

// ─── MPF Threshold Table ──────────────────────────────────────────────────────
// Baserad på MPF (SFS 2013:251) bilaga 1, verksamhetskoder 90.xx och 90.xxx

const MPF_THRESHOLDS: ReadonlyArray<MpfThreshold> = [
  // Deponi och mellanlager – EWC-koder
  {
    code: "17 05 03*",
    codeType: "EWC",
    description: "Förorenad jord och sten (farligt avfall)",
    permitClass: "A",
    thresholdValue: 10,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.100",
    requiresEnvironmentalImpactAssessment: true,
  },
  {
    code: "19 13 01*",
    codeType: "EWC",
    description: "Fast avfall från sanering av mark (farligt)",
    permitClass: "A",
    thresholdValue: 10,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.100",
    requiresEnvironmentalImpactAssessment: true,
  },
  {
    code: "17 05 04",
    codeType: "EWC",
    description: "Jord och sten (ej farligt)",
    permitClass: "B",
    thresholdValue: 50000,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.200",
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: "17 05 06",
    codeType: "EWC",
    description: "Muddermassor (ej farliga)",
    permitClass: "B",
    thresholdValue: 50000,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.200",
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: "17 05 08",
    codeType: "EWC",
    description: "Stenmaterial från spårbyggnad",
    permitClass: "C",
    thresholdValue: 10000,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.300",
    requiresEnvironmentalImpactAssessment: false,
  },
  // Avfallsbehandling – SNI-koder
  {
    code: "38.21",
    codeType: "SNI",
    description: "Behandling och bortskaffande av farligt avfall",
    permitClass: "A",
    thresholdValue: 1,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.010",
    requiresEnvironmentalImpactAssessment: true,
  },
  {
    code: "38.11",
    codeType: "SNI",
    description: "Insamling av icke-farligt avfall",
    permitClass: "C",
    thresholdValue: 10000,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.310",
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: "38.12",
    codeType: "SNI",
    description: "Insamling av farligt avfall",
    permitClass: "B",
    thresholdValue: 100,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.160",
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: "38.22",
    codeType: "SNI",
    description: "Behandling och bortskaffande av icke-farligt avfall",
    permitClass: "B",
    thresholdValue: 50000,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.220",
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: "39.00",
    codeType: "SNI",
    description: "Sanering och annan avfallshantering",
    permitClass: "B",
    thresholdValue: 1000,
    thresholdUnit: "ton/år",
    mpfReference: "MPF 90.250",
    requiresEnvironmentalImpactAssessment: false,
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Hämtar tröskelkonfiguration för en kod. Matchar exakt eller via prefix.
 */
export function getMpfThreshold(code: string): MpfThreshold | null {
  const normalised = String(code || "").trim();
  if (!normalised) return null;

  const exact = MPF_THRESHOLDS.find(
    (t) => t.code.toLowerCase() === normalised.toLowerCase(),
  );
  if (exact) return exact;

  // Prefix-matchning: t.ex. "17 05" matchar "17 05 03*"
  return (
    MPF_THRESHOLDS.find((t) =>
      t.code.toLowerCase().startsWith(normalised.toLowerCase()),
    ) ?? null
  );
}

export function listMpfThresholds(): ReadonlyArray<MpfThreshold> {
  return MPF_THRESHOLDS;
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

/**
 * Utvärderar om en aktivitet kräver tillstånd, anmälan eller är undantagen.
 *
 * @param code       EWC- eller SNI-kod
 * @param quantity   Mängd per år i tröskels enhet
 * @param codeType   "EWC" | "SNI" – om utelämnad detekteras automatiskt
 */
export function evaluateMpfCode(input: {
  code: string;
  quantity: number;
  codeType?: "EWC" | "SNI";
}): MpfEvaluationResult {
  const code = String(input.code || "").trim();
  const quantity = Math.max(0, Number(input.quantity || 0));
  const threshold = getMpfThreshold(code);

  if (!threshold) {
    logger.warn(`mpfThresholdService: okand kod "${code}" – ingen matchning i MPF-tabellen`);
    return {
      code,
      codeType: input.codeType ?? "EWC",
      quantityPerYear: quantity,
      unit: "ton/år",
      threshold: null,
      gateDecision: "UNKNOWN_CODE",
      permitClass: null,
      mpfReference: null,
      requiresEia: false,
      notes: `Kod "${code}" hittades inte i MPF-tabellen. Manuell juridisk granskning krävs.`,
    };
  }

  let gateDecision: MpfGateDecision;
  let notes: string;

  if (threshold.permitClass === "U") {
    gateDecision = "EXEMPT";
    notes = `Aktiviteten är undantagen från tillstånds- och anmälningsplikt enligt ${threshold.mpfReference}.`;
  } else if (quantity >= threshold.thresholdValue) {
    if (threshold.permitClass === "A" || threshold.permitClass === "B") {
      gateDecision = "PERMIT_REQUIRED";
      notes =
        `Mängd (${quantity} ${threshold.thresholdUnit}) överskrider tröskeln ` +
        `(${threshold.thresholdValue} ${threshold.thresholdUnit}) för klass ${threshold.permitClass}. ` +
        `Tillståndsansökan krävs enligt ${threshold.mpfReference}.`;
    } else {
      gateDecision = "NOTIFICATION_REQUIRED";
      notes =
        `Mängd (${quantity} ${threshold.thresholdUnit}) överskrider tröskeln ` +
        `(${threshold.thresholdValue} ${threshold.thresholdUnit}) för klass C. ` +
        `Anmälan till tillsynsmyndigheten krävs enligt ${threshold.mpfReference}.`;
    }
  } else {
    gateDecision = "EXEMPT";
    notes =
      `Mängd (${quantity} ${threshold.thresholdUnit}) understiger tröskeln ` +
      `(${threshold.thresholdValue} ${threshold.thresholdUnit}). ` +
      `Aktiviteten bedöms inte utlösa MPF-krav vid denna volym.`;
  }

  return {
    code,
    codeType: threshold.codeType,
    quantityPerYear: quantity,
    unit: threshold.thresholdUnit,
    threshold,
    gateDecision,
    permitClass: threshold.permitClass,
    mpfReference: threshold.mpfReference,
    requiresEia: threshold.requiresEnvironmentalImpactAssessment && gateDecision === "PERMIT_REQUIRED",
    notes,
  };
}

/**
 * Kortformsmetod – returnerar enbart gate-beslutet.
 */
export function getMpfGateDecision(code: string, quantity: number): MpfGateDecision {
  return evaluateMpfCode({ code, quantity }).gateDecision;
}
