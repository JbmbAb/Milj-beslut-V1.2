
export interface ExternalHealthCheck {
  key: string;
  label: string;
  category: string;
  status: 'healthy' | 'degraded' | 'error' | 'not_configured';
  mode: 'live' | 'derived' | 'config';
  configured: boolean;
  detail: string;
  endpoint: string | null;
  responseCode: number | null;
  activation?: string | null;
}

export interface ExternalHealthReport {
  checkedAt: string;
  overall: 'ok' | 'degraded' | 'error';
  totals: {
    total: number;
    healthy: number;
    degraded: number;
    error: number;
    notConfigured: number;
    configured: number;
    liveChecked: number;
  };
  categories: Array<{
    name: string;
    total: number;
    healthy: number;
    degraded: number;
    error: number;
    notConfigured: number;
  }>;
  checks: ExternalHealthCheck[];
}

export interface AdminDatabaseDumpResponse {
  generatedAt: string;
  countByTable: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export interface PartitionStat {
  tableName: string;
  partitionName: string;
  partitionKey: string;
  rowCount: number;
  sizeBytes: number;
}

export interface DbStatsResponse {
  generatedAt: string;
  totals: {
    documents: number;
    /** Kravrader from RequirementRecord (structured case pipeline) */
    requirementsFromCases: number;
    /** Kravrader from ExtractedRequirement (Outlook / email-ingestion pipeline) */
    requirementsExtracted: number;
    /** Combined total of all requirement rows across both pipelines */
    requirements: number;
    municipalities: number;
  };
  /** Threshold validation: true = actual value meets or exceeds the minimum */
  thresholds: {
    minRequirements: number;
    minMunicipalities: number;
    minDocuments: number;
    requirementsOk: boolean;
    municipalitiesOk: boolean;
    documentsOk: boolean;
    allOk: boolean;
  };
  perMunicipality: Array<{
    municipality: string;
    documents: number;
    requirements: number;
  }>;
  geodata?: {
    lmMarkCount: number;
    lmByggnadCount: number;
    sguJordarterCount: number;
    sguBlockighetCount: number;
    sguPunktobjektCount: number;
  };
  partitions?: PartitionStat[];
}

/** Granular database analysis: category breakdowns, quality distribution, coverage gaps. */
export interface DbAnalysisResponse {
  generatedAt: string;

  /** Analytical breakdown of RequirementRecord rows */
  requirements: {
    /** Count per requirement category */
    byCategory: Array<{ category: string; count: number }>;
    /** Count per coding-confidence band (HIGH / MEDIUM / LOW) */
    byCodingConfidence: Array<{ confidence: string; count: number }>;
    /** Count per requirement level (e.g. "mandatory", "recommended") */
    byLevel: Array<{ level: string; count: number }>;
    /** Count per statusInNotification value */
    byStatus: Array<{ status: string; count: number }>;
    /** How many rows are flagged as municipality-specific */
    municipalitySpecificCount: number;
    /** How many rows are flagged as minimum requirements */
    minimumRequirementCount: number;
    /** How many requirements have at least one citation */
    withCitationsCount: number;
    /** Total citation rows across all requirements */
    citationsTotal: number;
  };

  /** Analytical breakdown of DocumentRecord rows */
  documents: {
    /** Count per processing status enum value */
    byStatus: Array<{ status: string; count: number }>;
    /** Count per decisionType value */
    byDecisionType: Array<{ decisionType: string; count: number }>;
    /** Count per legalStatus value */
    byLegalStatus: Array<{ legalStatus: string; count: number }>;
    /**
     * Distribution of municipalityConfidence values, bucketed:
     * high ≥ 0.8, medium [0.5, 0.8), low < 0.5, missing = null
     */
    municipalityConfidenceBuckets: {
      high: number;
      medium: number;
      low: number;
      missing: number;
    };
  };

  /** Coverage and gap analysis between DocumentRecord and RequirementRecord */
  coverage: {
    /** Documents that have at least one RequirementRecord or linked ExtractedRequirement */
    documentsWithRequirements: number;
    /** Documents that have zero RequirementRecord and zero linked ExtractedRequirement rows */
    documentsWithoutRequirements: number;
    /** Percentage of documents covered by at least one requirement (0–100) */
    coverageRatioPct: number;
    /** Mean RequirementRecord rows per document that has any */
    avgRequirementsPerCoveredDocument: number;
    /** Named municipalities appearing in both document and requirement sets */
    municipalitiesWithBoth: number;
    /** Named municipalities that have documents but no requirements extracted yet */
    municipalitiesDocumentsOnly: string[];
    /** Named municipalities that appear in requirements but have no document records */
    municipalitiesRequirementsOnly: string[];
  };

