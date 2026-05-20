import { describe, expect, it, vi } from 'vitest';

const auditRows: Array<{
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string | null;
  timestamp: Date;
  payloadHash: string;
  prevHash: string | null;
  chainHash: string;
}> = [];

vi.mock('../../server/repositories/auditRepository', () => {
  return {
    appendAuditTrailRow: vi.fn(async (row) => {
      auditRows.push({
        id: `audit-${auditRows.length + 1}`,
        ...row,
      });
    }),
    getLatestAuditRow: vi.fn(async () => auditRows.at(-1) ?? null),
    getAuditExportRows: vi.fn(async (limit?: number) => auditRows.slice(0, limit ?? auditRows.length)),
  };
});

import {
  appendDomainAudit,
  appendPropertyAudit,
  exportAuditTrail,
  verifyAuditTrail,
} from '../../server/security/auditTrail';

describe('auditTrail', () => {
  it('appends records and verifies hash chain integrity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T01:00:00Z'));
    auditRows.length = 0;

    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: 'project-1:save',
      action: 'PLAN_SAVE',
      userId: 'user-1',
      payload: { projectId: 'project-1' },
    });

    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: 'project-1:template',
      action: 'TEMPLATE_APPLY',
      userId: 'user-1',
      payload: { projectId: 'project-1', templateId: 'ENV_PERMIT_CORE' },
    });

    const verification = await verifyAuditTrail();
    expect(verification.ok).toBe(true);
    expect((await exportAuditTrail()).length).toBeGreaterThanOrEqual(2);
  });

  it('detects tampering in chain hash', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T02:00:00Z'));
    auditRows.length = 0;
    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: 'project-1:save',
      action: 'PLAN_SAVE',
      userId: 'user-1',
      payload: { projectId: 'project-1' },
    });

    const rows = (await exportAuditTrail()) as unknown as Array<{ chainHash: string }>;
    expect(rows.length).toBeGreaterThan(0);

    auditRows[0].chainHash = 'tampered-hash';
    const verification = await verifyAuditTrail();

    expect(verification.ok).toBe(false);
    expect(verification.invalidIndex).toBe(0);
  });

  it('verifyAuditTrail returns ok=true for an empty trail', async () => {
    auditRows.length = 0;
    const verification = await verifyAuditTrail();
    expect(verification.ok).toBe(true);
    expect(verification.invalidIndex).toBeUndefined();
  });

  it('appendPropertyAudit stores a PropertyAccess audit record', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T03:00:00Z'));
    auditRows.length = 0;

    const record = await appendPropertyAudit({
      projectId: 'project-2',
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
      userId: 'user-2',
      organisationId: 'org-1',
      purpose: 'Bygglov',
    } as any);

    expect(record.entityType).toBe('PropertyAccess');
    expect(record.entityId).toBe('project-2:GÄVLE BRYNÄS 1:1');
    expect(record.action).toBe('READ');
    expect(record.userId).toBe('user-2');
  });

  it('exportAuditTrail returns records with ISO timestamp strings', async () => {
    auditRows.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T04:00:00Z'));

    await appendDomainAudit({
      entityType: 'Document',
      entityId: 'doc-1',
      action: 'CREATE',
      userId: 'user-3',
      payload: { filename: 'test.pdf' },
    });

    const exported = await exportAuditTrail();
    expect(exported).toHaveLength(1);
    expect(typeof exported[0]?.timestamp).toBe('string');
    expect(exported[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
