import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as ocrService from '../../server/services/ocrService';
import { prisma } from '../../server/db/prisma';

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

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('ocrService', () => {
  const docId = 'd1';
  const userId = 'u1';
  const mockDoc = { id: docId, absolutePath: 'p1', originalName: 'n1', status: 'METADATA_ONLY' };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OCR_ENDPOINT = '';
  });

  it('extractTextFromDocument handles document not found', async () => {
    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(null);
    await expect(ocrService.extractTextFromDocument(docId, userId)).rejects.toThrow();
  });

  it('extractTextFromDocument fallback to empty when all fail', async () => {
    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(mockDoc);
    const result = await ocrService.extractTextFromDocument(docId, userId);
    expect(result.method).toBe('empty');
    expect(result.extractedText).toBe('');
  });

  it('batchExtractPendingDocuments processes items', async () => {
    (prisma.documentRecord.findMany as Mock).mockResolvedValue([mockDoc]);
    (prisma.documentRecord.findUnique as Mock).mockResolvedValue(mockDoc);
    const res = await ocrService.batchExtractPendingDocuments(userId, 1);
    expect(res.processed).toBe(1);
  });
});
