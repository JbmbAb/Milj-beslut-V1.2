import type {
  MapLayerKey,
  MpfCodeType,
  MpfDecisionSummary,
  MpfGateDecision,
  MpfGeofenceLayerRequirement,
  MpfPermitClass,
  PermitCodeProfile,
} from '../types';

export type { MpfCodeType, MpfGateDecision, MpfPermitClass } from '../types';
export type MpfOperationStrategy = 'ewc-primary' | 'strongest-wins';

export const MPF_REGISTRY_VERSION = '2026.05.24';

const MAP_LAYER_LABELS: Record<MapLayerKey, string> = {
  CADASTRE: 'Fastighet',
  NATURA2000: 'Natura 2000',
  FLOOD_RISK: 'Översvämningsrisk',
  SOIL: 'Mark / jord',
  INFRASTRUCTURE: 'Infrastruktur',
  GROUNDWATER: 'Grundvatten',
  PROTECTED_SPECIES: 'Skyddade arter',
  NOISE: 'Buller',
};

export interface MpfThreshold {
  code: string;
  codeType: MpfCodeType;
  description: string;
  permitClass: MpfPermitClass;
  thresholdValue: number;
  /** Alternativ tröskel vid känsligt läge (t.ex. vattenskyddsområde) */
  sensitiveThresholdValue?: number;
  /** Alternativ klass vid känsligt läge */
  sensitivePermitClass?: MpfPermitClass;
  thresholdUnit: string;
  mpfReference: string;
  requiresEnvironmentalImpactAssessment: boolean;
}

export interface MpfEvaluationResult {
  code: string;
  codeType: MpfCodeType;
  quantityPerYear: number;
  unit: string;
  isSensitiveArea: boolean;
  threshold: MpfThreshold | null;
  gateDecision: MpfGateDecision;
  permitClass: MpfPermitClass | null;
  mpfReference: string | null;
  requiresEia: boolean;
  notes: string;
}

export interface MpfOperationEvaluation {
  quantityPerYear: number;
  ewcEvaluation: MpfEvaluationResult;
  sniEvaluation: MpfEvaluationResult | null;
  ewcPermitProfile: MpfPermitProfileDefinition | null;
  sniPermitProfile: MpfPermitProfileDefinition | null;
  primaryPermitProfile: MpfPermitProfileDefinition | null;
  gateDecision: MpfGateDecision;
  permitClass: MpfPermitClass | null;
  primaryCodeType: MpfCodeType | null;
  activityCode: string | null;
  requiresEia: boolean;
  isSensitiveArea: boolean;
  requiredMapLayers: MapLayerKey[];
  notes: string;
  advisorySignals: string[];
}

export interface MpfActivityProfile {
  activityCode: string;
  legalReference: string;
  regulatoryTrack: PermitCodeProfile['regulatoryTrack'];
  thresholdTon: number | null;
  thresholdScope: PermitCodeProfile['thresholdScope'];
  riskTier: PermitCodeProfile['riskTier'];
  requiredMapLayers: MapLayerKey[];
  timelineBufferWeeks: number;
}

export interface MpfPermitProfileDefinition {
  code: string;
  codeType: MpfCodeType;
  activityCode: string | null;
  legalReference: string;
  regulatoryTrack: PermitCodeProfile['regulatoryTrack'];
  thresholdTon: number | null;
  thresholdScope: PermitCodeProfile['thresholdScope'];
  riskTier: PermitCodeProfile['riskTier'];
  requiredMapLayers: MapLayerKey[];
  timelineBufferWeeks: number;
}

interface MpfCodeProfileMapping {
  code: string;
  codeType: MpfCodeType;
  activityCode: string;
  legalReference?: string;
  regulatoryTrack?: PermitCodeProfile['regulatoryTrack'];
  thresholdTon?: number | null;
  thresholdScope?: PermitCodeProfile['thresholdScope'];
  riskTier?: PermitCodeProfile['riskTier'];
  requiredMapLayers?: MapLayerKey[];
  timelineBufferWeeks?: number;
}

