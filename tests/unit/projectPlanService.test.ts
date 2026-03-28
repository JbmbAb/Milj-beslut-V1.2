import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoredProjectPlan: vi.fn(),
  createDispatchQuote: vi.fn(),
  createTransportBooking: vi.fn(),
  upsertDriverJournal: vi.fn(),
  signDriverJournal: vi.fn(),
  createLimsReport: vi.fn(),
  verifyLimsReport: vi.fn(),
  prisma: {
    projectPlanState: {
      upsert: vi.fn(),
    },
    project: {
      update: vi.fn(),
    },
  },
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('../../server/repositories/projectPlanRepository', () => ({
  getStoredProjectPlan: mocks.getStoredProjectPlan,
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  createDispatchQuote: mocks.createDispatchQuote,
  createTransportBooking: mocks.createTransportBooking,
  upsertDriverJournal: mocks.upsertDriverJournal,
  signDriverJournal: mocks.signDriverJournal,
}));

vi.mock('../../server/services/limsService', () => ({
  createLimsReport: mocks.createLimsReport,
  verifyLimsReport: mocks.verifyLimsReport,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: mocks.prisma,
}));

vi.mock('../../server/logger', () => ({
  logger: mocks.logger,
}));

async function loadService() {
  return import('../../server/services/projectPlanService');
}

function quote() {
  return {
    id: 'quote-1',
    provider: 'MOCK_FRAKTBORS' as const,
    receiverId: 'R1',
    receiverName: 'Receiver',
    wasteCode: '17 05 03*',
    tons: 9,
    distanceKm: 20,
    estimatedCostSek: 6120,
    etaHours: 1,
    currency: 'SEK' as const,
    createdAt: '2026-01-01T09:00:00.000Z',
  };
}

function booking() {
  return {
    id: 'booking-1',
    quoteId: 'quote-1',
    provider: 'MOCK_FRAKTBORS' as const,
    status: 'BOOKED' as const,
    receiverId: 'R1',
    receiverName: 'Receiver',
    wasteCode: '17 05 03*',
    tons: 9,
    distanceKm: 20,
    co2EstimateKg: 21.6,
    plannedPickupAt: '2026-01-01T10:00:00.000Z',
    plannedDeliveryAt: '2026-01-01T12:00:00.000Z',
    externalReference: 'MFB-123456',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:05:00.000Z',
  };
}

function journal(status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' = 'VERIFIED') {
  return {
    id: 'journal-1',
    bookingId: 'booking-1',
    driverName: 'Driver',
    vehicleId: 'ABC123',
    origin: 'Site A',
    destination: 'Site B',
    wasteCode: '17 05 03*',
    tons: 9,
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T12:00:00.000Z',
    odometerStartKm: 1000,
    odometerEndKm: 1020,
    gpsTrackHash: 'hash-1',
    status,
    signedByDriver: true,
    signedByReviewer: status === 'VERIFIED',
    driverSignatureId: 'sig-driver',
    reviewerSignatureId: status === 'VERIFIED' ? 'sig-review' : null,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:05:00.000Z',
  };
}

function report(verifiedByHuman: boolean = true) {
  return {
    id: 'report-1',
    bookingId: 'booking-1',
    sampleId: 'sample-1',
    labName: 'ALS',
    source: 'API' as const,
    analyzedAt: '2026-01-01T10:30:00.000Z',
    rawReference: 'als-1',
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
    verifiedByHuman,
    reviewer: verifiedByHuman ? 'QA Reviewer' : null,
    reviewerSignatureId: verifiedByHuman ? 'sig-lims' : null,
    verifiedAt: verifiedByHuman ? '2026-01-01T12:30:00.000Z' : null,
    createdAt: '2026-01-01T11:00:00.000Z',
  };
}

