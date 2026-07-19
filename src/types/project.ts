import type { DecisionType, PermitCodeProfile } from './core';
import type {
  AuditEntry,
  DispatchQuote,
  DriverJournalEntry,
  LimsReport,
  ProjectStorageArea,
  TransportBooking,
} from './transport';
import type { Task } from './shared';

export type CoreModuleKey =
  | 'PERMIT_PORTAL'
  | 'LOGISTICS_MARKET'
  | 'PROJECT_MANAGER'
  | 'COMPLIANCE_AUDIT'
  | 'FIELD_SAMPLING';

export type ModuleReadiness = 'NOT_READY' | 'READY' | 'BLOCKED';

export interface ModuleIntegrationStatus {
  module: CoreModuleKey;
  readiness: ModuleReadiness;
  dependencyNote: string;
}

export interface BrandingProfile {
  organizationName: string;
  logoUrl: string;
  layoutTemplate: 'CORPORATE' | 'AUTHORITIES' | 'COMPACT';
  primaryColor: string;
}

export type ArchiveCategory = 'PROJECT_PLAN' | 'PERMIT' | 'RISK' | 'FIELD' | 'FINANCE' | 'OTHER';

export interface ProjectArchiveDocument {
  id: string;
  name: string;
  module: CoreModuleKey;
  category: ArchiveCategory;
  status: 'DRAFT' | 'VERIFIED' | 'ARCHIVED';
  uploadedAt: string;
  storagePath: string;
  tags: string[];
}

export interface SamplingPreparationItem {
  id: string;
  label: string;
  done: boolean;
}

export interface SamplingPreparation {
  enabled: boolean;
  requiresPreparationNow: boolean;
  protocolTemplate: string;
  chainOfCustodyTemplate: string;
  plannedServiceWindow: string;
  checklist: SamplingPreparationItem[];
}

export type ProjectType = 'ENV_PERMIT' | 'VA' | 'INFRA' | 'REMEDIATION' | 'ENERGY';

export type StageGateType = 'PERMIT_REQUIRED' | 'RISK_REVIEW' | 'DOCUMENT_CONTROL' | 'CARBON_CHECK';

export type StageGateStatus = 'PENDING' | 'PASSED' | 'BLOCKED' | 'NOT_REQUIRED';

export type MapLayerKey =
  | 'CADASTRE'
  | 'NATURA2000'
  | 'FLOOD_RISK'
  | 'SOIL'
  | 'INFRASTRUCTURE'
  | 'GROUNDWATER'
  | 'PROTECTED_SPECIES'
  | 'NOISE';

export interface ProjectStageGate {
  id: string;
  type: StageGateType;
  label: string;
  required: boolean;
  status: StageGateStatus;
  reason?: string;
  lastEvaluatedAt?: string;
  lastEvaluationHash?: string;
  details?: Record<string, unknown>;
}

export interface ProjectTemplatePack {
  id: string;
  projectType: ProjectType;
  name: string;
  requiredGates: StageGateType[];
  defaultLayers: {
    base: MapLayerKey[];
    optional: MapLayerKey[];
  };
  defaultChecklist: string[];
  defaultDocuments: Array<{
    name: string;
    category: ArchiveCategory;
    module: CoreModuleKey;
  }>;
}

export type CarbonMethod = 'LOCAL_DISTANCE';

export interface CarbonInput {
  tons: number;
  distanceKm?: number;
  manualDistanceKm?: number;
  transportMode: 'TRUCK' | 'RAIL' | 'SHIP';
  materialType: 'SOIL' | 'ROCK' | 'WASTE' | 'MIXED';
  emissionFactorKgCo2ePerTonKm?: number;
}

export interface CarbonResult {
  method: CarbonMethod;
  totalKgCo2e: number;
  distanceKmUsed: number;
  quality: 'ROUTED' | 'MANUAL_DISTANCE' | 'ESTIMATED';
  emissionFactorKgCo2ePerTonKm: number;
  breakdown: {
    transportKgCo2e: number;
    notes: string[];
  };
  calculatedAt: string;
  inputVersion: string;
}

export interface CarbonSummary {
  lastInput: CarbonInput | null;
  lastResult: CarbonResult | null;
  history: CarbonResult[];
}

export interface MapLayerSelection {
  base: MapLayerKey[];
  optional: MapLayerKey[];
  enabled: MapLayerKey[];
  unavailable: MapLayerKey[];
}

export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  relevance: string;
}

export interface ProjectPlan {
  name: string;
  revision: string;
  projectType: ProjectType;
  templateId: string;
  background: string;
  description: string;
  goals: { id: string; text: string }[];
  location: { lat: number; lng: number; address: string; propertyId: string };
  stakeholders: Stakeholder[];
  phases: ProjectPhase[];
  complianceScore: number;
  auditTrail: AuditEntry[];
  branding: BrandingProfile;
  moduleIntegrations: ModuleIntegrationStatus[];
  documentArchive: ProjectArchiveDocument[];
  samplingPreparation: SamplingPreparation;
  stageGates: ProjectStageGate[];
  mapLayerSelection: MapLayerSelection;
  permitCodeProfile: PermitCodeProfile | null;
  dispatchQuotes: DispatchQuote[];
  transportBookings: TransportBooking[];
  storageAreas: ProjectStorageArea[];
  driverJournals: DriverJournalEntry[];
  limsReports: LimsReport[];
  carbonSummary: CarbonSummary;
  predictiveScores?: {
    regulatoryRisk: {
      score: number;
      probabilityRfi: number;
      probabilityInjunction: number;
      confidence: number;
      topRiskFactors: string[];
    };
    environmentalRisk: {
      score: number;
      groundwaterImpact: number;
      biodiversityImpact: number;
      floodingImpact: number;
    };
    fundingRisk: {
      score: number;
      rating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'C';
      eligibleForGreenLoan: boolean;
    };
  };
}

export interface ProjectPhase {
  id: string;
  title: string;
  status: 'TODO' | 'ONGOING' | 'DONE';
  tasks: Task[];
  isLocked: boolean;
  requiresSignature: boolean;
}

export interface Permit {
  id: string;
  filename: string;
  checksum: string;
  received_date: string;
  property_id: string;
  municipality: string;
  waste_codes: string;
  decision_type: DecisionType;
  full_text: string;
  processed_at: string;
  applicant_company?: string;
  lat?: number;
  lng?: number;
  consultant_company?: string;
  contact_person?: string;
  email?: string;
}