const MPF_THRESHOLDS: ReadonlyArray<MpfThreshold> = [
  {
    code: '17 05 03*',
    codeType: 'EWC',
    description: 'Förorenad jord och sten (farligt avfall)',
    permitClass: 'A',
    thresholdValue: 10,
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.100',
    requiresEnvironmentalImpactAssessment: true,
  },
  {
    code: '19 13 01*',
    codeType: 'EWC',
    description: 'Fast avfall från sanering av mark (farligt)',
    permitClass: 'A',
    thresholdValue: 10,
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.100',
    requiresEnvironmentalImpactAssessment: true,
  },
  {
    code: '17 05 04',
    codeType: 'EWC',
    description: 'Jord och sten (ej farligt)',
    permitClass: 'B',
    thresholdValue: 50000,
    sensitiveThresholdValue: 10000,
    sensitivePermitClass: 'B',
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.200',
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: '17 05 06',
    codeType: 'EWC',
    description: 'Muddermassor (ej farliga)',
    permitClass: 'B',
    thresholdValue: 50000,
    sensitiveThresholdValue: 10000,
    sensitivePermitClass: 'B',
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.200',
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: '17 05 08',
    codeType: 'EWC',
    description: 'Stenmaterial från spårbyggnad',
    permitClass: 'C',
    thresholdValue: 10000,
    sensitiveThresholdValue: 10,
    sensitivePermitClass: 'C',
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.300',
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: '38.21',
    codeType: 'SNI',
    description: 'Behandling och bortskaffande av farligt avfall',
    permitClass: 'A',
    thresholdValue: 1,
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.010',
    requiresEnvironmentalImpactAssessment: true,
  },
  {
    code: '38.11',
    codeType: 'SNI',
    description: 'Insamling av icke-farligt avfall',
    permitClass: 'C',
    thresholdValue: 10000,
    sensitiveThresholdValue: 1000,
    sensitivePermitClass: 'C',
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.310',
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: '38.12',
    codeType: 'SNI',
    description: 'Insamling av farligt avfall',
    permitClass: 'B',
    thresholdValue: 100,
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.160',
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: '38.22',
    codeType: 'SNI',
    description: 'Behandling och bortskaffande av icke-farligt avfall',
    permitClass: 'B',
    thresholdValue: 50000,
    sensitiveThresholdValue: 10000,
    sensitivePermitClass: 'B',
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.220',
    requiresEnvironmentalImpactAssessment: false,
  },
  {
    code: '39.00',
    codeType: 'SNI',
    description: 'Sanering och annan avfallshantering',
    permitClass: 'B',
    thresholdValue: 1000,
    thresholdUnit: 'ton/år',
    mpfReference: 'MPF 90.250',
    requiresEnvironmentalImpactAssessment: false,
  },
];

const MPF_ACTIVITY_PROFILES: ReadonlyArray<MpfActivityProfile> = [
  {
    activityCode: '90.131',
    legalReference: 'Miljöprövningsförordningen 29 kap. 31 par.',
    regulatoryTrack: 'NOTIFICATION',
    thresholdTon: null,
    thresholdScope: null,
    riskTier: 'LOW',
    requiredMapLayers: ['CADASTRE', 'FLOOD_RISK'],
    timelineBufferWeeks: 0,
  },
  {
    activityCode: '90.30',
    legalReference: 'Miljöprövningsförordningen 29 kap. 30 par.',
    regulatoryTrack: 'NOTIFICATION',
    thresholdTon: 10,
    thresholdScope: 'AT_ONCE',
    riskTier: 'MEDIUM',
    requiredMapLayers: ['CADASTRE', 'FLOOD_RISK', 'GROUNDWATER'],
    timelineBufferWeeks: 1,
  },
  {
    activityCode: '90.50',
    legalReference: 'Miljöprövningsförordningen 29 kap. 50 par.',
    regulatoryTrack: 'NOTIFICATION',
    thresholdTon: 25,
    thresholdScope: 'AT_ONCE',
    riskTier: 'HIGH',
    requiredMapLayers: ['CADASTRE', 'FLOOD_RISK', 'GROUNDWATER', 'NATURA2000'],
    timelineBufferWeeks: 2,
  },
  {
    activityCode: '90.80',
    legalReference: 'Miljöprövningsförordningen 29 kap. 80 par.',
    regulatoryTrack: 'NOTIFICATION',
    thresholdTon: 1000,
    thresholdScope: 'PER_YEAR',
    riskTier: 'MEDIUM',
    requiredMapLayers: ['CADASTRE', 'FLOOD_RISK', 'NOISE'],
    timelineBufferWeeks: 1,
  },
  {
    activityCode: '90.110',
    legalReference: 'Miljöprövningsförordningen 29 kap. 110 par.',
    regulatoryTrack: 'NOTIFICATION',
    thresholdTon: 10000,
    thresholdScope: 'PER_YEAR',
    riskTier: 'MEDIUM',
    requiredMapLayers: ['CADASTRE', 'FLOOD_RISK', 'NOISE'],
    timelineBufferWeeks: 1,
  },
];

