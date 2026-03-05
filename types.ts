
export enum DecisionType {
  BIFALL = 'BIFALL',
  AVSLAG = 'AVSLAG',
  UNKNOWN = 'OKÄNT'
}

export enum ApplicationStatus {
  DRAFT = 'UTKAST',
  SUBMITTED = 'INSKICKAD',
  REVIEWING = 'HANDLÄGGS',
  COMPLETED = 'AVSLUTAD'
}

export type InterfaceMode = 'LOGISTICS_MARKET' | 'PERMIT_PORTAL' | 'PROJECT_MANAGER' | 'COMPLIANCE_AUDIT' | 'ADMIN_CONSOLE';

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

export type DispatchProvider = 'MOCK_FRAKTBORS' | 'TIMOCOM' | 'TRANS_EU';
export type DispatchBookingStatus = 'QUOTED' | 'BOOKED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | 'BLOCKED';
export type DriverJournalStatus = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
export type LimsSourceType = 'API' | 'SFTP' | 'MANUAL';

export interface DispatchQuote {
  id: string;
  provider: DispatchProvider;
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  estimatedCostSek: number;
  etaHours: number;
  currency: 'SEK';
  createdAt: string;
}

export interface TransportBooking {
  id: string;
  quoteId: string;
  provider: DispatchProvider;
  status: DispatchBookingStatus;
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  co2EstimateKg: number;
  plannedPickupAt: string;
  plannedDeliveryAt: string;
  externalReference: string;
  createdAt: string;
  updatedAt: string;
}

