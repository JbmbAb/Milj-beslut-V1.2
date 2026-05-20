import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED
const limsRepoMock = vi.hoisted(() => ({
  createLimsReport: vi.fn(),
  getLimsReport: vi.fn(),
  verifyLimsReport: vi.fn(),
}));

// VIKTIGT: Vi måste mocka det sättet tjänsten importerar det.
// Eftersom limsService.ts gör: import { isHazardousWasteCode } from "./transportDispatchService"
// måste vi se till att Vitest mappar detta rätt.
const transportMock = vi.hoisted(() => ({
  isHazardousWasteCode: vi.fn().mockImplementation((code) => code?.startsWith('H')),
}));

vi.mock('../../server/repositories/limsRepository', () => limsRepoMock);
vi.mock('../../server/services/transportDispatchService', () => transportMock);

import {
  createLimsReport,
  verifyLimsReport,
  isLimsRequiredForBooking,
} from '../../server/services/limsService';

describe('limsService unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isLimsRequiredForBooking', () => {
    it('should return true for hazardous waste codes (H*)', () => {
      expect(isLimsRequiredForBooking({ wasteCode: 'H123' } as any)).toBe(true);
      expect(isLimsRequiredForBooking({ wasteCode: '170101' } as any)).toBe(false);
    });
  });

  describe('createLimsReport', () => {
    it('should correctly normalize metrics and sense exceeded values', async () => {
      limsRepoMock.createLimsReport.mockImplementation((data) =>
        Promise.resolve({
          ...data,
          id: 'rep-1',
          createdAt: new Date(),
          verifiedAt: null,
        }),
      );

      const report = await createLimsReport({
        sampleId: 'S-1',
        labName: 'L1',
        rawReference: 'R1',
        metrics: [{ key: 'Pb', value: 100, unit: 'mg/kg', maxAllowed: 10 }],
      });

      expect(report.metrics[0].exceeded).toBe(true);
      expect(report.passed).toBe(false);
    });

    it('returns passed=true when all metrics are within limits', async () => {
      limsRepoMock.createLimsReport.mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'rep-2', createdAt: new Date(), verifiedAt: null }),
      );

      const report = await createLimsReport({
        sampleId: 'S-2',
        labName: 'L1',
        rawReference: 'R2',
        metrics: [
          { key: 'Pb', value: 5, unit: 'mg/kg', maxAllowed: 50 },
          { key: 'Cd', value: 0.1, unit: 'mg/kg', maxAllowed: 1 },
        ],
      });

      expect(report.passed).toBe(true);
      expect(report.metrics.every((m) => !m.exceeded)).toBe(true);
    });

    it('explicit passed=false overrides auto-pass when all metrics within limits', async () => {
      limsRepoMock.createLimsReport.mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'rep-3', createdAt: new Date(), verifiedAt: null }),
      );

      const report = await createLimsReport({
        sampleId: 'S-3',
        labName: 'L1',
        rawReference: 'R3',
        metrics: [{ key: 'Cu', value: 1, unit: 'mg/kg', maxAllowed: 100 }],
        passed: false, // explicit override
      });

      // passed = false && autoPassed=true → false
      expect(report.passed).toBe(false);
    });

    it('filters out metrics with empty keys', async () => {
      limsRepoMock.createLimsReport.mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'rep-4', createdAt: new Date(), verifiedAt: null }),
      );

      await createLimsReport({
        sampleId: 'S-4',
        labName: 'L1',
        rawReference: 'R4',
        metrics: [
          { key: '', value: 5, unit: 'mg/kg' },
          { key: 'Pb', value: 10, unit: 'mg/kg', maxAllowed: 50 },
        ],
      });

      const [savedData] = limsRepoMock.createLimsReport.mock.calls[0];
      expect(savedData.metrics).toHaveLength(1);
      expect(savedData.metrics[0].key).toBe('Pb');
    });

    it('accepts custom source and bookingId', async () => {
      limsRepoMock.createLimsReport.mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'rep-5', createdAt: new Date(), verifiedAt: null }),
      );

      await createLimsReport({
        bookingId: 'booking-99',
        sampleId: 'S-5',
        labName: 'Extern Lab AB',
        rawReference: 'EXTERN-001',
        source: 'API',
        metrics: [],
      });

      const [savedData] = limsRepoMock.createLimsReport.mock.calls[0];
      expect(savedData.bookingId).toBe('booking-99');
      expect(savedData.source).toBe('API');
    });
  });

  describe('verifyLimsReport', () => {
    it('should handle verification of a report', async () => {
      const mockReport = {
        id: 'r1',
        metrics: [{ key: 'X', value: 1, unit: 'mg/kg', maxAllowed: 10 }],
        analyzedAt: new Date(),
        createdAt: new Date(),
        source: 'MANUAL',
      };
      limsRepoMock.getLimsReport.mockResolvedValue(mockReport);
      limsRepoMock.verifyLimsReport.mockResolvedValue({
        ...mockReport,
        reviewer: 'Tester',
        verifiedAt: new Date(),
      });

      const result = await verifyLimsReport({
        reportId: 'r1',
        reviewer: 'Tester',
        signatureId: 'SIG-1',
      });

      expect(result.reviewer).toBe('Tester');
    });

    it('throws when report is not found', async () => {
      limsRepoMock.getLimsReport.mockResolvedValue(null);

      await expect(
        verifyLimsReport({ reportId: 'missing', reviewer: 'T', signatureId: 'S' }),
      ).rejects.toThrow('LimsReport not found');
    });

    it('throws when reviewer is empty string', async () => {
      limsRepoMock.getLimsReport.mockResolvedValue({
        id: 'r2',
        metrics: [],
        analyzedAt: new Date(),
        createdAt: new Date(),
        source: 'MANUAL',
      });

      await expect(verifyLimsReport({ reportId: 'r2', reviewer: '   ', signatureId: 'SIG' })).rejects.toThrow(
        'reviewer is required',
      );
    });

    it('throws when signatureId is empty string', async () => {
      limsRepoMock.getLimsReport.mockResolvedValue({
        id: 'r3',
        metrics: [],
        analyzedAt: new Date(),
        createdAt: new Date(),
        source: 'MANUAL',
      });

      await expect(verifyLimsReport({ reportId: 'r3', reviewer: 'Valid', signatureId: '' })).rejects.toThrow(
        'signatureId is required',
      );
    });
  });
});
