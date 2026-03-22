import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createLimsReportRepo: vi.fn(),
  getLimsReportRepo: vi.fn(),
  verifyLimsReportRepo: vi.fn(),
}));

vi.mock('../../server/repositories/limsRepository', () => ({
  createLimsReport: mocks.createLimsReportRepo,
  getLimsReport: mocks.getLimsReportRepo,
  verifyLimsReport: mocks.verifyLimsReportRepo,
  listLimsReportsByBooking: vi.fn(),
  listLimsReportsBySample: vi.fn(),
}));

import {
  createLimsReport,
  isLimsRequiredForBooking,
  verifyLimsReport,
} from '../../server/services/limsService';

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    bookingId: 'booking-1',
    sampleId: 'sample-1',
    labName: 'ALS',
    source: 'API',
    analyzedAt: new Date('2026-01-01T10:00:00.000Z'),
    rawReference: 'raw-1',
    metrics: [
      {
        key: 'Pb',
        value: 0.6,
        unit: 'mg/kg',
        maxAllowed: 1,
        exceeded: false,
      },
    ],
    passed: true,
    verifiedByHuman: false,
    reviewer: null,
    reviewerSignatureId: null,
    verifiedAt: null,
    createdAt: new Date('2026-01-01T11:00:00.000Z'),
    ...overrides,
  };
}

describe('limsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires lims for hazardous waste bookings only', () => {
    expect(
      isLimsRequiredForBooking({
        id: 'b1',
        quoteId: 'q1',
        provider: 'MOCK_FRAKTBORS',
        status: 'BOOKED',
        receiverId: 'R1',
        receiverName: 'Receiver',
        wasteCode: '17 05 03*',
        tons: 4,
        distanceKm: 10,
        co2EstimateKg: 4.8,
        plannedPickupAt: '2026-01-01T10:00:00.000Z',
        plannedDeliveryAt: '2026-01-01T11:00:00.000Z',
        externalReference: 'EXT-1',
        createdAt: '2026-01-01T09:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      }),
    ).toBe(true);

    expect(
      isLimsRequiredForBooking({
        id: 'b2',
        quoteId: 'q2',
        provider: 'MOCK_FRAKTBORS',
        status: 'BOOKED',
        receiverId: 'R2',
        receiverName: 'Receiver',
        wasteCode: '17 05 04',
        tons: 4,
        distanceKm: 10,
        co2EstimateKg: 4.8,
        plannedPickupAt: '2026-01-01T10:00:00.000Z',
        plannedDeliveryAt: '2026-01-01T11:00:00.000Z',
        externalReference: 'EXT-2',
        createdAt: '2026-01-01T09:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('normalizes metrics and auto-passes compliant reports', async () => {
    mocks.createLimsReportRepo.mockResolvedValue(reportRow());

    const report = await createLimsReport({
      bookingId: 'booking-1',
      sampleId: 'sample-1',
      labName: 'ALS',
      source: 'API',
      rawReference: 'raw-1',
      metrics: [
        {
          key: 'Pb',
          value: 0.6,
          unit: 'mg/kg',
          maxAllowed: 1,
        },
      ],
    });

    expect(report.id).toBe('report-1');
    expect(report.metrics[0]?.key).toBe('Pb');
    expect(mocks.createLimsReportRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        passed: true,
        metrics: [
          {
            key: 'Pb',
            value: 0.6,
            unit: 'mg/kg',
            maxAllowed: 1,
            exceeded: false,
          },
        ],
      }),
    );
  });

  it('forces failed state when exceeded metrics are present', async () => {
    mocks.createLimsReportRepo.mockResolvedValue(
      reportRow({
        passed: false,
        metrics: [
          {
            key: 'Pb',
            value: 1.6,
            unit: 'mg/kg',
            maxAllowed: 1,
            exceeded: true,
          },
        ],
      }),
    );

    const report = await createLimsReport({
      bookingId: 'booking-1',
      sampleId: 'sample-2',
      labName: 'ALS',
      source: 'MANUAL',
      rawReference: 'raw-2',
      passed: true,
      metrics: [
        {
          key: 'Pb',
          value: 1.6,
          unit: 'mg/kg',
          maxAllowed: 1,
        },
      ],
    });

    expect(report.passed).toBe(false);
    expect(mocks.createLimsReportRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        passed: false,
      }),
    );
  });

  it('validates required verification inputs', async () => {
    mocks.getLimsReportRepo.mockResolvedValue(null);
    await expect(
      verifyLimsReport({
        reportId: 'report-1',
        reviewer: 'QA',
        signatureId: 'sig-1',
      }),
    ).rejects.toThrow(/not found/i);

    mocks.getLimsReportRepo.mockResolvedValue(reportRow());
    await expect(
      verifyLimsReport({
        reportId: 'report-1',
        reviewer: '',
        signatureId: 'sig-1',
      }),
    ).rejects.toThrow(/reviewer is required/i);

    await expect(
      verifyLimsReport({
        reportId: 'report-1',
        reviewer: 'QA',
        signatureId: '',
      }),
    ).rejects.toThrow(/signatureId is required/i);
  });

  it('verifies reports with human approval and recomputes pass state', async () => {
    mocks.getLimsReportRepo.mockResolvedValue(
      reportRow({
        metrics: [
          {
            key: 'Pb',
            value: 0.6,
            unit: 'mg/kg',
            maxAllowed: 1,
            exceeded: false,
          },
        ],
      }),
    );
    mocks.verifyLimsReportRepo.mockResolvedValue(
      reportRow({
        verifiedByHuman: true,
        reviewer: 'QA',
        reviewerSignatureId: 'sig-1',
        verifiedAt: new Date('2026-01-01T12:00:00.000Z'),
      }),
    );

    const report = await verifyLimsReport({
      reportId: 'report-1',
      reviewer: 'QA',
      signatureId: 'sig-1',
      approved: true,
    });

    expect(report.verifiedByHuman).toBe(true);
    expect(report.reviewer).toBe('QA');
    expect(mocks.verifyLimsReportRepo).toHaveBeenCalledWith(
      'report-1',
      expect.objectContaining({
        reviewer: 'QA',
        reviewerSignatureId: 'sig-1',
        passed: true,
      }),
    );
  });
});