const MPF_CODE_PROFILE_MAPPINGS: ReadonlyArray<MpfCodeProfileMapping> = [
  { code: '90.131', codeType: 'SNI', activityCode: '90.131' },
  { code: '90.30', codeType: 'SNI', activityCode: '90.30' },
  { code: '90.50', codeType: 'SNI', activityCode: '90.50' },
  { code: '90.80', codeType: 'SNI', activityCode: '90.80' },
  { code: '90.110', codeType: 'SNI', activityCode: '90.110' },
  {
    code: '17 05 04',
    codeType: 'EWC',
    activityCode: '90.131',
    legalReference: 'Avfallsförordningen bilaga 3',
    regulatoryTrack: 'NOTIFICATION',
    thresholdTon: null,
    thresholdScope: null,
    riskTier: 'LOW',
    requiredMapLayers: ['CADASTRE', 'SOIL'],
    timelineBufferWeeks: 0,
  },
  {
    code: '17 05 03*',
    codeType: 'EWC',
    activityCode: '90.50',
    legalReference: 'Avfallsförordningen bilaga 3',
    regulatoryTrack: 'PERMIT',
    thresholdTon: null,
    thresholdScope: null,
    riskTier: 'HIGH',
    requiredMapLayers: ['CADASTRE', 'SOIL', 'GROUNDWATER', 'NATURA2000'],
    timelineBufferWeeks: 2,
  },
];

const GATE_DECISION_PRIORITY: Record<MpfGateDecision, number> = {
  EXEMPT: 0,
  UNKNOWN_CODE: 1,
  NOTIFICATION_REQUIRED: 2,
  PERMIT_REQUIRED: 3,
};

function inferCodeType(code: string): MpfCodeType {
  return code.includes('.') ? 'SNI' : 'EWC';
}

function normalizeCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

function dedupeLayers(input: MapLayerKey[]): MapLayerKey[] {
  return Array.from(new Set(input));
}

function buildFallbackPermitProfile(input: {
  code: string;
  codeType: MpfCodeType;
  municipality?: string;
}): PermitCodeProfile {
  return {
    code: input.code,
    codeType: input.codeType,
    activityCode: null,
    legalReference: 'Manual legal verification required',
    regulatoryTrack: 'NONE',
    thresholdTon: null,
    thresholdScope: null,
    riskTier: 'MEDIUM',
    requiresGeofencing: true,
    requiredMapLayers: input.codeType === 'EWC' ? ['CADASTRE', 'SOIL'] : ['CADASTRE', 'FLOOD_RISK'],
    timelineBufferWeeks: 1,
    humanReviewRequired: true,
    reviewNote: 'Auto classification is advisory only and must be approved by a human legal reviewer.',
    municipality: input.municipality || null,
  };
}

function deriveActivityCodeFromReference(reference: string | null): string | null {
  if (!reference) return null;
  const match = reference.match(/(\d+\.\d+)/);
  return match?.[1] ?? null;
}

function fallbackRiskTierForThreshold(threshold: MpfThreshold): PermitCodeProfile['riskTier'] {
  if (threshold.permitClass === 'A') return 'HIGH';
  if (threshold.permitClass === 'B') return 'MEDIUM';
  return 'LOW';
}

function fallbackTrackForThreshold(threshold: MpfThreshold): PermitCodeProfile['regulatoryTrack'] {
  if (threshold.permitClass === 'A' || threshold.permitClass === 'B') return 'PERMIT';
  if (threshold.permitClass === 'C') return 'NOTIFICATION';
  return 'NONE';
}

function fallbackLayersForCodeType(codeType: MpfCodeType): MapLayerKey[] {
  return codeType === 'EWC' ? ['CADASTRE', 'SOIL'] : ['CADASTRE', 'FLOOD_RISK'];
}