  /** Analytical breakdown of ExtractedRequirement rows (email-ingestion pipeline) */
  extractedRequirements: {
    /** Count per category */
    byCategory: Array<{ category: string; count: number }>;
    /** Count per requirementLevel */
    byLevel: Array<{ level: string; count: number }>;
    /** Distribution of confidence score, bucketed: high ≥ 0.8, medium [0.5, 0.8), low < 0.5 */
    confidenceBuckets: {
      high: number;
      medium: number;
      low: number;
    };
  };
}

/** Snapshot of actual database rows per key table — "vad finns i db". */
export interface DbContentsResponse {
  generatedAt: string;
  /** Query limit used for each table */
  limit: number;

  organisations: {
    total: number;
    rows: Array<{
      id: string;
      name: string;
      orgNumber: string;
      createdAt: string;
      userCount: number;
      projectCount: number;
    }>;
  };

  projects: {
    total: number;
    rows: Array<{
      id: string;
      propertyDesignation: string;
      status: string;
      organisationName: string;
      createdAt: string;
      documentCount: number;
      requirementCount: number;
    }>;
  };

  documents: {
    total: number;
    rows: Array<{
      id: string;
      subject: string;
      status: string;
      municipality: string | null;
      decisionType: string | null;
      legalStatus: string | null;
      fileSize: number | null;
      createdAt: string;
    }>;
  };

  requirementCases: {
    total: number;
    rows: Array<{
      id: string;
      caseKey: string;
      municipality: string | null;
      authorityType: string | null;
      documentType: string | null;
      reviewStatus: string;
      requirementCount: number;
      createdAt: string;
    }>;
  };

  requirements: {
    total: number;
    rows: Array<{
      id: string;
      requirementCode: string;
      category: string;
      subcategory: string;
      level: string;
      codingConfidence: string;
      statusInNotification: string;
      minimumRequirement: boolean;
      createdAt: string;
    }>;
  };

  extractedRequirements: {
    total: number;
    rows: Array<{
      id: string;
      municipality: string | null;
      documentId: string | null;
      category: string;
      subcategory: string | null;
      requirementLevel: string;
      confidence: number;
      parsedAt: string;
    }>;
  };

  emailMessages: {
    total: number;
    rows: Array<{
      messageId: string;
      sender: string | null;
      subject: string | null;
      status: string;
      attachmentCount: number;
      /** receivedAt from Outlook ingestion; null when not yet set */
      createdAt: string | null;
    }>;
  };