export interface DriverJournalEntry {
  id: string;
  bookingId: string;
  driverName: string;
  vehicleId: string;
  origin: string;
  destination: string;
  wasteCode: string;
  tons: number;
  startedAt: string;
  endedAt: string | null;
  odometerStartKm: number;
  odometerEndKm: number | null;
  gpsTrackHash: string;
  status: DriverJournalStatus;
  signedByDriver: boolean;
  signedByReviewer: boolean;
  driverSignatureId: string | null;
  reviewerSignatureId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LimsMetric {
  key: string;
  value: number;
  unit: string;
  maxAllowed: number | null;
  exceeded: boolean;
}

export interface LimsReport {
  id: string;
  bookingId: string | null;
  sampleId: string;
  labName: string;
  source: LimsSourceType;
  analyzedAt: string;
  rawReference: string;
  metrics: LimsMetric[];
  passed: boolean;
  verifiedByHuman: boolean;
  reviewer: string | null;
  reviewerSignatureId: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface Receiver {
  id: string;
  name: string;
  lat: number;
  lng: number;
  allowedCodes: string[];
  type: 'DEPONI' | 'MELLANLAGRING' | 'RECYCLING';
  isHazardousAllowed: boolean;
  distance?: number;
  co2Estimate?: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
  immutable: boolean;
  signatureId?: string;
}

export interface IntegrationSource {
  id: string;
  name: string;
  provider: string;
  dataType: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastSync: string;
  complexity: 1 | 2 | 3 | 4 | 5;
}

export interface ComplianceScore {
  score: number;
  totalSteps: number;
  completedSteps: number;
  missingDocuments: string[];
}

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  required: boolean;
  value: string;
  options?: string[];
}

export interface EnvironmentalForm {
  id: string;
  title: string;
  wasteCode: string;
  sections: {
    title: string;
    fields: FormField[];
  }[];
}

export interface SpeciesObservation {
  name: string;
  status: 'Rödlistad' | 'Fridlyst' | 'Livskraftig';
  distance: number;
}

export interface WeatherRisk {
  level: 'Låg' | 'Medel' | 'Hög';
  description: string;
  action: string;
}

export interface Stats {
  total: number;
  bifall: number;
  avslag: number;
  municipalities: number;
}

export interface Task {
  id: string;
  title: string;
  startWeek: number;
  duration: number;
  type: 'LEGAL' | 'TECHNICAL' | 'FIELD' | 'ADMIN';
  status: 'DONE' | 'ONGOING' | 'TODO';
}

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
  driverJournals: DriverJournalEntry[];
  limsReports: LimsReport[];
  carbonSummary: CarbonSummary;
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
  id: number;
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

export type SearchMode = 'semantic' | 'lexical' | 'hybrid';

export interface SearchFilters {
  municipality?: string;
  decisionType?: string;
  wasteType?: string;
  status?: string;
  legalStatus?: string;
  hazardousFlag?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchResultItem {
  documentId: string;
  score: number;
  snippet: string;
  whyMatched: string;
  citations?: Array<{
    citationId: string;
    chunkIndex: number | null;
    quote: string;
    sourceLabel: string;
    confidence: number;
  }>;
  metadata: {
    projectId: string | null;
    projectName: string | null;
    organisationName: string | null;
    subject: string;
    originalName: string;
    receivedTime: string | null;
    municipality: string | null;
    decisionType: string | null;
    wasteType: string | null;
    hazardousFlag: boolean | null;
    legalStatus: string | null;
    status: string;
  };
}

export interface SearchQueryRequest {
  projectId?: string;
  query: string;
  mode: SearchMode;
  topK?: number;
  strictEvidence?: boolean;
  filters?: SearchFilters;
}

export interface SearchQueryResponse {
  mode: SearchMode;
  scope: 'project' | 'global';
  elapsedMs: number;
  totalCandidates: number;
  guardrails?: {
    strictEvidence: boolean;
    evidenceFilteredOut: number;
    citationCoveragePct: number;
    semanticEngine?: 'pgvector' | 'json-fallback' | 'disabled';
    draftWatermark: string;
  };
  results: SearchResultItem[];
}

export interface SearchStatusBucket {
  status: string;
  count: number;
}

export interface SearchStatusResponse {
  documents: SearchStatusBucket[];
  jobs: SearchStatusBucket[];
  summary?: {
    documentsTotal: number;
    metadataOnlyDocuments: number;
    textExtractedDocuments: number;
    embeddedDocuments: number;
    failedDocuments: number;
    jobsPending: number;
    jobsRunning: number;
    jobsDone: number;
    jobsFailed: number;
    staleRunningJobs: number;
    totalChunks: number;
    embeddedChunks: number;
    chunkEmbeddingCoveragePct: number;
  };
}

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

export interface AdminExamSummary {
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

export interface AdminDatabaseDumpResponse {
  generatedAt: string;
  countByTable: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export type RequirementVerificationStatus = 'AUTO' | 'REVIEWED' | 'VERIFIED' | 'REJECTED';

export interface AdminRequirementCase {
  id: string;
  caseKey: string;
  projectId: string;
  documentId: string;
  organisationId: string;
  municipality: string | null;
  authorityType: string | null;
  authorityName: string | null;
  diarienummer: string | null;
  documentType: string | null;
  documentDate: string | null;
  sourceFile: string;
  sourceSubject: string | null;
  reviewStatus: RequirementVerificationStatus;
  validatedBy: string | null;
  validatedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRequirementRow {
  id: string;
  requirementCode: string;
  caseId: string;
  documentId: string;
  projectId: string;
  sourceType: string;
  category: string;
  subcategory: string;
  requirementTextQuote: string;
  interpretedRequirement: string;
  level: string;
  legalReference: string | null;
  deadlineText: string | null;
  controlFrequency: string | null;
  sanctionText: string | null;
  triggerCondition: string | null;
  wasteType: string | null;
  ewcCode: string | null;
  maxAmountTon: string | null;
  maxStorageTime: string | null;
  linkConstruction: boolean;
  linkLeachate: boolean;
  linkControlProgram: boolean;
  linkRisk: boolean;
  templateSection: string | null;
  templateField: string | null;
  supportingAttachment: string | null;
  minimumRequirement: boolean;
  municipalitySpecific: boolean;
  statusInNotification: string;
  comment: string | null;
  codingConfidence: string;
  verificationStatus: RequirementVerificationStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  errorType: string | null;
  validationComment: string | null;
  createdAt: string;
  updatedAt: string;
  case?: AdminRequirementCase;
}

export interface AdminRequirementCitation {
  id: string;
  citationCode: string;
  requirementId: string;
  caseId: string;
  documentId: string;
  quoteText: string;
  pageNumber: number | null;
  charStart: number | null;
  charEnd: number | null;
  extractor: string | null;
  verificationStatus: RequirementVerificationStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  comment: string | null;
  createdAt: string;
  requirement?: Pick<
    AdminRequirementRow,
    'id' | 'requirementCode' | 'category' | 'subcategory' | 'verificationStatus'
  >;
  case?: Pick<AdminRequirementCase, 'id' | 'caseKey' | 'municipality' | 'authorityName'>;
}

export interface AdminRequirementsSummary {
  generatedAt: string;
  scope: 'VERIFIED_ONLY' | 'INCLUDE_PRELIMINARY';
  warning: string | null;
  totals: {
    requirements: number;
    cases: number;
    citations: number;
    verifiedRequirements: number;
    excludedRequirements: number;
  };
  quality: {
    municipalityCoveragePct: number;
    authorityCoveragePct: number;
    verifiedRequirementsPct: number;
    rejectedRequirements: number;
  };
  tableA: Array<{
    authorityType: string;
    authorityName: string;
    documentType: string;
    caseCount: number;
  }>;
  tableB: Array<{
    category: string;
    requirementCount: number;
  }>;
  tableC: Array<{
    municipality: string;
    ytkonstruktion: number;
    dagvattenLakvatten: number;
  }>;
  tableD: Array<{
    wasteType: string;
    ewcCode: string;
    requirementCount: number;
  }>;
}

export interface AdminVerifyRequirementPayload {
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string;
  validationComment?: string;
  errorType?: string;
}

export interface AdminVerifyCitationPayload {
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string;
  pageNumber?: number;
  comment?: string;
}