function findThreshold(code: string, codeType?: MpfCodeType): MpfThreshold | null {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;

  const exact = MPF_THRESHOLDS.find((candidate) => {
    if (codeType && candidate.codeType !== codeType) return false;
    return normalizeCode(candidate.code) === normalizedCode;
  });
  if (exact) return exact;

  return (
    MPF_THRESHOLDS.find((candidate) => {
      if (codeType && candidate.codeType !== codeType) return false;
      return normalizeCode(candidate.code).startsWith(normalizedCode);
    }) ?? null
  );
}

function buildUnknownCodeResult(code: string, quantity: number, codeType: MpfCodeType): MpfEvaluationResult {
  return {
    code,
    codeType,
    quantityPerYear: quantity,
    unit: 'ton/år',
    isSensitiveArea: false,
    threshold: null,
    gateDecision: 'UNKNOWN_CODE',
    permitClass: null,
    mpfReference: null,
    requiresEia: false,
    notes: `Kod "${code}" hittades inte i MPF-tabellen. Manuell juridisk granskning krävs.`,
  };
}

function buildGateDecision(
  threshold: MpfThreshold,
  quantity: number,
  isSensitiveArea: boolean,
): Pick<MpfEvaluationResult, 'gateDecision' | 'notes' | 'permitClass'> {
  const permitClass =
    isSensitiveArea && threshold.sensitivePermitClass ? threshold.sensitivePermitClass : threshold.permitClass;
  const thresholdValue =
    isSensitiveArea && threshold.sensitiveThresholdValue !== undefined
      ? threshold.sensitiveThresholdValue
      : threshold.thresholdValue;

  const sensitiveNote = isSensitiveArea ? ' (Känsligt läge identifierat)' : '';

  if (permitClass === 'U') {
    return {
      gateDecision: 'EXEMPT',
      permitClass: 'U',
      notes: `Aktiviteten är undantagen från tillstånds- och anmälningsplikt enligt ${threshold.mpfReference}.${sensitiveNote}`,
    };
  }

  if (quantity >= thresholdValue) {
    if (permitClass === 'A' || permitClass === 'B') {
      return {
        gateDecision: 'PERMIT_REQUIRED',
        permitClass,
        notes:
          `Mängd (${quantity} ${threshold.thresholdUnit}) överskrider tröskeln ` +
          `(${thresholdValue} ${threshold.thresholdUnit}) för klass ${permitClass}.${sensitiveNote} ` +
          `Tillståndsansökan krävs enligt ${threshold.mpfReference}.`,
      };
    }

    return {
      gateDecision: 'NOTIFICATION_REQUIRED',
      permitClass: 'C',
      notes:
        `Mängd (${quantity} ${threshold.thresholdUnit}) överskrider tröskeln ` +
        `(${thresholdValue} ${threshold.thresholdUnit}) för klass C.${sensitiveNote} ` +
        `Anmälan till tillsynsmyndigheten krävs enligt ${threshold.mpfReference}.`,
    };
  }

  return {
    gateDecision: 'EXEMPT',
    permitClass: 'U',
    notes:
      `Mängd (${quantity} ${threshold.thresholdUnit}) understiger tröskeln ` +
      `(${thresholdValue} ${threshold.thresholdUnit}).${sensitiveNote} ` +
      `Aktiviteten bedöms inte utlösa MPF-krav vid denna volym.`,
  };
}

function pickPrimaryEvaluation(
  ewcEvaluation: MpfEvaluationResult,
  sniEvaluation: MpfEvaluationResult | null,
  strategy: MpfOperationStrategy,
): { evaluation: MpfEvaluationResult; primaryCodeType: MpfCodeType | null } {
  if (strategy === 'ewc-primary') {
    if (ewcEvaluation.gateDecision !== 'UNKNOWN_CODE') {
      return { evaluation: ewcEvaluation, primaryCodeType: 'EWC' };
    }
    if (sniEvaluation) {
      return { evaluation: sniEvaluation, primaryCodeType: 'SNI' };
    }
    return { evaluation: ewcEvaluation, primaryCodeType: ewcEvaluation.threshold ? 'EWC' : null };
  }

  if (!sniEvaluation) {
    return { evaluation: ewcEvaluation, primaryCodeType: ewcEvaluation.threshold ? 'EWC' : null };
  }

  const ewcPriority = GATE_DECISION_PRIORITY[ewcEvaluation.gateDecision];
  const sniPriority = GATE_DECISION_PRIORITY[sniEvaluation.gateDecision];

  if (sniPriority > ewcPriority) {
    return { evaluation: sniEvaluation, primaryCodeType: 'SNI' };
  }

  return { evaluation: ewcEvaluation, primaryCodeType: ewcEvaluation.threshold ? 'EWC' : 'SNI' };
}

