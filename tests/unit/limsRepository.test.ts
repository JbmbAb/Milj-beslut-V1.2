import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ───────────────────────────────────────────────────────────────

const limsReportMock = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    limsReport: limsReportMock,
  },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

import {
  createLimsReport,
  getLimsReport,
  listLimsReportsByBooking,
  listLimsReportsBySample,
  verifyLimsReport,
} from '../../server/repositories/limsRepository';

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('limsRepository', () => {

  // ── createLimsReport ──────────────────────────────────────────────────────

  describe('createLimsReport', () => {
    it('passes all fields to prisma.limsReport.create', async () => {
      const data = {
        bookingId: 'bk-1',
        sampleId: 'sample-1',
        labName: 'Test Lab AB',
        source: 'API',
        analyzedAt: new Date('2024-01-01'),
        rawReference: 'REF-001',
        metrics: [{ key: 'pH', value: 7.2, unit: '-' }],
        passed: true,
      };

      const expected = { id: 'lims-1', ...data };
      limsReportMock.create.mockResolvedValue(expected);

      const result = await createLimsReport(data);

      expect(limsReportMock.create).toHaveBeenCalledWith({ data });
      expect(result).toBe(expected);
    });

    it('works with null bookingId', async () => {
      const data = {
        bookingId: null,
        sampleId: 's-2',
        labName: 'Lab',
        source: 'UPLOAD',
        analyzedAt: new Date(),
        rawReference: 'REF-2',
        metrics: [],
        passed: false,
      };

      limsReportMock.create.mockResolvedValue({ id: 'lims-2', ...data });
      await createLimsReport(data);

      expect(limsReportMock.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── getLimsReport ─────────────────────────────────────────────────────────

  describe('getLimsReport', () => {
    it('calls findUnique with the correct id', async () => {
      limsReportMock.findUnique.mockResolvedValue({ id: 'lims-5' });

      const result = await getLimsReport('lims-5');

      expect(limsReportMock.findUnique).toHaveBeenCalledWith({ where: { id: 'lims-5' } });
      expect(result).toEqual({ id: 'lims-5' });
    });

    it('returns null when not found', async () => {
      limsReportMock.findUnique.mockResolvedValue(null);
      const result = await getLimsReport('no-such-id');
      expect(result).toBeNull();
    });
  });

  // ── verifyLimsReport ──────────────────────────────────────────────────────

  describe('verifyLimsReport', () => {
    it('updates the report with reviewer data and sets verifiedByHuman=true', async () => {
      const verifyData = {
        reviewer: 'Anna Svensson',
        reviewerSignatureId: 'sig-1',
        verifiedAt: new Date('2024-06-01'),
        passed: true,
      };

      const updated = { id: 'lims-v', ...verifyData, verifiedByHuman: true };
      limsReportMock.update.mockResolvedValue(updated);

      const result = await verifyLimsReport('lims-v', verifyData);

      expect(limsReportMock.update).toHaveBeenCalledWith({
        where: { id: 'lims-v' },
        data: { ...verifyData, verifiedByHuman: true },
      });
      expect(result).toBe(updated);
    });
  });

  // ── listLimsReportsBySample ───────────────────────────────────────────────

  describe('listLimsReportsBySample', () => {
    it('calls findMany with sampleId filter and descending createdAt order', async () => {
      limsReportMock.findMany.mockResolvedValue([]);

      await listLimsReportsBySample('sample-abc');

      expect(limsReportMock.findMany).toHaveBeenCalledWith({
        where: { sampleId: 'sample-abc' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns the found reports', async () => {
      const reports = [{ id: 'r1' }, { id: 'r2' }];
      limsReportMock.findMany.mockResolvedValue(reports);

      const result = await listLimsReportsBySample('s-abc');
      expect(result).toEqual(reports);
    });
  });

  // ── listLimsReportsByBooking ──────────────────────────────────────────────

  describe('listLimsReportsByBooking', () => {
    it('calls findMany with bookingId filter and descending createdAt order', async () => {
      limsReportMock.findMany.mockResolvedValue([]);

      await listLimsReportsByBooking('booking-xyz');

      expect(limsReportMock.findMany).toHaveBeenCalledWith({
        where: { bookingId: 'booking-xyz' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns empty array when no reports found', async () => {
      limsReportMock.findMany.mockResolvedValue([]);
      const result = await listLimsReportsByBooking('bk-empty');
      expect(result).toHaveLength(0);
    });
  });
});
