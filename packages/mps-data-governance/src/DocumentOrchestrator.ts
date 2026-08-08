// packages/mps-data-governance/src/DocumentOrchestrator.ts

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { prisma } from '../../../server/db/prisma'; // Prisma is loaded globally

import {
  DocumentPipelineStep,
  DocumentStateCheckpoint,
  DocumentClassification,
  KnowledgeDomain,
} from './DocumentOrchestratorTypes';

const require = createRequire(import.meta.url);

export interface PdfExtractor {
  extractText(filePath: string): Promise<{ text: string; ocrRequired: boolean; pageCount: number }>;
}

export interface Chunker {
  chunk(text: string): Promise<string[]>;
}

export interface Indexer {
  index(documentId: string, chunks: string[]): Promise<string>;
}

/**
 * Concrete high-performance implementation of PdfExtractor.
 * Reads plain text or basic layouts directly from the Master Archive.
 */
export class LocalFilePdfExtractor implements PdfExtractor {
  public async extractText(filePath: string): Promise<{ text: string; ocrRequired: boolean; pageCount: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`FILE_NOT_FOUND: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    let text = '';
    let pageCount = 1;

    if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.pdf') {
      const { PDFParse } = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: dataBuffer });
      const textResult = await parser.getText();
      text = textResult.text || '';
      pageCount = textResult.total || 1;
    } else {
      throw new Error(`UNSUPPORTED_FORMAT: ${ext}`);
    }

    return {
      text,
      ocrRequired: false,
      pageCount,
    };
  }
}

/**
 * Concrete paragraph and layout-aware semantic chunker.
 * Respects logical document structural boundaries.
 */
export class SentenceLayoutChunker implements Chunker {
  public async chunk(text: string): Promise<string[]> {
    const list = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 5); // lower limit to 5 characters
    if (list.length === 0 && text.trim().length > 0) {
      list.push(text.trim());
    }
    return list;
  }
}

/**
 * Concrete Prisma-based Database Indexer.
 * Writes canonical chunks into the production database.
 */
export class PrismaDatabaseIndexer implements Indexer {
  public async index(documentId: string, chunks: string[]): Promise<string> {
    const hash = crypto.createHash('sha256');

    await prisma.$transaction(
      chunks.map((text, index) => {
        hash.update(text);
        return prisma.documentChunk.create({
          data: {
            documentId,
            chunkIndex: index,
            chunkText: text,
            embeddingJson: {}, // Ready for future embedding step
          },
        });
      })
    );

    return hash.digest('hex');
  }
}

/**
 * Facade Document Orchestrator for Mimers Brunn Ingest-pipeline.
 * Sits inside Runtime Kernel / Capability Layer as a governed workflow.
 * Integrates strict Ingest Quality Gates to prevent database or indexing bloat.
 */
export class DocumentOrchestrator {
  constructor(
    private readonly extractor: PdfExtractor = new LocalFilePdfExtractor(),
    private readonly chunker: Chunker = new SentenceLayoutChunker(),
    private readonly indexer: Indexer = new PrismaDatabaseIndexer(),
    private readonly pipelineVersion: string = 'v1.0'
  ) {}

  /**
   * Orchestrates a single document through the deterministic pipeline.
   * Enforces strict quality gates at each step.
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

      // Quality Gate E1: Validate Extraction Integrity
      this.assertExtractionQuality(extraction.text, extraction.pageCount);

      // 2. CLASSIFY
      checkpoint.current_step = 'CLASSIFY';
      checkpoint.classification = this.inferClassification(filePath);
      checkpoint.knowledge_domain = this.inferDomain(checkpoint.classification);

      // 3. CHUNK
      checkpoint.current_step = 'CHUNK';
      const chunks = await this.chunker.chunk(extraction.text);

      // Quality Gate E2: Validate Chunking Quality
      this.assertChunkingQuality(chunks, extraction.text);

      // 4. INDEX (BM25 + pgvector)
      checkpoint.current_step = 'INDEX';
      await this.indexer.index(checkpoint.document_id, chunks);

      // 5. VERIFY
      checkpoint.current_step = 'VERIFY';
      await this.assertDatabaseIntegrity(checkpoint.document_id, chunks.length);
      
      return checkpoint;
    } catch (err: any) {
      checkpoint.error_message = err.message;
      checkpoint.retries_attempted++;
      throw err;
    }
  }

  /**
   * Quality Gate E1: Checks extraction results for readability, non-emptiness, and page integrity.
   */
  private assertExtractionQuality(text: string, pageCount: number): void {
    if (pageCount <= 0) {
      throw new Error(`QUALITY_GATE_FAILURE: Extraction reports 0 pages.`);
    }
    if (!text || text.trim().length === 0) {
      throw new Error(`QUALITY_GATE_FAILURE: Extracted text content is completely empty.`);
    }
    if (text.trim().length < 10) {
      throw new Error(`QUALITY_GATE_FAILURE: Extracted text is too short (${text.trim().length} chars) to constitute readable document content.`);
    }
  }

  /**
   * Quality Gate E2: Checks chunks for duplication and boundary issues.
   */
  private assertChunkingQuality(chunks: string[], text: string): void {
    if (text.trim().length > 0 && chunks.length === 0) {
      throw new Error(`QUALITY_GATE_FAILURE: Document has text, but semantic chunking yielded 0 chunks.`);
    }

    // Check for duplicate chunks within the same document
    const seen = new Set<string>();
    for (const chunk of chunks) {
      if (seen.has(chunk)) {
        throw new Error(`QUALITY_GATE_FAILURE: Found duplicate chunks within the same document stream.`);
      }
      seen.add(chunk);
    }
  }

  /**
   * Quality Gate E3: Asserts manifest records correspond perfectly with database chunks.
   */
  private async assertDatabaseIntegrity(documentId: string, expectedChunkCount: number): Promise<void> {
    const countInDb = await prisma.documentChunk.count({
      where: { documentId },
    });

    if (countInDb !== expectedChunkCount) {
      throw new Error(
        `QUALITY_GATE_FAILURE: Database integrity mismatch. Expected ${expectedChunkCount} chunks in DB, found ${countInDb}.`
      );
    }
  }

  private inferClassification(filePath: string): DocumentClassification {
    const name = path.basename(filePath).toLowerCase();
    if (name.includes('beslut') || name.includes('dom')) return 'court_decision';
    if (name.includes('mkb')) return 'MKB';
    if (name.includes('teknisk')) return 'technical_report';
    return 'unknown';
  }

  private inferDomain(classification: DocumentClassification): KnowledgeDomain {
    if (classification === 'legal_document') return 'LEGAL';
    if (classification === 'court_decision' || classification === 'environmental_decision') {
      return 'ENVIRONMENTAL_DECISIONS';
    }
    if (classification === 'technical_report' || classification === 'MKB') return 'TECHNICAL';
    return 'UNKNOWN';
  }
}