export function listMpfThresholds(): ReadonlyArray<MpfThreshold> {
  return MPF_THRESHOLDS;
}

export function listMpfActivityProfiles(): ReadonlyArray<MpfActivityProfile> {
  return MPF_ACTIVITY_PROFILES;
}

export function getMpfThreshold(code: string, codeType?: MpfCodeType): MpfThreshold | null {
  return findThreshold(code, codeType);
}

export function getMpfActivityProfile(activityCode: string): MpfActivityProfile | null {
  const normalizedCode = normalizeCode(activityCode);
  if (!normalizedCode) return null;

  return (
    MPF_ACTIVITY_PROFILES.find((candidate) => normalizeCode(candidate.activityCode) === normalizedCode) ?? null
  );
}

export function getMpfPermitProfileDefinition(input: {
  code: string;
  codeType: MpfCodeType;
}): MpfPermitProfileDefinition | null {
  const normalizedCode = normalizeCode(input.code);
  if (!normalizedCode) return null;

  const mapping =
    MPF_CODE_PROFILE_MAPPINGS.find(
      (candidate) =>
        candidate.codeType === input.codeType && normalizeCode(candidate.code) === normalizedCode,
    ) ?? null;
  if (!mapping) return getFallbackPermitProfileDefinition(input);

  const activityProfile = getMpfActivityProfile(mapping.activityCode);
  if (!activityProfile) return getFallbackPermitProfileDefinition(input);

  return {
    code: mapping.code,
    codeType: mapping.codeType,
    activityCode: mapping.activityCode,
    legalReference: mapping.legalReference ?? activityProfile.legalReference,
    regulatoryTrack: mapping.regulatoryTrack ?? activityProfile.regulatoryTrack,
    thresholdTon:
      mapping.thresholdTon === undefined ? activityProfile.thresholdTon : mapping.thresholdTon,
    thresholdScope:
      mapping.thresholdScope === undefined ? activityProfile.thresholdScope : mapping.thresholdScope,
    riskTier: mapping.riskTier ?? activityProfile.riskTier,
    requiredMapLayers: dedupeLayers(mapping.requiredMapLayers ?? activityProfile.requiredMapLayers),
    timelineBufferWeeks:
      mapping.timelineBufferWeeks === undefined
        ? activityProfile.timelineBufferWeeks
        : Math.max(0, mapping.timelineBufferWeeks),
  };
}

function getFallbackPermitProfileDefinition(input: {
  code: string;
  codeType: MpfCodeType;
}): MpfPermitProfileDefinition | null {
  const threshold = getMpfThreshold(input.code, input.codeType);
  if (!threshold) return null;

  return {
    code: threshold.code,
    codeType: threshold.codeType,
    activityCode: deriveActivityCodeFromReference(threshold.mpfReference),
    legalReference: threshold.mpfReference,
    regulatoryTrack: fallbackTrackForThreshold(threshold),
    thresholdTon: threshold.thresholdValue,
    thresholdScope: 'PER_YEAR',
    riskTier: fallbackRiskTierForThreshold(threshold),
    requiredMapLayers: fallbackLayersForCodeType(threshold.codeType),
    timelineBufferWeeks: threshold.permitClass === 'A' ? 2 : threshold.permitClass === 'B' ? 1 : 0,
  };
}

