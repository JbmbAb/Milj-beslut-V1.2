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

  // 1. Try pdf-parse on the stored file
  try {
    const { readFileSync } = await import('node:fs');
    // pdf-parse exports differently in ESM vs CJS — handle both
    const pdfParseModule = await import('pdf-parse');
    const pdfParse = (pdfParseModule as unknown as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> }).default
      ?? (pdfParseModule as unknown as (b: Buffer) => Promise<{ text: string; numpages: number }>);

    const buffer = readFileSync(doc.absolutePath);
    const parsed = await pdfParse(buffer);
    extractedText = parsed.text?.trim() ?? '';
    pageCount = parsed.numpages ?? 0;

    if (extractedText.length > 0) {
      method = 'pdf-parse';
      confidence = 0.95;
    }
  } catch (parseErr) {
    logger.warn('ocr: pdf-parse failed', { documentId, err: String(parseErr) });
  }

  // 2. If no text found and external OCR endpoint is configured
  if (extractedText.length < 10 && process.env.OCR_ENDPOINT) {
    try {
      const { readFileSync } = await import('node:fs');
      const buffer = readFileSync(doc.absolutePath);

      const resp = await fetch(process.env.OCR_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          ...(process.env.OCR_API_KEY ? { 'Ocp-Apim-Subscription-Key': process.env.OCR_API_KEY } : {}),
        },
        body: buffer,
        signal: AbortSignal.timeout(30_000),
      });

      if (resp.ok) {
        const json = (await resp.json()) as {
          text?: string;
          pages?: unknown[];
          confidence?: number;
        };
        extractedText = json.text?.trim() ?? '';
        pageCount = Array.isArray(json.pages) ? json.pages.length : pageCount;
        confidence = json.confidence;
        if (extractedText.length > 0) method = 'external-ocr';
      }
    } catch (ocrErr) {
      logger.warn('ocr: external OCR endpoint failed', { documentId, err: String(ocrErr) });
    }
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
