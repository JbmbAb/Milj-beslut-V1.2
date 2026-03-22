import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  appendDomainAudit: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  readFileSync: vi.fn(),
  pdfGetText: vi.fn(),
  pdfDestroy: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    documentRecord: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}));

vi.mock('pdf-parse', () => ({
  PDFParse: class MockPdfParse {
    async getText() {
      return mocks.pdfGetText();
    }

    async destroy() {
      return mocks.pdfDestroy();
    }
  },
}));

import { batchExtractPendingDocuments, extractTextFromDocument } from '../../server/services/ocrService';

describe('ocrService', () => {
  const originalFetch = global.fetch;
  const originalOcrEndpoint = process.env.OCR_ENDPOINT;
  const originalOcrApiKey = process.env.OCR_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.OCR_ENDPOINT;
    delete process.env.OCR_API_KEY;

    mocks.findUnique.mockResolvedValue({
      id: 'doc-1',
      originalName: 'beslut.pdf',
      absolutePath: 'C:/tmp/doc-1.pdf',
    });
    mocks.findMany.mockResolvedValue([]);
    mocks.update.mockResolvedValue(undefined);
    mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
    mocks.readFileSync.mockReturnValue(Buffer.from('pdf-bytes'));
    mocks.pdfGetText.mockResolvedValue({
      text: 'Extraherad text från pdf',
      numpages: 3,
    });
    mocks.pdfDestroy.mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalOcrEndpoint === undefined) {
      delete process.env.OCR_ENDPOINT;
    } else {
      process.env.OCR_ENDPOINT = originalOcrEndpoint;
    }

    if (originalOcrApiKey === undefined) {
      delete process.env.OCR_API_KEY;
    } else {
      process.env.OCR_API_KEY = originalOcrApiKey;
    }
  });

  it('throws when the document does not exist', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    await expect(extractTextFromDocument('missing-doc', 'admin-1')).rejects.toThrow(
      'Dokument missing-doc hittades inte',
    );
  });

  it('extracts embedded pdf text, updates document status and audits the result', async () => {
    const result = await extractTextFromDocument('doc-1', 'admin-1');

    expect(result.method).toBe('pdf-parse');
    expect(result.pageCount).toBe(3);
    expect(result.charCount).toBe('Extraherad text från pdf'.length);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: {
        status: 'TEXT_EXTRACTED',
      },
    });
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        action: 'OCR_TEXT_EXTRACTED',
      }),
    );
  });

  it('falls back to external OCR when embedded text is too short', async () => {
    process.env.OCR_ENDPOINT = 'https://ocr.example.test';
    process.env.OCR_API_KEY = 'secret-key';
    mocks.pdfGetText.mockResolvedValueOnce({
      text: 'kort',
      numpages: 1,
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: 'Text från extern OCR',
        pages: [{}, {}],
        confidence: 0.88,
      }),
    } as Response);

    const result = await extractTextFromDocument('doc-1', 'admin-1');

    expect(result.method).toBe('external-ocr');
    expect(result.pageCount).toBe(2);
    expect(result.confidence).toBe(0.88);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ocr.example.test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Ocp-Apim-Subscription-Key': 'secret-key',
        }),
      }),
    );
  });

  it('batch processes pending documents and counts failures', async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mocks.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'doc-2') {
        return null;
      }

      return {
        id: 'doc-1',
        originalName: 'beslut.pdf',
        absolutePath: 'C:/tmp/doc-1.pdf',
      };
    });

    const result = await batchExtractPendingDocuments('admin-1', 5);

    expect(result).toEqual({ processed: 1, failed: 1 });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { status: 'METADATA_ONLY', mimeType: 'application/pdf' },
      take: 5,
      orderBy: { receivedTime: 'asc' },
    });
  });
});
