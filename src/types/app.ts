import type { MapLayerKey } from './project';

export interface AdminAuthUser {
  id: string;
  role: 'ADMIN';
  organisationId: string;
}

export interface AdminAuthLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AdminAuthUser;
}

export type ProjectAccessRole = 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER' | 'AUDITOR';

export interface ProjectMemberRecord {
  id: string;
  userId: string;
  bankidId: string;
  accessRole: ProjectAccessRole;
  createdAt: string;
}

export type ApiDataState = 'loading' | 'ready' | 'empty' | 'unavailable';

export type WorkspaceModuleId = 'core' | 'ansokan' | 'logistik' | 'projekt' | 'gronkoll' | 'admin';

export type IntegrationAvailabilityStatus = 'ready' | 'unavailable' | 'not_configured';

export interface IntegrationAvailabilitySummary {
  status: IntegrationAvailabilityStatus;
  reason: string;
  checkedAt: string;
}

export interface AppBootstrapProjectSummary {
  id: string;
  propertyDesignation: string;
  status: string;
  createdAt: string;
  complianceScore: number | null;
  environmentalScore: number | null;
  fundingRating: string | null;
  regulatoryRiskScore: number | null;
  documentCount: number;
  memberCount: number;
  lastPlanUpdatedAt: string | null;
}

export interface AppBootstrapUser {
  id: string;
  displayName: string;
  bankidId: string;
  role: ProjectAccessRole | 'ADMIN' | 'CONSULTANT' | 'AUDITOR' | 'BANK';
  organisationId: string;
}

export interface AppBootstrapOrganisation {
  id: string;
  name: string;
  orgNumber: string;
}

export interface AppModuleAccess {
  id: WorkspaceModuleId;
  title: string;
  description: string;
  enabled: boolean;
  status: ApiDataState;
  reason: string;
  projectCount: number;
}

export interface AppUiCapabilities {
  authenticated: boolean;
  canCreateProjects: boolean;
  bankIdMode: 'real' | 'mock';
  requiresProjectSelection: boolean;
}

export interface AppBootstrapResponse {
  user: AppBootstrapUser;
  organisation: AppBootstrapOrganisation;
  projects: AppBootstrapProjectSummary[];
  activeProjectId: string | null;
  moduleAccess: AppModuleAccess[];
  integrationAvailability: {
    app: IntegrationAvailabilitySummary;
    dispatch: IntegrationAvailabilitySummary;
    bankId: IntegrationAvailabilitySummary;
    dataSources: IntegrationAvailabilitySummary;
  };
  uiCapabilities: AppUiCapabilities;
  checkedAt: string;
}

export interface ReferenceMapLayerSummary {
  key: MapLayerKey;
  label: string;
  description: string;
}

export interface ReferenceMunicipalitySummary {
  name: string;
  projectCount: number;
  documentCount: number;
}

export interface AdminProjectSummary {
  id: string;
  propertyDesignation: string;
  status: string;
  createdAt: string;
  organisation: {
    id: string;
    name: string;
    orgNumber: string;
  };
  _count: {
    documents: number;
    members: number;
    accessLogs: number;
  };
}

export interface AdminDashboardSummary {
  generatedAt: string;
  totals: {
    organisations: number;
    users: number;
    projects: number;
    activeProjects: number;
    indexedProjects: number;
    documents: number;
    searches: number;
    auditRecords: number;
    planStates: number;
  };
  documentsByStatus: Array<{ status: string; count: number }>;
  jobsByStatus: Array<{ status: string; count: number }>;
  jobsByType: Array<{ type: string; count: number }>;
  searchPerformance: {
    avgElapsedMs: number;
    avgResults: number;
    latestQueryAt: string | null;
  };
  planning: {
    projectsWithTemplate: number;
    gatesRequired: number;
    gatesPassed: number;
    gatesBlocked: number;
    carbonReadyProjects: number;
  };
  bankRisk: {
    modelVersion: string;
    assessedProjects: number;
    averageReadinessScore: number;
    gatePassRatePct: number;
    verifiedDocCoveragePct: number;
    riskBands: {
      low: number;
      medium: number;
      high: number;
    };
  };
  euTaxonomy: {
    modelVersion: string;
    eligibleProjects: number;
    alignedProjects: number;
    alignmentPct: number;
    criteria: {
      carbonReadyRequired: boolean;
      documentGatePassedRequired: boolean;
      noBlockedRequiredGates: boolean;
      minVerifiedDocsRequired: number;
    };
  };
  templateUsage: Array<{ templateId: string; count: number }>;
}

export type AdminExamSummary = AdminDashboardSummary;