describe('projectPlanService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getStoredProjectPlan.mockResolvedValue(null);
    mocks.prisma.projectPlanState.upsert.mockResolvedValue(undefined);
    mocks.prisma.project.update.mockResolvedValue(undefined);
    mocks.createDispatchQuote.mockReturnValue(quote());
    mocks.createTransportBooking.mockResolvedValue(booking());
    mocks.upsertDriverJournal.mockResolvedValue(journal('DRAFT'));
    mocks.signDriverJournal.mockResolvedValue(journal('VERIFIED'));
    mocks.createLimsReport.mockResolvedValue(report(false));
    mocks.verifyLimsReport.mockResolvedValue(report(true));
  });

  it('loads persisted plans and saves normalized snapshots', async () => {
    mocks.getStoredProjectPlan.mockResolvedValueOnce({
      name: 'Stored plan',
      stageGates: [],
    });

    const service = await loadService();
    const stored = await service.getProjectPlanSnapshot('project-1', 'org-1');
    const saved = await service.saveProjectPlanSnapshot({
      projectId: 'project-2',
      organisationId: 'org-1',
      plan: { name: 'Saved plan' },
    });

    expect(stored?.name).toBe('Stored plan');
    expect(saved.name).toBe('Saved plan');
    expect(mocks.prisma.projectPlanState.upsert).toHaveBeenCalled();
    expect(mocks.prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'project-2',
          organisationId: 'org-1',
        },
      }),
    );
  }, 20000);

  it('creates and stores dispatch quotes on the plan', async () => {
    const service = await loadService();

    const payload = await service.createDispatchQuoteForProject({
      projectId: 'project-1',
      organisationId: 'org-1',
      receiverId: 'R1',
      receiverName: 'Receiver',
      wasteCode: '17 05 03*',
      tons: 9,
      distanceKm: 20,
    });

    expect(payload.quote.id).toBe('quote-1');
    expect(payload.plan.dispatchQuotes[0]?.id).toBe('quote-1');
    expect(mocks.createDispatchQuote).toHaveBeenCalledWith({
      receiverId: 'R1',
      receiverName: 'Receiver',
      wasteCode: '17 05 03*',
      tons: 9,
      distanceKm: 20,
    });
  });

  it('books transport only when the quote exists on the plan', async () => {
    const service = await loadService();

    await expect(
      service.bookTransportForProject({
        projectId: 'project-1',
        organisationId: 'org-1',
        quoteId: 'missing-quote',
      }),
    ).rejects.toThrow(/Dispatch quote not found/i);

    await service.saveProjectPlanSnapshot({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: { dispatchQuotes: [quote()] },
    });

    const payload = await service.bookTransportForProject({
      projectId: 'project-1',
      organisationId: 'org-1',
      quoteId: 'quote-1',
    });

    expect(payload.booking.id).toBe('booking-1');
    expect(payload.plan.transportBookings[0]?.id).toBe('booking-1');
  });

  it('uses booking defaults when journals are uploaded from a lightweight payload', async () => {
    const service = await loadService();
    await service.saveProjectPlanSnapshot({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: { transportBookings: [booking()] },
    });

    await service.upsertDriverJournalForProject({
      projectId: 'project-1',
      organisationId: 'org-1',
      journal: {
        bookingId: 'booking-1',
        driverName: 'Driver',
        vehicleId: 'ABC123',
        origin: 'Site A',
        destination: 'Site B',
        wasteCode: '',
        tons: 0,
        odometerStartKm: 1000,
      },
    });

    expect(mocks.upsertDriverJournal).toHaveBeenCalledWith({
      journal: expect.objectContaining({
        bookingId: 'booking-1',
        wasteCode: '17 05 03*',
        tons: 9,
      }),
    });
  });

  it('signs journals and appends immutable audit evidence to the plan', async () => {
    const service = await loadService();
    await service.saveProjectPlanSnapshot({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: {
        driverJournals: [journal('SUBMITTED')],
        auditTrail: [],
      },
    });

    const payload = await service.signDriverJournalForProject({
      projectId: 'project-1',
      organisationId: 'org-1',
      journalId: 'journal-1',
      signerRole: 'REVIEWER',
      signatureId: 'sig-review',
    });

    expect(payload.journal.status).toBe('VERIFIED');
    expect(payload.plan.auditTrail.at(-1)?.signatureId).toBe('sig-review');
  });

  it('guards lims ingestion against unknown bookings and stores reports when valid', async () => {
    const service = await loadService();

    await expect(
      service.ingestLimsReportForProject({
        projectId: 'project-1',
        organisationId: 'org-1',
        report: {
          bookingId: 'missing-booking',
          sampleId: 'sample-1',
          labName: 'ALS',
          rawReference: 'als-1',
          metrics: [],
        },
      }),
    ).rejects.toThrow(/Transport booking not found/i);

    await service.saveProjectPlanSnapshot({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: { transportBookings: [booking()] },
    });

    const payload = await service.ingestLimsReportForProject({
      projectId: 'project-1',
      organisationId: 'org-1',
      report: {
        bookingId: 'booking-1',
        sampleId: 'sample-1',
        labName: 'ALS',
        rawReference: 'als-1',
        metrics: [],
      },
    });

    expect(payload.report.id).toBe('report-1');
    expect(payload.plan.limsReports[0]?.id).toBe('report-1');
  });

  it('verifies lims reports and appends an audit event', async () => {
    const service = await loadService();
    await service.saveProjectPlanSnapshot({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: {
        limsReports: [report(false)],
        auditTrail: [],
      },
    });

    const payload = await service.verifyLimsReportForProject({
      projectId: 'project-1',
      organisationId: 'org-1',
      reportId: 'report-1',
      reviewer: 'QA Reviewer',
      signatureId: 'sig-lims',
      approved: true,
    });

    expect(payload.report.verifiedByHuman).toBe(true);
    expect(payload.plan.auditTrail.at(-1)?.action).toBe('LIMS_REPORT_VERIFY');
  });
});
