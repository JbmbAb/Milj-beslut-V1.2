import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  limsReportCreate: vi.fn(),
  limsReportFindUnique: vi.fn(),
  limsReportUpdate: vi.fn(),
  limsReportFindMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    limsReport: {
      create: mocks.limsReportCreate,
      findUnique: mocks.limsReportFindUnique,
      update: mocks.limsReportUpdate,
      findMany: mocks.limsReportFindMany,
    },
  },
}));

import {
  createLimsReport,
  getLimsReport,
  verifyLimsReport,
  listLimsReportsBySample,
  listLimsReportsByBooking,
} from '../../server/repositories/limsRepository';

describe('limsRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createLimsReport', () => {
    it('creates a lims report with all fields', async () => {
      const input = {
        bookingId: 'booking-1',
        sampleId: 'sample-1',
        labName: 'TestLab',
        source: 'API',
        analyzedAt: new Date('2024-01-01'),
        rawReference: 'ref-123',
        metrics: { ph: 7.2 },
        passed: true,
      };
      const created = { id: 'report-1', ...input };
      mocks.limsReportCreate.mockResolvedValue(created);

      const result = await createLimsReport(input);

      expect(mocks.limsReportCreate).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual(created);
    });

    it('creates a lims report without optional bookingId', async () => {
      const input = {
        bookingId: null,
        sampleId: 'sample-2',
        labName: 'LabB',
        source: 'MANUAL',
        analyzedAt: new Date('2024-02-01'),
        rawReference: 'ref-456',
        metrics: {},
        passed: false,
      };
      mocks.limsReportCreate.mockResolvedValue({ id: 'report-2', ...input });

      await createLimsReport(input);

      expect(mocks.limsReportCreate).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('getLimsReport', () => {
    it('returns the report when found', async () => {
      const report = { id: 'report-1', sampleId: 'sample-1', passed: true };
      mocks.limsReportFindUnique.mockResolvedValue(report);

      const result = await getLimsReport('report-1');

      expect(mocks.limsReportFindUnique).toHaveBeenCalledWith({ where: { id: 'report-1' } });
      expect(result).toEqual(report);
    });

    it('returns null when report is not found', async () => {
      mocks.limsReportFindUnique.mockResolvedValue(null);

      const result = await getLimsReport('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('verifyLimsReport', () => {
    it('updates the report with reviewer data and sets verifiedByHuman', async () => {
      const verifyData = {
        reviewer: 'Jane Doe',
        reviewerSignatureId: 'sig-abc',
        verifiedAt: new Date('2024-03-01'),
        passed: true,
      };
      const updated = { id: 'report-1', verifiedByHuman: true, ...verifyData };
      mocks.limsReportUpdate.mockResolvedValue(updated);

      const result = await verifyLimsReport('report-1', verifyData);

      expect(mocks.limsReportUpdate).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: { ...verifyData, verifiedByHuman: true },
      });
      expect(result).toEqual(updated);
    });

    it('sets passed to false when review fails', async () => {
      const verifyData = {
        reviewer: 'John Smith',
        reviewerSignatureId: 'sig-xyz',
        verifiedAt: new Date('2024-03-15'),
        passed: false,
      };
      mocks.limsReportUpdate.mockResolvedValue({ id: 'report-2', verifiedByHuman: true, ...verifyData });

      await verifyLimsReport('report-2', verifyData);

      expect(mocks.limsReportUpdate).toHaveBeenCalledWith({
        where: { id: 'report-2' },
        data: { ...verifyData, verifiedByHuman: true },
      });
    });
  });

  describe('listLimsReportsBySample', () => {
    it('returns reports ordered by createdAt desc for a sample', async () => {
      const reports = [
        { id: 'r2', sampleId: 'sample-1', createdAt: new Date('2024-02-01') },
        { id: 'r1', sampleId: 'sample-1', createdAt: new Date('2024-01-01') },
      ];
      mocks.limsReportFindMany.mockResolvedValue(reports);

      const result = await listLimsReportsBySample('sample-1');

      expect(mocks.limsReportFindMany).toHaveBeenCalledWith({
        where: { sampleId: 'sample-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(reports);
    });

    it('returns empty array when no reports exist for sample', async () => {
      mocks.limsReportFindMany.mockResolvedValue([]);

      const result = await listLimsReportsBySample('unknown-sample');

      expect(result).toEqual([]);
    });
  });

  describe('listLimsReportsByBooking', () => {
    it('returns reports ordered by createdAt desc for a booking', async () => {
      const reports = [
        { id: 'r3', bookingId: 'booking-1', createdAt: new Date('2024-03-01') },
        { id: 'r1', bookingId: 'booking-1', createdAt: new Date('2024-01-01') },
      ];
      mocks.limsReportFindMany.mockResolvedValue(reports);

      const result = await listLimsReportsByBooking('booking-1');

      expect(mocks.limsReportFindMany).toHaveBeenCalledWith({
        where: { bookingId: 'booking-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(reports);
    });

    it('returns empty array when no reports exist for booking', async () => {
      mocks.limsReportFindMany.mockResolvedValue([]);

      const result = await listLimsReportsByBooking('unknown-booking');

      expect(result).toEqual([]);
    });
  });

  describe('error handling and edge cases', () => {
    it('propagates database errors during creation', async () => {
      mocks.limsReportCreate.mockRejectedValue(new Error('constraint violation'));

      await expect(
        createLimsReport({
          bookingId: 'booking-1',
          sampleId: 'sample-1',
          labName: 'TestLab',
          source: 'API',
          analyzedAt: new Date(),
          rawReference: 'ref-123',
          metrics: {},
          passed: true,
        }),
      ).rejects.toThrow('constraint violation');
    });

    it('propagates database errors during fetch', async () => {
      mocks.limsReportFindUnique.mockRejectedValue(new Error('connection timeout'));

      await expect(getLimsReport('report-1')).rejects.toThrow('connection timeout');
    });

    it('propagates database errors during verification', async () => {
      mocks.limsReportUpdate.mockRejectedValue(new Error('update failed'));

      await expect(
        verifyLimsReport('report-1', {
          reviewer: 'John',
          reviewerSignatureId: 'sig-1',
          verifiedAt: new Date(),
          passed: true,
        }),
      ).rejects.toThrow('update failed');
    });

    it('handles very large metrics objects', async () => {
      const largeMetrics = Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [`metric-${i}`, Math.random()]),
      );

      mocks.limsReportCreate.mockResolvedValue({
        id: 'report-large',
        metrics: largeMetrics,
      });

      await createLimsReport({
        bookingId: 'booking-1',
        sampleId: 'sample-1',
        labName: 'TestLab',
        source: 'API',
        analyzedAt: new Date(),
        rawReference: 'ref-large',
        metrics: largeMetrics,
        passed: true,
      });

      expect(mocks.limsReportCreate).toHaveBeenCalled();
    });

    it('handles null bookingId gracefully', async () => {
      mocks.limsReportCreate.mockResolvedValue({
        id: 'report-no-booking',
        bookingId: null,
      });

      await createLimsReport({
        bookingId: null,
        sampleId: 'sample-1',
        labName: 'TestLab',
        source: 'MANUAL',
        analyzedAt: new Date(),
        rawReference: 'ref-123',
        metrics: {},
        passed: true,
      });

      expect(mocks.limsReportCreate).toHaveBeenCalled();
    });

    it('handles empty string sample ids', async () => {
      mocks.limsReportFindMany.mockResolvedValue([]);

      const result = await listLimsReportsBySample('');

      expect(result).toEqual([]);
    });

    it('handles empty string booking ids', async () => {
      mocks.limsReportFindMany.mockResolvedValue([]);

      const result = await listLimsReportsByBooking('');

      expect(result).toEqual([]);
    });

    it('propagates errors when listing reports by sample', async () => {
      mocks.limsReportFindMany.mockRejectedValue(new Error('query error'));

      await expect(listLimsReportsBySample('sample-1')).rejects.toThrow('query error');
    });

    it('propagates errors when listing reports by booking', async () => {
      mocks.limsReportFindMany.mockRejectedValue(new Error('query error'));

      await expect(listLimsReportsByBooking('booking-1')).rejects.toThrow('query error');
    });

    it('handles very large report lists', async () => {
      const largeList = Array.from({ length: 50000 }, (_, i) => ({
        id: `report-${i}`,
        sampleId: 'sample-1',
        createdAt: new Date(Date.now() - i * 1000),
      }));

      mocks.limsReportFindMany.mockResolvedValue(largeList);

      const result = await listLimsReportsBySample('sample-1');

      expect(result).toHaveLength(50000);
    });

    it('handles special characters in lab names and references', async () => {
      mocks.limsReportCreate.mockResolvedValue({
        id: 'report-special',
        labName: 'TestLab © 2026 å ä ö',
        rawReference: 'ref!@#$%^&*()',
      });

      await createLimsReport({
        bookingId: 'booking-1',
        sampleId: 'sample-1',
        labName: 'TestLab © 2026 å ä ö',
        source: 'API',
        analyzedAt: new Date(),
        rawReference: 'ref!@#$%^&*()',
        metrics: {},
        passed: true,
      });

      expect(mocks.limsReportCreate).toHaveBeenCalled();
    });
  });
});