export function resolvePermitCodeProfile(input: {
  code: string;
  codeType: MpfCodeType;
  municipality?: string;
}): PermitCodeProfile {
  const definition = getMpfPermitProfileDefinition(input);
  if (!definition) {
    return buildFallbackPermitProfile(input);
  }

  return {
    code: definition.code,
    codeType: definition.codeType,
    activityCode: definition.activityCode,
    legalReference: definition.legalReference,
    regulatoryTrack: definition.regulatoryTrack,
    thresholdTon: definition.thresholdTon,
    thresholdScope: definition.thresholdScope,
    riskTier: definition.riskTier,
    requiresGeofencing: definition.requiredMapLayers.length > 0,
    requiredMapLayers: definition.requiredMapLayers,
    timelineBufferWeeks: definition.timelineBufferWeeks,
    humanReviewRequired: true,
    reviewNote: 'Auto classification is advisory only and must be approved by a human legal reviewer.',
    municipality: input.municipality || null,
  };
}

export function resolveRequiredMapLayersFromOperation(
  evaluation: Pick<MpfOperationEvaluation, 'ewcPermitProfile' | 'sniPermitProfile'>,
): MapLayerKey[] {
  const layers: MapLayerKey[] = [];
  if (evaluation.ewcPermitProfile) {
    layers.push(...evaluation.ewcPermitProfile.requiredMapLayers);
  }
  if (evaluation.sniPermitProfile) {
    layers.push(...evaluation.sniPermitProfile.requiredMapLayers);
  }
  return dedupeLayers(layers);
}

export function buildGeofenceLayerRequirements(
  layers: MapLayerKey[],
  evaluation: Pick<MpfOperationEvaluation, 'primaryPermitProfile' | 'ewcEvaluation'>,
): MpfGeofenceLayerRequirement[] {
  const legalReference =
    evaluation.primaryPermitProfile?.legalReference ??
    evaluation.ewcEvaluation.mpfReference ??
    'MPF screening';

  return layers.map((key) => ({
    key,
    label: MAP_LAYER_LABELS[key] ?? key,
    reason: `Krävs enligt ${legalReference}`,
    severity: 'required' as const,
  }));
}

export function toMpfDecisionSummary(evaluation: MpfOperationEvaluation): MpfDecisionSummary {
  const requiredMapLayers = evaluation.requiredMapLayers.length
    ? evaluation.requiredMapLayers
    : resolveRequiredMapLayersFromOperation(evaluation);

  return {
    gateDecision: evaluation.gateDecision,
    primaryCodeType: evaluation.primaryCodeType,
    activityCode: evaluation.activityCode,
    notes: evaluation.notes,
    advisorySignals: [...evaluation.advisorySignals],
    ewcEvaluation: {
      code: evaluation.ewcEvaluation.code,
      gateDecision: evaluation.ewcEvaluation.gateDecision,
      permitClass: evaluation.ewcEvaluation.permitClass,
      mpfReference: evaluation.ewcEvaluation.mpfReference,
      notes: evaluation.ewcEvaluation.notes,
    },
    sniEvaluation: evaluation.sniEvaluation
      ? {
          code: evaluation.sniEvaluation.code,
          gateDecision: evaluation.sniEvaluation.gateDecision,
          permitClass: evaluation.sniEvaluation.permitClass,
          mpfReference: evaluation.sniEvaluation.mpfReference,
          notes: evaluation.sniEvaluation.notes,
        }
      : null,
    primaryPermitProfile: evaluation.primaryPermitProfile
      ? {
          activityCode: evaluation.primaryPermitProfile.activityCode,
          legalReference: evaluation.primaryPermitProfile.legalReference,
          regulatoryTrack: evaluation.primaryPermitProfile.regulatoryTrack,
          riskTier: evaluation.primaryPermitProfile.riskTier,
        }
      : null,
    requiredMapLayers,
    geofenceLayers: buildGeofenceLayerRequirements(requiredMapLayers, evaluation),
    isSensitiveArea: evaluation.isSensitiveArea,
    registryVersion: MPF_REGISTRY_VERSION,
  };
}

