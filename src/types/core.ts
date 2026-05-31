import type { MapLayerKey } from './project';

export enum DecisionType {
  BIFALL = 'BIFALL',
  AVSLAG = 'AVSLAG',
  UNKNOWN = 'OKÄNT',
}

export enum ApplicationStatus {
  DRAFT = 'UTKAST',
  SUBMITTED = 'INSKICKAD',
  REVIEWING = 'HANDLÄGGS',
  COMPLETED = 'AVSLUTAD',
}

export type InterfaceMode =
  | 'LOGISTICS_MARKET'
  | 'PERMIT_PORTAL'
  | 'PROJECT_MANAGER'
  | 'COMPLIANCE_AUDIT'
  | 'ADMIN_CONSOLE'
  | 'Core_WORKFLOW';

export interface User {
  id: string;
  name: string;
  personalNumber: string;
  isAuthenticated: boolean;
}

export interface WasteCode {
  code: string;
  name: string;
  type: 'SNI' | 'EWC';
  requirements: {
    storageTime?: string;
    maxAmount?: string;
    safetyDistance?: string;
    legalReference: string;
    checklist?: string[];
  };
}

export type PermitRegulatoryTrack = 'NONE' | 'NOTIFICATION' | 'PERMIT';
export type PermitThresholdScope = 'AT_ONCE' | 'PER_YEAR';
export type PermitRiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type MpfCodeType = WasteCode['type'];
export type MpfPermitClass = 'A' | 'B' | 'C' | 'U';
export type MpfGateDecision = 'PERMIT_REQUIRED' | 'NOTIFICATION_REQUIRED' | 'EXEMPT' | 'UNKNOWN_CODE';

export interface MpfEvaluationSummary {
  code: string;
  gateDecision: MpfGateDecision;
  permitClass: MpfPermitClass | null;
  mpfReference: string | null;
  notes: string;
}

export interface MpfPermitProfileSummary {
  activityCode: string | null;
  legalReference: string;
  regulatoryTrack: PermitRegulatoryTrack;
  riskTier: PermitRiskTier;
}

export interface MpfGeofenceLayerRequirement {
  key: MapLayerKey;
  label: string;
  reason: string;
  severity: 'required' | 'advisory';
}

export interface MpfDecisionSummary {
  gateDecision: MpfGateDecision;
  primaryCodeType: MpfCodeType | null;
  activityCode: string | null;
  notes: string;
  advisorySignals: string[];
  ewcEvaluation: MpfEvaluationSummary;
  sniEvaluation: MpfEvaluationSummary | null;
  primaryPermitProfile: MpfPermitProfileSummary | null;
  requiredMapLayers: MapLayerKey[];
  geofenceLayers: MpfGeofenceLayerRequirement[];
  isSensitiveArea: boolean;
  registryVersion: string;
}

export interface PermitCodeProfile {
  code: string;
  codeType: WasteCode['type'];
  activityCode?: string | null;
  legalReference: string;
  regulatoryTrack: PermitRegulatoryTrack;
  thresholdTon: number | null;
  thresholdScope: PermitThresholdScope | null;
  riskTier: PermitRiskTier;
  requiresGeofencing: boolean;
  requiredMapLayers: MapLayerKey[];
  timelineBufferWeeks: number;
  humanReviewRequired: boolean;
  reviewNote: string;
  municipality: string | null;
}
