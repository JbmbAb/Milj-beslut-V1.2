import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  auditTrail,
  getAuditTrail,
  generateComplianceReport,
} from '../../../server/services/auditTrailService';
import { prisma } from '../../../db.server';

vi.mock('../../../db.server', () => ({
  prisma: {
    auditTrail: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AuditTrailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log an action', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logAction(
      'AVLOPP-1',
      'APPLICATION_CREATED',
      'SewageApplication',
      'app-1',
      'user-1',
      'Created application',
    );

    expect(prisma.auditTrail.create).toHaveBeenCalled();
    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.entityType).toBe('SewageApplication');
    expect(call.data.action).toBe('APPLICATION_CREATED');
  });

  it('should get audit trail', async () => {
    const mockLogs = [{ payloadHash: JSON.stringify({ referenceNumber: 'AVLOPP-1', action: 'CREATED' }) }];
    (prisma.auditTrail.findMany as any).mockResolvedValue(mockLogs);

    const result = await getAuditTrail('AVLOPP-1');

    expect(result.length).toBe(1);
    expect(result[0].referenceNumber).toBe('AVLOPP-1');
    expect(prisma.auditTrail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { timestamp: 'asc' } }),
    );
  });

  it('returns immutable:true on returned entry', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    const entry = await auditTrail.logAction(
      'AVLOPP-2',
      'APPLICATION_UPDATED',
      'SewageApplication',
      'app-2',
      'user-1',
      'Updated',
    );

    expect(entry.immutable).toBe(true);
    expect(entry.referenceNumber).toBe('AVLOPP-2');
  });

  it('still returns entry even when DB persistence fails (catch branch)', async () => {
    (prisma.auditTrail.create as any).mockRejectedValue(new Error('DB offline'));
    const { logger } = await import('../../../server/logger');

    const entry = await auditTrail.logAction(
      'AVLOPP-3',
      'SYSTEM_ERROR',
      'SewageApplication',
      'app-3',
      'SYSTEM',
      'Test error',
    );

    expect(entry.action).toBe('SYSTEM_ERROR');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to persist audit trail entry',
      expect.objectContaining({ action: 'SYSTEM_ERROR' }),
    );
  });

  it('logSubmission delegates to logAction with APPLICATION_SUBMITTED', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logSubmission('AVLOPP-10', 'app-10', 'user-1', '0180', ['plan.pdf']);

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('APPLICATION_SUBMITTED');
  });

  it('logStatusUpdate records old and new status in changes', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logStatusUpdate('AVLOPP-20', 'app-20', 'SUBMITTED', 'UNDER_REVIEW', '0180');

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('STATUS_UPDATE_RECEIVED');
  });

  it('logDecision maps APPROVED to APPROVAL_GRANTED', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logDecision('AVLOPP-30', 'app-30', 'APPROVED', 'Allt OK', '0180');

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('APPROVAL_GRANTED');
  });

  it('logDecision maps REJECTED to REJECTION_RECEIVED', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logDecision('AVLOPP-31', 'app-31', 'REJECTED', 'Brister', '0180');

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('REJECTION_RECEIVED');
  });

  it('logDecision maps CONDITIONAL to REVISION_REQUESTED', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logDecision('AVLOPP-32', 'app-32', 'CONDITIONAL', 'Komplettera', '0180');

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('REVISION_REQUESTED');
  });

  it('logDocumentGeneration records DOCUMENTS_GENERATED', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logDocumentGeneration('AVLOPP-40', 'app-40', 'user-1', [
      'ansökan.pdf',
      'situationsplan.pdf',
    ]);

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('DOCUMENTS_GENERATED');
  });

  it('logSignature records SIGNATURE_APPLIED with BANKID type', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logSignature('AVLOPP-50', 'app-50', 'user-1', 'BANKID', 'sig-001', 'doc-001');

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('SIGNATURE_APPLIED');
  });

  it('logError records SYSTEM_ERROR with critical severity', async () => {
    (prisma.auditTrail.create as any).mockResolvedValue({});

    await auditTrail.logError('AVLOPP-60', 'app-60', 'BankID timeout', 'BANKID_TIMEOUT', { retry: 3 });

    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    expect(call.data.action).toBe('SYSTEM_ERROR');
  });

  it('getAuditTrail returns empty array on DB error', async () => {
    (prisma.auditTrail.findMany as any).mockRejectedValue(new Error('Connection lost'));

    const result = await getAuditTrail('AVLOPP-99');

    expect(result).toEqual([]);
  });

  it('getAuditTrail skips entries with invalid JSON in payloadHash', async () => {
    (prisma.auditTrail.findMany as any).mockResolvedValue([
      { payloadHash: 'not-valid-json' },
      { payloadHash: JSON.stringify({ referenceNumber: 'AVLOPP-5', action: 'APPLICATION_CREATED' }) },
    ]);

    const result = await getAuditTrail('AVLOPP-5');

    expect(result).toHaveLength(1);
  });

  it('generateComplianceReport returns auditTrailComplete false when no events', async () => {
    (prisma.auditTrail.findMany as any).mockResolvedValue([]);

    const report = await generateComplianceReport('AVLOPP-100');

    expect(report.auditTrailComplete).toBe(false);
    expect(report.criticalEventsCount).toBe(0);
    expect(report.referenceNumber).toBe('AVLOPP-100');
  });

  it('generateComplianceReport counts critical events correctly', async () => {
    const entries = [
      {
        referenceNumber: 'AVLOPP-101',
        severity: 'critical',
        action: 'APPLICATION_SUBMITTED',
        userId: 'u1',
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        referenceNumber: 'AVLOPP-101',
        severity: 'info',
        action: 'GIS_ANALYSIS_COMPLETED',
        userId: 'u1',
        timestamp: '2026-01-01T01:00:00Z',
      },
    ];
    (prisma.auditTrail.findMany as any).mockResolvedValue(
      entries.map((e) => ({ payloadHash: JSON.stringify(e) })),
    );

    const report = await generateComplianceReport('AVLOPP-101');

    expect(report.criticalEventsCount).toBe(1);
    expect(report.auditTrailComplete).toBe(true);
    expect(report.timeline).toHaveLength(2);
  });
});