export function evaluateMpfCode(input: {
  code: string;
  quantity: number;
  codeType?: MpfCodeType;
  isSensitiveArea?: boolean;
}): MpfEvaluationResult {
  const code = String(input.code || '').trim();
  const quantity = Math.max(0, Number(input.quantity || 0));
  const codeType = input.codeType ?? inferCodeType(code);
  const isSensitiveArea = !!input.isSensitiveArea;
  const threshold = getMpfThreshold(code, input.codeType);

  if (!threshold) {
    const result = buildUnknownCodeResult(code, quantity, codeType);
    return { ...result, isSensitiveArea };
  }

  const outcome = buildGateDecision(threshold, quantity, isSensitiveArea);
  return {
    code,
    codeType: threshold.codeType,
    quantityPerYear: quantity,
    unit: threshold.thresholdUnit,
    isSensitiveArea,
    threshold,
    gateDecision: outcome.gateDecision,
    permitClass: outcome.permitClass as MpfPermitClass,
    mpfReference: threshold.mpfReference,
    requiresEia:
      (threshold.requiresEnvironmentalImpactAssessment || isSensitiveArea) &&
      outcome.gateDecision === 'PERMIT_REQUIRED',
    notes: outcome.notes,
  };
}

export function getMpfGateDecision(code: string, quantity: number, codeType?: MpfCodeType, isSensitiveArea?: boolean): MpfGateDecision {
  return evaluateMpfCode({ code, quantity, codeType, isSensitiveArea }).gateDecision;
}

export function mergeGateDecisions(decisions: MpfGateDecision[]): MpfGateDecision {
  if (decisions.includes('PERMIT_REQUIRED')) return 'PERMIT_REQUIRED';
  if (decisions.includes('NOTIFICATION_REQUIRED')) return 'NOTIFICATION_REQUIRED';
  if (decisions.includes('UNKNOWN_CODE')) return 'UNKNOWN_CODE';
  return 'EXEMPT';
}

export function evaluateMpfOperation(input: {
  ewcCode: string;
  sniCode?: string;
  quantity: number;
  strategy?: MpfOperationStrategy;
  isSensitiveArea?: boolean;
}): MpfOperationEvaluation {
  const quantity = Math.max(0, Number(input.quantity || 0));
  const strategy = input.strategy ?? 'ewc-primary';
  const isSensitiveArea = !!input.isSensitiveArea;

  const ewcEvaluation = evaluateMpfCode({
    code: input.ewcCode,
    quantity,
    codeType: 'EWC',
    isSensitiveArea,
  });
  const sniEvaluation = input.sniCode
    ? evaluateMpfCode({
        code: input.sniCode,
        quantity,
        codeType: 'SNI',
        isSensitiveArea,
      })
    : null;
  const ewcPermitProfile = getMpfPermitProfileDefinition({ code: input.ewcCode, codeType: 'EWC' });
  const sniPermitProfile = input.sniCode
    ? getMpfPermitProfileDefinition({ code: input.sniCode, codeType: 'SNI' })
    : null;

  const primary = pickPrimaryEvaluation(ewcEvaluation, sniEvaluation, strategy);
  const primaryPermitProfile =
    primary.primaryCodeType === 'EWC'
      ? ewcPermitProfile
      : primary.primaryCodeType === 'SNI'
        ? sniPermitProfile
        : null;
  const advisorySignals: string[] = [];

  if (strategy === 'ewc-primary' && sniEvaluation && ewcEvaluation.gateDecision !== 'UNKNOWN_CODE') {
    if (sniEvaluation.gateDecision !== ewcEvaluation.gateDecision) {
      advisorySignals.push(
        `SNI-kod ${sniEvaluation.code} gav ${sniEvaluation.gateDecision.toLowerCase()}, men EWC-koden styr gate-beslutet i fas 1.`,
      );
    }
  }

  if (ewcEvaluation.gateDecision === 'UNKNOWN_CODE' && sniEvaluation) {
    advisorySignals.push(`EWC-kod ${ewcEvaluation.code} saknar regelmatchning; SNI-koden används som fallback.`);
  }

  const requiredMapLayers = resolveRequiredMapLayersFromOperation({
    ewcPermitProfile,
    sniPermitProfile,
  });

  return {
    quantityPerYear: quantity,
    ewcEvaluation,
    sniEvaluation,
    ewcPermitProfile,
    sniPermitProfile,
    primaryPermitProfile,
    gateDecision: primary.evaluation.gateDecision,
    permitClass: primary.evaluation.permitClass,
    primaryCodeType: primary.primaryCodeType,
    activityCode: primaryPermitProfile?.activityCode ?? null,
    requiresEia: primary.evaluation.requiresEia,
    isSensitiveArea,
    requiredMapLayers,
    notes: [primary.evaluation.notes, ...advisorySignals].join(' '),
    advisorySignals,
  };
}
