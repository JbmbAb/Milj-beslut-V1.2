import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as legalSourceRepository from '../../server/repositories/legalSourceRepository';
import * as legalSourceIngestService from '../../server/services/legalSourceIngestService';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    legalSourceRecord: {
      upsert: vi.fn(),
    },
    requirementMatrixRow: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../server/services/legalSourceIngestService', () => ({
  normalizeLegalSource: vi.fn(),
  inferMatrixProjection: vi.fn(),
}));

import { prisma } from '../../server/db/prisma';

describe('legalSourceRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertLegalSourceRecord', () => {
    it('should upsert a legal source record with judgment ID', async () => {
      const input = {
        sourceSystem: 'DOM_RSS',
        externalId: 'judgment-123',
        title: 'Test Judgment',
        summary: 'Test Summary',
        sourceUrl: 'https://domstol.se/test',
      };

      const normalized = {
        sourceSystem: 'DOM_RSS',
        externalId: 'judgment-123',
        title: 'Test Judgment',
        summary: 'Test Summary',
        sourceUrl: 'https://domstol.se/test',
        normalizedUrl: 'https://domstol.se/test',
        providerId: 'domstol',
        providerLabel: 'Domstolverket',
        authorityName: 'Högsta domstolen',
        authorityType: 'COURT',
        municipality: 'Stockholm',
        diarienummer: '2024-123',
        legalArea: 'Environmental',
        mimeType: 'text/html',
        formatHint: 'judgment',
        decisionDate: '2024-01-01',
        publishedAt: '2024-01-02',
        storageTarget: null,
        postgisSchema: null,
        postgisTable: null,
        matrixCategory: 'RISK',
        matrixSuggested: true,
        payload: {},
      };

      const result = {
        id: 'legal-source-1',
        ...normalized,
        judgmentId: 'judgment-789',
      };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalized as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockResolvedValue(result as any);

      const output = await legalSourceRepository.upsertLegalSourceRecord(input as any, 'judgment-789');

      expect(output).toEqual(result);
      expect(legalSourceIngestService.normalizeLegalSource).toHaveBeenCalledWith(input);
      expect(prisma.legalSourceRecord.upsert).toHaveBeenCalledWith({
        where: {
          sourceSystem_externalId: {
            sourceSystem: 'DOM_RSS',
            externalId: 'judgment-123',
          },
        },
        create: expect.objectContaining({
          ...normalized,
          judgmentId: 'judgment-789',
        }),
        update: expect.objectContaining({
          title: 'Test Judgment',
          summary: 'Test Summary',
          judgmentId: 'judgment-789',
        }),
      });
    });

    it('should upsert without judgment ID', async () => {
      const input = {
        sourceSystem: 'SLU',
        externalId: 'source-456',
        title: 'SLU Report',
      };

      const normalized = {
        sourceSystem: 'SLU',
        externalId: 'source-456',
        title: 'SLU Report',
        summary: null,
        sourceUrl: null,
        normalizedUrl: null,
        providerId: 'slu',
        providerLabel: 'SLU',
        authorityName: 'SLU',
        authorityType: 'RESEARCH',
        municipality: null,
        diarienummer: null,
        legalArea: null,
        mimeType: null,
        formatHint: null,
        decisionDate: null,
        publishedAt: null,
        storageTarget: null,
        postgisSchema: null,
        postgisTable: null,
        matrixCategory: null,
        matrixSuggested: false,
        payload: null,
      };

      const result = {
        id: 'legal-source-2',
        ...normalized,
        judgmentId: null,
      };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalized as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockResolvedValue(result as any);

      const output = await legalSourceRepository.upsertLegalSourceRecord(input as any);

      expect(output).toEqual(result);
      expect(prisma.legalSourceRecord.upsert).toHaveBeenCalledWith({
        where: {
          sourceSystem_externalId: {
            sourceSystem: 'SLU',
            externalId: 'source-456',
          },
        },
        create: expect.objectContaining({
          ...normalized,
          judgmentId: null,
        }),
        update: expect.objectContaining({
          judgmentId: undefined,
        }),
      });
    });

    it('should handle database errors', async () => {
      const input = {
        sourceSystem: 'DOM_RSS',
        externalId: 'test-error',
      };

      const normalized = {
        sourceSystem: 'DOM_RSS',
        externalId: 'test-error',
      };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalized as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockRejectedValue(new Error('Database connection error'));

      await expect(legalSourceRepository.upsertLegalSourceRecord(input as any)).rejects.toThrow(
        'Database connection error',
      );
    });

    it('should handle null input gracefully', async () => {
      const input = null;
      const normalized = null;

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalized as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockResolvedValue({} as any);

      const output = await legalSourceRepository.upsertLegalSourceRecord(input as any);
      expect(output).toBeDefined();
    });
  });

  describe('upsertRequirementMatrixRowFromLegalSource', () => {
    it('should create a requirement matrix row when matrix data exists', async () => {
      const input = {
        sourceSystem: 'DOM_RSS',
        externalId: 'judgment-123',
        title: 'Environmental Regulation',
      };

      const matrix = {
        shouldProject: true,
        category: 'NOISE',
        ruleText: 'Max 65 dB during day',
        sourceText: 'Från domstolsbeslut 2024-01',
        comments: 'Important regulation',
      };

      const result = {
        id: 'matrix-1',
        legalSourceId: 'legal-source-1',
        category: 'NOISE',
        ruleText: 'Max 65 dB during day',
        sourceText: 'Från domstolsbeslut 2024-01',
        comments: 'Important regulation',
        isAutoSuggested: true,
        reviewStatus: 'AUTO',
      };

      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);
      vi.mocked(prisma.requirementMatrixRow.upsert).mockResolvedValue(result as any);

      const output = await legalSourceRepository.upsertRequirementMatrixRowFromLegalSource(
        'legal-source-1',
        input as any,
      );

      expect(output).toEqual(result);
      expect(legalSourceIngestService.inferMatrixProjection).toHaveBeenCalledWith(input);
      expect(prisma.requirementMatrixRow.upsert).toHaveBeenCalledWith({
        where: { legalSourceId: 'legal-source-1' },
        create: {
          legalSourceId: 'legal-source-1',
          category: 'NOISE',
          ruleText: 'Max 65 dB during day',
          sourceText: 'Från domstolsbeslut 2024-01',
          comments: 'Important regulation',
          isAutoSuggested: true,
          reviewStatus: 'AUTO',
        },
        update: {
          category: 'NOISE',
          ruleText: 'Max 65 dB during day',
          sourceText: 'Från domstolsbeslut 2024-01',
          comments: 'Important regulation',
          isAutoSuggested: true,
        },
      });
    });

    it('should return null when shouldProject is false', async () => {
      const input = { sourceSystem: 'OTHER', externalId: 'test-456' };

      const matrix = {
        shouldProject: false,
        category: null,
        ruleText: null,
      };

      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);

      const output = await legalSourceRepository.upsertRequirementMatrixRowFromLegalSource(
        'legal-source-2',
        input as any,
      );

      expect(output).toBeNull();
      expect(prisma.requirementMatrixRow.upsert).not.toHaveBeenCalled();
    });

    it('should return null when category is missing', async () => {
      const input = { sourceSystem: 'TEST', externalId: 'test-789' };

      const matrix = {
        shouldProject: true,
        category: null,
        ruleText: 'Some rule',
      };

      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);

      const output = await legalSourceRepository.upsertRequirementMatrixRowFromLegalSource(
        'legal-source-3',
        input as any,
      );

      expect(output).toBeNull();
      expect(prisma.requirementMatrixRow.upsert).not.toHaveBeenCalled();
    });

    it('should return null when ruleText is missing', async () => {
      const input = { sourceSystem: 'TEST', externalId: 'test-012' };

      const matrix = {
        shouldProject: true,
        category: 'WASTE',
        ruleText: null,
      };

      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);

      const output = await legalSourceRepository.upsertRequirementMatrixRowFromLegalSource(
        'legal-source-4',
        input as any,
      );

      expect(output).toBeNull();
      expect(prisma.requirementMatrixRow.upsert).not.toHaveBeenCalled();
    });

    it('should handle optional sourceText and comments', async () => {
      const input = { sourceSystem: 'DOM_RSS', externalId: 'judgment-999' };

      const matrix = {
        shouldProject: true,
        category: 'AIR_QUALITY',
        ruleText: 'PM10 limit: 50 µg/m³',
        sourceText: null,
        comments: null,
      };

      const result = {
        id: 'matrix-2',
        legalSourceId: 'legal-source-5',
        category: 'AIR_QUALITY',
        ruleText: 'PM10 limit: 50 µg/m³',
        sourceText: null,
        comments: null,
        isAutoSuggested: true,
        reviewStatus: 'AUTO',
      };

      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);
      vi.mocked(prisma.requirementMatrixRow.upsert).mockResolvedValue(result as any);

      const output = await legalSourceRepository.upsertRequirementMatrixRowFromLegalSource(
        'legal-source-5',
        input as any,
      );

      expect(output).toEqual(result);
      expect(prisma.requirementMatrixRow.upsert).toHaveBeenCalledWith({
        where: { legalSourceId: 'legal-source-5' },
        create: {
          legalSourceId: 'legal-source-5',
          category: 'AIR_QUALITY',
          ruleText: 'PM10 limit: 50 µg/m³',
          sourceText: null,
          comments: null,
          isAutoSuggested: true,
          reviewStatus: 'AUTO',
        },
        update: {
          category: 'AIR_QUALITY',
          ruleText: 'PM10 limit: 50 µg/m³',
          sourceText: null,
          comments: null,
          isAutoSuggested: true,
        },
      });
    });

    it('should handle database errors when upserting matrix row', async () => {
      const input = { sourceSystem: 'DOM_RSS', externalId: 'error-test' };

      const matrix = {
        shouldProject: true,
        category: 'WATER',
        ruleText: 'Water purity standard',
        sourceText: null,
        comments: null,
      };

      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);
      vi.mocked(prisma.requirementMatrixRow.upsert).mockRejectedValue(new Error('Constraint violation'));

      await expect(
        legalSourceRepository.upsertRequirementMatrixRowFromLegalSource('legal-source-err', input as any),
      ).rejects.toThrow('Constraint violation');
    });
  });

  describe('upsertLegalSourceWithMatrix', () => {
    it('should upsert both legal source record and matrix row', async () => {
      const input = {
        sourceSystem: 'DOM_RSS',
        externalId: 'judgment-complete',
        title: 'Complete Test',
      };

      const normalizedSource = {
        sourceSystem: 'DOM_RSS',
        externalId: 'judgment-complete',
        title: 'Complete Test',
        summary: 'Test summary',
      };

      const recordResult = {
        id: 'legal-source-complete',
        ...normalizedSource,
        judgmentId: null,
      };

      const matrix = {
        shouldProject: true,
        category: 'WASTE_MANAGEMENT',
        ruleText: 'Waste sorting required',
        sourceText: null,
        comments: null,
      };

      const matrixResult = {
        id: 'matrix-complete',
        legalSourceId: 'legal-source-complete',
        category: 'WASTE_MANAGEMENT',
        ruleText: 'Waste sorting required',
        sourceText: null,
        comments: null,
        isAutoSuggested: true,
        reviewStatus: 'AUTO',
      };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalizedSource as any);
      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockResolvedValue(recordResult as any);
      vi.mocked(prisma.requirementMatrixRow.upsert).mockResolvedValue(matrixResult as any);

      const output = await legalSourceRepository.upsertLegalSourceWithMatrix(input as any);

      expect(output).toEqual({ record: recordResult, matrixRow: matrixResult });
      expect(legalSourceIngestService.normalizeLegalSource).toHaveBeenCalledWith(input);
      expect(legalSourceIngestService.inferMatrixProjection).toHaveBeenCalledWith(input);
      expect(prisma.legalSourceRecord.upsert).toHaveBeenCalled();
      expect(prisma.requirementMatrixRow.upsert).toHaveBeenCalled();
    });

    it('should handle case where matrix row is null', async () => {
      const input = { sourceSystem: 'SLU', externalId: 'slu-data' };

      const normalizedSource = { sourceSystem: 'SLU', externalId: 'slu-data' };

      const recordResult = { id: 'legal-source-slu', ...normalizedSource };

      const matrix = {
        shouldProject: false,
        category: null,
        ruleText: null,
      };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalizedSource as any);
      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockResolvedValue(recordResult as any);

      const output = await legalSourceRepository.upsertLegalSourceWithMatrix(input as any);

      expect(output).toEqual({ record: recordResult, matrixRow: null });
      expect(prisma.requirementMatrixRow.upsert).not.toHaveBeenCalled();
    });

    it('should propagate errors from record upsert', async () => {
      const input = { sourceSystem: 'ERROR', externalId: 'error-record' };

      const normalizedSource = { sourceSystem: 'ERROR', externalId: 'error-record' };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalizedSource as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockRejectedValue(new Error('Record insert failed'));

      await expect(legalSourceRepository.upsertLegalSourceWithMatrix(input as any)).rejects.toThrow(
        'Record insert failed',
      );
    });

    it('should propagate errors from matrix upsert', async () => {
      const input = { sourceSystem: 'TEST', externalId: 'error-matrix' };

      const normalizedSource = { sourceSystem: 'TEST', externalId: 'error-matrix' };

      const recordResult = { id: 'legal-source-error', ...normalizedSource };

      const matrix = {
        shouldProject: true,
        category: 'RISK',
        ruleText: 'Risk rule',
        sourceText: null,
        comments: null,
      };

      vi.mocked(legalSourceIngestService.normalizeLegalSource).mockReturnValue(normalizedSource as any);
      vi.mocked(legalSourceIngestService.inferMatrixProjection).mockReturnValue(matrix as any);
      vi.mocked(prisma.legalSourceRecord.upsert).mockResolvedValue(recordResult as any);
      vi.mocked(prisma.requirementMatrixRow.upsert).mockRejectedValue(new Error('Matrix insert failed'));

      await expect(legalSourceRepository.upsertLegalSourceWithMatrix(input as any)).rejects.toThrow(
        'Matrix insert failed',
      );
    });
  });
});
