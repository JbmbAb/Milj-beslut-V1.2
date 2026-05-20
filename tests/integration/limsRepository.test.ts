import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createLimsReport,
  getLimsReport,
  verifyLimsReport,
  listLimsReportsBySample,
  listLimsReportsByBooking,
} from '../../server/repositories/limsRepository';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

const prisma = new PrismaClient();

describeIfDatabaseIntegration('limsRepository Integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up the LimsReport table before each test
    await prisma.limsReport.deleteMany({});
  });

  it('should create and retrieve a LIMS report', async () => {
    const reportData = {
      sampleId: 'sample-123',
      labName: 'TestLab',
      source: 'API',
      analyzedAt: new Date(),
      rawReference: 'REF-XYZ',
      metrics: { pH: 7.0, lead: 0.05 },
      passed: true,
    };

    const createdReport = await createLimsReport(reportData);
    expect(createdReport).toBeDefined();
    expect(createdReport.id).toBeDefined();
    expect(createdReport.sampleId).toBe(reportData.sampleId);
    expect(createdReport.labName).toBe(reportData.labName);
    expect(createdReport.passed).toBe(reportData.passed);
    expect(createdReport.metrics).toEqual(reportData.metrics);
    expect(createdReport.verifiedByHuman).toBe(false); // Should be false by default

    const retrievedReport = await getLimsReport(createdReport.id);
    expect(retrievedReport).toEqual(createdReport);
  });

  it('should verify a LIMS report', async () => {
    const reportData = {
      sampleId: 'sample-456',
      labName: 'AnotherLab',
      source: 'SFTP',
      analyzedAt: new Date(),
      rawReference: 'REF-ABC',
      metrics: { arsenic: 0.1 },
      passed: false,
    };
    const createdReport = await createLimsReport(reportData);

    const verificationData = {
      reviewer: 'John Doe',
      reviewerSignatureId: 'sig-123',
      verifiedAt: new Date(),
      passed: true, // Overriding original passed status
    };

    const verifiedReport = await verifyLimsReport(createdReport.id, verificationData);
    expect(verifiedReport).toBeDefined();
    expect(verifiedReport.id).toBe(createdReport.id);
    expect(verifiedReport.verifiedByHuman).toBe(true);
    expect(verifiedReport.reviewer).toBe(verificationData.reviewer);
    expect(verifiedReport.reviewerSignatureId).toBe(verificationData.reviewerSignatureId);
    expect(verifiedReport.verifiedAt).toEqual(verificationData.verifiedAt);
    expect(verifiedReport.passed).toBe(verificationData.passed); // Should reflect the new passed status
  });

  it('should list LIMS reports by sample ID', async () => {
    const sampleId = 'common-sample-id';
    const report1 = await createLimsReport({
      sampleId,
      labName: 'LabA',
      source: 'API',
      analyzedAt: new Date(),
      rawReference: 'R1',
      metrics: {},
      passed: true,
    });
    const report2 = await createLimsReport({
      sampleId,
      labName: 'LabB',
      source: 'MANUAL',
      analyzedAt: new Date(),
      rawReference: 'R2',
      metrics: {},
      passed: false,
    });
    await createLimsReport({
      sampleId: 'other-sample',
      labName: 'LabC',
      source: 'API',
      analyzedAt: new Date(),
      rawReference: 'R3',
      metrics: {},
      passed: true,
    });

    const reports = await listLimsReportsBySample(sampleId);
    expect(reports.length).toBe(2);
    expect(reports.some((r) => r.id === report1.id)).toBe(true);
    expect(reports.some((r) => r.id === report2.id)).toBe(true);
  });

  it('should list LIMS reports by booking ID', async () => {
    const bookingId = 'booking-abc';
    const report1 = await createLimsReport({
      bookingId,
      sampleId: 's1',
      labName: 'LabX',
      source: 'API',
      analyzedAt: new Date(),
      rawReference: 'B1',
      metrics: {},
      passed: true,
    });
    const report2 = await createLimsReport({
      bookingId,
      sampleId: 's2',
      labName: 'LabY',
      source: 'API',
      analyzedAt: new Date(),
      rawReference: 'B2',
      metrics: {},
      passed: true,
    });
    await createLimsReport({
      bookingId: 'other-booking',
      sampleId: 's3',
      labName: 'LabZ',
      source: 'API',
      analyzedAt: new Date(),
      rawReference: 'B3',
      metrics: {},
      passed: true,
    });

    const reports = await listLimsReportsByBooking(bookingId);
    expect(reports.length).toBe(2);
    expect(reports.some((r) => r.id === report1.id)).toBe(true);
    expect(reports.some((r) => r.id === report2.id)).toBe(true);
  });
});
