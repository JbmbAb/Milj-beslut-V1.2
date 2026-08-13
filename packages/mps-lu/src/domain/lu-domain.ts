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
// OWNER FREEZE 2026-08-12: RelevantDocument has exactly ONE canonical type owner —
// domain/RelevantDocument.ts. This file previously declared an identical copy; two parallel
// declarations of one semantic contract can drift apart silently (same pattern as the
// duplicated AssessmentFinding below, which is registered but out of scope here).
import type { RelevantDocument } from "./RelevantDocument";
export type { RelevantDocument, RelevantDocumentMetadata } from "./RelevantDocument";

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
