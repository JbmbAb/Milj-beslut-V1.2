import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as ocrService from '../../server/services/ocrService';
import { prisma } from '../../server/db/prisma';

// Mock node:fs so readFileSync does not hit the real disk in tests.
vi.mock('node:fs', () => {
  const m = {
    readFileSync: vi.fn(() => Buffer.from('%PDF-1.4 minimal')),
    existsSync: vi.fn(() => true),
  };
  return { ...m, default: m };
});

// Mock static dependencies
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    documentRecord: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn(async () => ({ id: 'a1' })),
}));
vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../server/services/documentObjectStorage', () => ({
  readStorageFile: vi.fn(async () => Buffer.from('%PDF-1.4 mock')),
}));

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe('ocrService', () => {
  const docId = 'd1';
  const userId = 'u1';
  const mockDoc = { id: docId, absolutePath: 'p1', originalName: 'n1', status: 'METADATA_ONLY' };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OCR_ENDPOINT;
    delete process.env.OCR_API_KEY;
    (prisma.documentRecord.update as Mock).mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.OCR_ENDPOINT;
    delete process.env.OCR_API_KEY;
  });

  it('extractTextFromDocument throws when document is not found', async () => {
    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(null);
    await expect(ocrService.extractTextFromDocument(docId, userId)).rejects.toThrow(
      `Dokument ${docId} hittades inte`,
    );
  });

  it('extractTextFromDocument falls back to empty when pdf-parse and OCR both fail', async () => {
    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(mockDoc);
    const result = await ocrService.extractTextFromDocument(docId, userId);
    expect(result.method).toBe('empty');
    expect(result.extractedText).toBe('');
    expect(result.documentId).toBe(docId);
    expect(result.auditId).toBe('a1');
  }, 15000);

  it('uses external OCR endpoint when configured and fetch returns text', async () => {
    process.env.OCR_ENDPOINT = 'https://ocr.example.se/extract';
    process.env.OCR_API_KEY = 'ocr-secret';

    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(mockDoc);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: 'Extraherad text från OCR-tjänsten',
        pages: [{}, {}],
        confidence: 0.88,
      }),
    });

    const result = await ocrService.extractTextFromDocument(docId, userId);

    expect(result.method).toBe('external-ocr');
    expect(result.extractedText).toContain('Extraherad text');
    expect(result.pageCount).toBe(2);
    expect(result.confidence).toBe(0.88);
    // prisma.update should be called since text.length > 0
    expect(prisma.documentRecord.update).toHaveBeenCalledWith({
      where: { id: docId },
      data: { status: 'TEXT_EXTRACTED' },
    });
  }, 15000);

  it('stays empty when OCR endpoint returns non-ok response', async () => {
    process.env.OCR_ENDPOINT = 'https://ocr.example.se/extract';
    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(mockDoc);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await ocrService.extractTextFromDocument(docId, userId);
    expect(result.method).toBe('empty');
    expect(prisma.documentRecord.update).not.toHaveBeenCalled();
  }, 15000);

  it('batchExtractPendingDocuments processes items and counts failures', async () => {
    const doc2 = { id: 'd2', absolutePath: 'p2', originalName: 'n2', status: 'METADATA_ONLY' };
    const doc3 = { id: 'd3', absolutePath: 'p3', originalName: 'n3', status: 'METADATA_ONLY' };

    (prisma.documentRecord.findMany as Mock).mockResolvedValue([mockDoc, doc2, doc3]);
    (prisma.documentRecord.findUnique as Mock)
      .mockResolvedValueOnce(mockDoc)
      .mockResolvedValueOnce(doc2)
      .mockResolvedValueOnce(null); // d3 → throws → counted as failed

    const res = await ocrService.batchExtractPendingDocuments(userId, 3);
    expect(res.processed).toBe(2);
    expect(res.failed).toBe(1);
  }, 30000);

  it('batchExtractPendingDocuments returns zero when no documents pending', async () => {
    (prisma.documentRecord.findMany as Mock).mockResolvedValue([]);

    const res = await ocrService.batchExtractPendingDocuments(userId);
    expect(res.processed).toBe(0);
    expect(res.failed).toBe(0);
  });
});
