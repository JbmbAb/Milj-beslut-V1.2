/**
 * ocrService.ts
 *
 * OCR-extraktion av text ur skannade PDF-bilagor.
 *
 * Strategi:
 *   1. pdf-parse (already a project dependency) extraherar inbäddad text
 *   2. Om ingen text hittas och OCR_ENDPOINT är konfigurerat skickas filen
 *      till en extern OCR-tjänst (t.ex. Azure Document Intelligence, AWS Textract)
 *   3. Resultatet indexeras i dokumentsökningsindexet
 *
 * Endpoint: POST /api/admin/ocr/extract
 */

import { logger } from '../logger';
import { prisma } from '../db/prisma';
import { appendDomainAudit } from '../security/auditTrail';
import { readStorageFile } from './documentObjectStorage';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OcrExtractionResult {
  documentId: string;
  originalName: string;
  extractedText: string;
  pageCount: number;
  charCount: number;
  method: 'pdf-parse' | 'external-ocr' | 'empty';
  confidence?: number;
  extractedAt: string;
  auditId: string;
}

// ─── Core extraction ─────────────────────────────────────────────────────────

/**
 * Extrahera text ur ett PDF-dokument (via documentId i databasen).
 */
export async function extractTextFromDocument(
  documentId: string,
  actingUserId: string,
): Promise<OcrExtractionResult> {
  const doc = await prisma.documentRecord.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Dokument ${documentId} hittades inte`);

  const extractedAt = new Date().toISOString();
  let extractedText = '';
  let pageCount = 0;
  let method: OcrExtractionResult['method'] = 'empty';
  let confidence: number | undefined;

  // TEXT-L2: extraction/OCR only via ports (no alternate projection formats)
  try {
    const buffer = await readStorageFile(doc.absolutePath);
    const { extractTextViaPorts } = await import('../text-projection/extractTextViaPorts');
    const outcome = await extractTextViaPorts({
      source: {
        ref: { artifact_id: documentId, artifact_type: 'document_record' },
        doc_name: doc.originalName || documentId,
        mime_type: 'application/pdf',
      },
      bytes: buffer,
      min_chars_threshold: 10,
      enable_ocr_fallback: true,
      prefer_external_ocr: true,
    });

    extractedText = outcome.text.trim();
    if (outcome.ocr_used && outcome.ocr_method === 'ocr_external') {
      method = 'external-ocr';
      confidence = outcome.ocr_confidence ?? 0.85;
    } else if (extractedText.length > 0) {
      method = 'pdf-parse';
      confidence = outcome.ocr_used ? 0.8 : 0.95;
    }
    if (typeof outcome.ocr_page_count === 'number') {
      pageCount = outcome.ocr_page_count;
    }
  } catch (err) {
    logger.warn('ocr: port extraction failed', { documentId, err: String(err) });
  }

  // 3. Persist extracted text to searchText field if extraction succeeded
  if (extractedText.length > 0) {
    await prisma.documentRecord.update({
      where: { id: documentId },
      data: {
        status: 'TEXT_EXTRACTED',
      },
    });
  }

  const auditRecord = await appendDomainAudit({
    entityType: 'DOCUMENT',
    entityId: documentId,
    action: 'OCR_TEXT_EXTRACTED',
    userId: actingUserId,
    payload: {
      method,
      charCount: extractedText.length,
      pageCount,
      confidence: confidence ?? null,
    },
  });

  logger.info('ocr: extraction completed', {
    documentId,
    method,
    charCount: extractedText.length,
  });

  return {
    documentId,
    originalName: doc.originalName,
    extractedText: extractedText.slice(0, 5000), // Trim for API response
    pageCount,
    charCount: extractedText.length,
    method,
    confidence,
    extractedAt,
    auditId: auditRecord.id,
  };
}

/**
 * Batch-extrahera alla dokument som saknar text (status = METADATA_ONLY).
 * Returnerar antal bearbetade dokument.
 */
export async function batchExtractPendingDocuments(
  actingUserId: string,
  limit = 50,
): Promise<{ processed: number; failed: number }> {
  const docs = await prisma.documentRecord.findMany({
    where: { status: 'METADATA_ONLY', mimeType: 'application/pdf' },
    take: limit,
    orderBy: { receivedTime: 'asc' },
  });

  let processed = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      await extractTextFromDocument(doc.id, actingUserId);
      processed++;
    } catch {
      failed++;
    }
  }

  return { processed, failed };
}