  pipelineRuns: {
    total: number;
    rows: Array<{
      id: string;
      status: string;
      messagesIngested: number | null;
      errors: number | null;
      startedAt: string;
      finishedAt: string | null;
    }>;
  };
}

/** Status of a single planned feature in the app completion manifest */
export type FeatureStatus = 'DONE' | 'PARTIAL' | 'PENDING';

/** A single feature entry in the app completion manifest */
export interface AppFeature {
  id: string;
  label: string;
  category: string;
  status: FeatureStatus;
  /** Optional note — explains what remains for PARTIAL/PENDING */
  note?: string;
}

/** Knowledge-graph search response */
export interface KnowledgeGraphSearchResponse {
  query: string;
  nodes: Array<{
    id: string;
    nodeType: string;
    name: string;
    metadata: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    relation: string;
    weight: number;
  }>;
  stats: {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Array<{ nodeType: string; count: number }>;
  };
}

/** Operativ täckning — integrationer, data och geodata i aktuell miljö */
export interface OperationalCoverageSnapshot {
  percent: number;
  integrations: { configured: number; total: number; percent: number };
  datasources: { connected: number; total: number; percent: number };
  municipalities: {
    covered: number;
    target: number;
    productionTarget: number;
    percent: number;
  };
  documentRequirementCoveragePct: number | null;
  sguCoverageMode: 'sample' | 'complete';
  notes: string[];
}

/** Response shape for GET /api/admin/completion — "hur många procent återstår?" */
export interface AppCompletionResponse {
  checkedAt: string;
  /** 0–100: andel features med status DONE (strikt, utan halvpoäng) */
  donePercent: number;
  /** 0–100: kod/implementering inkl. PARTIAL som 50 % */
  implementationPercent: number;
  /** 0–100: features som inte är fullt DONE (PARTIAL + PENDING) */
  remainingPercent: number;
  /** Integrationer, datakällor och kommundata — fylls i av API-lagret */
  operationalCoverage?: OperationalCoverageSnapshot;
  counts: {
    total: number;
    done: number;
    partial: number;
    pending: number;
  };
  /** Features grouped by category */
  categories: Array<{
    name: string;
    total: number;
    done: number;
    partial: number;
    pending: number;
    /** 0–100 percent done within this category */
    percent: number;
    features: AppFeature[];
  }>;
}

/** Response shape for GET /api/admin/app-status — "är appen igång?" */
export interface AppStatusResponse {
  /** ISO timestamp when the check ran */
  checkedAt: string;
  /** Overall application health: "ok" | "degraded" | "error" */
  overall: 'ok' | 'degraded' | 'error';
  /** Backend application server status */
  app: {
    status: 'ok' | 'error';
    version: string;
    /** Seconds the Node process has been running */
    uptimeSeconds: number;
    environment: string;
  };
  /** Database connectivity status */
  db: {
    status: 'ok' | 'error';
    latencyMs: number | null;
  };
  /** Aggregated datasource availability */
  datasources: {
    total: number;
    connected: number;
    errors: number;
    permitRequired: number;
    allOpenSourcesActive: boolean;
  };
}

export interface SearchInfoField {
  field: string;
  label: string;
  type?: string;
  example?: string | boolean;
  values?: string[];
  source?: string;
  description?: string;
  searchable?: boolean;
}

export interface SearchInfoMode {
  id: string;
  label: string;
  description: string;
}

export interface SearchInfoResponse {
  ok: boolean;
  info: {
    description: string;
    modes: SearchInfoMode[];
    fullTextFields: SearchInfoField[];
    metadataFilterFields: SearchInfoField[];
    lexicalMatchFields: SearchInfoField[];
    queryParameters: Record<string, string>;
  };
}

export type RequirementVerificationStatus = 'AUTO' | 'REVIEWED' | 'VERIFIED' | 'REJECTED';
export type RequirementCaseReviewStatus = 'AUTO' | 'NEEDS_REVIEW' | 'VERIFIED' | 'LOCKED';

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
  caseReviewStatus: RequirementCaseReviewStatus;
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

export interface AdminReviewRequirementCasePayload {
  caseReviewStatus: RequirementCaseReviewStatus;
  validatedBy?: string;
  notes?: string;
}

export interface AdminVerifyCitationPayload {
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string;
  pageNumber?: number;
  comment?: string;
}

// ─── Full Status Analysis ─────────────────────────────────────────────────────

export interface IntegrationStatusEntry {
  name: string;
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'LIVE' | 'MOCK' | 'ERROR';
  endpoint?: string;
  note?: string;
}

export interface DbTableSummary {
  table: string;
  rows: number;
  latestEntry?: string;
}

export interface EnvConfigEntry {
  name: string;
  category: string;
  configured: boolean;
  maskedValue?: string;
  required: boolean;
}

/** Full system status analysis — GET /api/admin/full-status */
export interface FullStatusReport {
  generatedAt: string;
  overall: 'ok' | 'degraded' | 'error';

  app: {
    version: string;
    environment: string;
    uptimeSeconds: number;
    nodeVersion: string;
  };

  db: {
    status: 'ok' | 'error';
    latencyMs: number | null;
  };

  completion: AppCompletionResponse;

  integrations: IntegrationStatusEntry[];

  datasources: {
    total: number;
    connected: number;
    cards: Array<{
      name: string;
      status: string;
      activation: string;
      lastChecked?: string;
    }>;
  };

  database: {
    tables: DbTableSummary[];
    totalRows: number;
    recentAuditEvents: Array<{ action: string; entityType: string; timestamp: string }>;
    recentSearchQueries: Array<{ query: string; resultCount: number; createdAt: string }>;
    pipelineRuns: Array<{
      runId: string;
      runType: string;
      status: string;
      startedAt: string;
      processedCount: number;
    }>;
  };

  environment: {
    configured: number;
    total: number;
    requiredMissing: string[];
    vars: EnvConfigEntry[];
  };

  backgroundServices: {
    outlookScheduler: {
      running: boolean;
      intervalMs: number;
      totalRuns: number;
      lastRunAt?: string;
      nextRunAt?: string;
      lastResult?: {
        emailsProcessed: number;
        emailsSkipped: number;
        attachmentsSaved: number;
        errors: string[];
      };
    };
  };

  domstolRssScheduler: {
    running: boolean;
    intervalMs: number;
    totalRuns: number;
    lastRunAt?: string;
    nextRunAt?: string;
    lastRunResult?: {
      newJudgments: number;
      updatedJudgments: number;
      errors?: string[];
    };
  };

  backup: {
    totalBackups: number;
    latestBackupAt?: string;
    latestBackupStatus?: string;
    latestBackupSizeBytes?: number;
  };

  recentErrors: Array<{
    id: string;
    severity: string;
    message: string;
    capturedAt: string;
    type: string;
  }>;
}

