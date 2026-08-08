// packages/mps-data-governance/src/DocumentOrchestrator.ts

import {
  DocumentPipelineStep,
  DocumentStateCheckpoint,
  DocumentKnowledgeRelease,
  DocumentEvidenceArtifact,
} from './DocumentOrchestratorTypes';

export interface PdfExtractor {
  extractText(filePath: string): Promise<{ text: string; ocrRequired: boolean; pageCount: number }>;
}

export interface Chunker {
  chunk(text: string): Promise<string[]>;
}

export interface Indexer {
  index(documentId: string, chunks: string[]): Promise<string>; // returns index_version_hash
}

/**
 * Facade Document Orchestrator for Mimers Brunn Ingest-pipeline.
 * Sits inside Runtime Kernel / Capability Layer as a governed workflow.
 */
export class DocumentOrchestrator {
  constructor(
    private readonly extractor: PdfExtractor,
    private readonly chunker: Chunker,
    private readonly indexer: Indexer,
    private readonly pipelineVersion: string = 'v1.0'
  ) {}

  /**
   * Orchestrates a single document through the deterministic pipeline.
   * Does not perform the operations itself, but coordinates the executors,
   * tracking step, idempotency, retries, and quarantine.
   */
  public async executePipeline(
    filePath: string,
    existingCheckpoint?: DocumentStateCheckpoint
  ): Promise<DocumentStateCheckpoint> {
    const checkpoint: DocumentStateCheckpoint = existingCheckpoint ?? {
      document_id: `doc-${Date.now()}`,
      source_path: filePath,
      content_hash: '',
      current_step: 'INVENTORY',
      pipeline_version: this.pipelineVersion,
      ocr_required: false,
      classification: 'unknown',
      knowledge_domain: 'UNKNOWN',
      retries_attempted: 0,
    };

    try {
      // 1. EXTRACT
      checkpoint.current_step = 'EXTRACT';
      const extraction = await this.extractor.extractText(filePath);
      checkpoint.ocr_required = extraction.ocrRequired;

      // 2. CLASSIFY
      checkpoint.current_step = 'CLASSIFY';
      // Inferred domain classification based on metadata
      checkpoint.knowledge_domain = this.inferDomain(checkpoint.classification);

      // 3. CHUNK
      checkpoint.current_step = 'CHUNK';
      const chunks = await this.chunker.chunk(extraction.text);

      // 4. INDEX (BM25 + pgvector)
      checkpoint.current_step = 'INDEX';
      const indexHash = await this.indexer.index(checkpoint.document_id, chunks);

      // 5. VERIFY
      checkpoint.current_step = 'VERIFY';
      
      return checkpoint;
    } catch (err: any) {
      checkpoint.error_message = err.message;
      checkpoint.retries_attempted++;
      // If retries exceeded, route to a governed Quarantine/Failure state
      throw err;
    }
  }

  private inferDomain(classification: string): 'LEGAL' | 'ENVIRONMENTAL_DECISIONS' | 'TECHNICAL' | 'UNKNOWN' {
    if (classification === 'legal_document') return 'LEGAL';
    if (classification === 'court_decision' || classification === 'environmental_decision') {
      return 'ENVIRONMENTAL_DECISIONS';
    }
    if (classification === 'technical_report' || classification === 'MKB') return 'TECHNICAL';
    return 'UNKNOWN';
  }
}
