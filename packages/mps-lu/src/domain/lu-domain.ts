// LU Domain Types (Frozen)

export type ArtifactReference = string;
export type ReleaseHash = string;
export type RuleId = string;
export type RuleVersion = string;

// Canonical Geometry
export interface CanonicalGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: readonly number[][][];
}

// Relevant Document
export interface RelevantDocument {
  title: string;
  type: "decision" | "injunction" | "notification" | "inspection";
  metadata: Record<string, any>;
}

// Rule Predicate
export type RulePredicateType =
  | "SPATIAL_DISTANCE_THRESHOLD"
  | "SPATIAL_INTERSECTION"
  | "DOCUMENT_TYPE"
  | "DOCUMENT_KEYWORD";

export interface RulePredicate {
  type: RulePredicateType;
  field: string;
  operator: "EQUALS" | "CONTAINS" | "INTERSECTS" | "GREATER_THAN" | "LESS_THAN";
  value: unknown;
}

// Assessment Finding (internal type)
export interface AssessmentFinding {
  finding_id: string;
  rule_id: RuleId;
  rule_version: RuleVersion;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  evidence_refs: readonly ArtifactReference[];
  explanation: string;
}

// Spatial Evidence Artifact Payload
export interface SpatialEvidencePayload {
  property_ref: ArtifactReference;
  layer_ref: {
    layer_id: string;
    layer_version: string;
  };
  geometry: CanonicalGeometry;
  source_metadata: {
    provider: string;
    dataset: string;
    dataset_version: string;
    retrieved_at: string; // ISO8601
  };
  query_context: {
    query_id: string;
    query_type: string;
    parameters: Record<string, any>;
  };
}

// Document Evidence Artifact Payload
export interface DocumentEvidencePayload {
  property_ref: ArtifactReference;
  document_ref: ArtifactReference;
  relevant_document: RelevantDocument;
  source_metadata: {
    provider: string;
    retrieved_at: string; // ISO8601
  };
}

// Localization Assessment Artifact Payload
export interface LocalizationAssessmentPayload {
  property_ref: ArtifactReference;
  findings: readonly AssessmentFinding[];
  evidence_refs: readonly ArtifactReference[];
  rule_refs: readonly {
    rule_id: RuleId;
    rule_version: RuleVersion;
  }[];
  system_summary: string;
  consultant_commentary_ref?: ArtifactReference;
}

// Spatial Query Contract
export interface SpatialQueryRequest {
  property_ref: ArtifactReference;
  geometry: CanonicalGeometry;
  layers_to_query: readonly string[];
  buffer_distance_meters?: number;
}

export interface SpatialQueryResult {
  query_id: string;
  timestamp: string; // ISO8601
  evidences: readonly ArtifactReference[];
}
