export type GeoRegulatoryDomainId =
  | 'sewage'
  | 'stormwater_lod'
  | 'building_permit'
  | 'shoreline_protection'
  | 'mass_handling'
  | 'environmental_permit'
  | 'forestry'
  | 'agriculture'
  | 'energy_siting'
  | 'infrastructure_routing';

export type GeoRegulatoryCapability =
  | 'spatial_lookup'
  | 'regulatory_evaluation'
  | 'risk_scoring'
  | 'evidence_bundle'
  | 'matrix_projection'
  | 'document_generation'
  | 'submission_dispatch'
  | 'feedback_ingestion'
  | 'postgis_binding'
  | 'economic_snapshot';

export type GeoRegulatoryEvidenceKind =
  | 'legal_source'
  | 'judgment'
  | 'document'
  | 'postgis_layer'
  | 'raster'
  | 'municipal_rule'
  | 'provider_metadata'
  | 'economic_assumption';

export type GeoRegulatoryOutputKind =
  | 'assessment'
  | 'risk_flags'
  | 'requirements'
  | 'matrix_rows'
  | 'document_draft'
  | 'submission_package'
  | 'feedback_review';

export type GeoRegulatoryGateId =
  | 'before_binding_assessment'
  | 'before_official_submission'
  | 'before_decision_classification'
  | 'before_matrix_mutation'
  | 'before_economic_commit';

export type GeoRegulatoryPackStatus = 'planned' | 'active' | 'pilot';

export interface GeoRegulatoryHumanReviewGate {
  id: GeoRegulatoryGateId;
  label: string;
  reason: string;
  requiredRole: 'case_handler' | 'legal_reviewer' | 'environmental_reviewer' | 'financial_reviewer' | 'admin';
}

export interface GeoRegulatoryEvidenceRef {
  kind: GeoRegulatoryEvidenceKind;
  sourceId: string;
  label: string;
  version?: string;
  uri?: string;
}

export interface GeoRegulatoryAssessmentFlag {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  label: string;
  rationale: string;
  evidenceSourceIds: string[];
}

export interface GeoRegulatoryOutputProfile {
  kind: GeoRegulatoryOutputKind;
  label: string;
  description: string;
}

export interface GeoRegulatoryRulePack {
  id: string;
  domain: GeoRegulatoryDomainId;
  displayName: string;
  version: string;
  status: GeoRegulatoryPackStatus;
  description: string;
  requiredCapabilities: GeoRegulatoryCapability[];
  requiredEvidenceKinds: GeoRegulatoryEvidenceKind[];
  reviewGates: GeoRegulatoryHumanReviewGate[];
  outputs: GeoRegulatoryOutputProfile[];
}

export interface GeoRegulatoryAssessmentRequest {
  requestId: string;
  domain: GeoRegulatoryDomainId;
  projectId: string;
  requirementCaseId?: string;
  propertyDesignation?: string;
  municipalityCode?: string;
  geometryRef?: string;
  evidence: GeoRegulatoryEvidenceRef[];
  requestedOutputs: GeoRegulatoryOutputKind[];
  initiatedByUserId: string;
}

export interface GeoRegulatoryAssessmentResult {
  requestId: string;
  rulePackId: string;
  domain: GeoRegulatoryDomainId;
  generatedAt: string;
  summary: string;
  flags: GeoRegulatoryAssessmentFlag[];
  suggestedRequirements: string[];
  requiredReviewGates: GeoRegulatoryGateId[];
  evidence: GeoRegulatoryEvidenceRef[];
}

export interface GeoRegulatorySubmissionEnvelope {
  envelopeId: string;
  projectId: string;
  requirementCaseId?: string;
  domain: GeoRegulatoryDomainId;
  documentIds: string[];
  recipientAuthority: string;
  recipientChannel: 'rest' | 'email' | 'webhook' | 'portal' | 'manual';
  evidenceSourceIds: string[];
  preparedByUserId: string;
}

export interface GeoRegulatoryFeedbackSignal {
  signalId: string;
  domain: GeoRegulatoryDomainId;
  sourceSystem: 'authority_callback' | 'municipality_poll' | 'email_ingest' | 'manual';
  projectId?: string;
  requirementCaseId?: string;
  externalReference?: string;
  documentId?: string;
  summary: string;
  receivedAt: string;
}