// ── AuditTrailLogger — saknade metoder ────────────────────────────────────

describe('AuditTrailLogger — logGISAnalysis, logSystemSelection, logDataExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.auditTrail.create as any).mockResolvedValue({});
  });

  it('logGISAnalysis loggar action med skyddsnivå', async () => {
    await auditTrail.logGISAnalysis('AVLOPP-gis-1', 'app-1', 'user-1', 'HIGH', ['MINI_PLANT_BDTA']);
    expect(prisma.auditTrail.create).toHaveBeenCalledOnce();
    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    const payload = JSON.parse(call.data.payloadHash);
    expect(payload.referenceNumber).toBe('AVLOPP-gis-1');
  });

  it('logSystemSelection loggar valt system och PE', async () => {
    await auditTrail.logSystemSelection('AVLOPP-sys-1', 'app-1', 'user-1', 'INFILTRATION', 5);
    expect(prisma.auditTrail.create).toHaveBeenCalledOnce();
    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    const payload = JSON.parse(call.data.payloadHash);
    expect(payload.referenceNumber).toBe('AVLOPP-sys-1');
  });

  it('logDataExport loggar exportformat och mottagare', async () => {
    await auditTrail.logDataExport('AVLOPP-exp-1', 'app-1', 'user-1', 'PDF', ['mottagare@test.se']);
    expect(prisma.auditTrail.create).toHaveBeenCalledOnce();
    const call = (prisma.auditTrail.create as any).mock.calls[0][0];
    const payload = JSON.parse(call.data.payloadHash);
    expect(payload.referenceNumber).toBe('AVLOPP-exp-1');
  });

  it('logDataExport fungerar utan mottagarlista', async () => {
    await auditTrail.logDataExport('AVLOPP-exp-2', 'app-2', 'user-1', 'JSON');
    expect(prisma.auditTrail.create).toHaveBeenCalledOnce();
  });
});
