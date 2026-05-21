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

export interface PermitCodeProfile {
  code: string;
  codeType: WasteCode['type'];
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
