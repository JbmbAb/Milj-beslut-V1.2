// packages/mps-data-governance/src/DocumentOrchestratorTypes.ts

import { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactContract';

export type DocumentPipelineStep =
  | 'INVENTORY'
  | 'EXTRACT'
  | 'CLASSIFY'
  | 'CHUNK'
  | 'EMBED'
  | 'INDEX'
  | 'VERIFY';

export type DocumentClassification =
  | 'legal_document'
  | 'court_decision'
  | 'environmental_decision'
  | 'technical_report'
  | 'MKB'
  | 'consultant_report'
  | 'map'
  | 'administrative_document'
  | 'unknown';

export type KnowledgeDomain = 'LEGAL' | 'ENVIRONMENTAL_DECISIONS' | 'TECHNICAL' | 'UNKNOWN';

export interface DocumentStateCheckpoint {
  document_id: string;
  source_path: string;
  content_hash: string;
  current_step: DocumentPipelineStep;
  pipeline_version: string;
  ocr_required: boolean;
  classification: DocumentClassification;
  knowledge_domain: KnowledgeDomain;
  error_message?: string;
  retries_attempted: number;
}

export interface DocumentKnowledgeRelease {
  release_id: string;
  generated_at: string;
  pipeline_version: string;
  document_count: number;
  total_size_bytes: number;
  manifest_hash: string;
  index_version_hash: string;
  documents: DocumentStateCheckpoint[];
}

export interface DocumentEvidenceArtifact {
  artifact_id: string;
  artifact_type: 'DOCUMENT_EVIDENCE';
  content_hash: { algorithm: 'sha256'; value: string };
  references: ArtifactReference[];
  payload: {
    document_id: string;
    release_id: string;
    matching_chunks: string[];
    legal_references: string[];
  };
}

export interface DocumentQuarantineRecord {
  document_sha256: string;
  source_path: string;
  pipeline_version: string;
  gate_id: DocumentPipelineStep;
  failure_code: string;
  failure_reason: string;
  timestamp: string;
  quarantine_reference: string;
}
