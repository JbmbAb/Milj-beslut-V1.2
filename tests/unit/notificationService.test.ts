import { describe, it, expect, vi, beforeEach } from 'vitest';

// Standalone mock functions (stable references across module resets)
const projectMemberFindMany = vi.fn();
const appendDomainAudit = vi.fn();
const sendMail = vi.fn();
const nodemailerCreateTransport = vi.fn();

vi.mock('../../server/db/prisma', () => ({
  prisma: { projectMember: { findMany: projectMemberFindMany } },
}));

vi.mock('../../server/security/auditTrail', () => ({ appendDomainAudit }));

vi.mock('nodemailer', () => ({
  default: { createTransport: nodemailerCreateTransport },
  createTransport: nodemailerCreateTransport,
}));

import type { ProjectNotification } from '../../server/services/notificationService';

const baseNotif: ProjectNotification = {
  projectId: 'proj-001',
  event: 'STAGE_GATE_PASSED',
  gateId: 'gate-1',
  actingUserId: 'user-1',
  message: 'Gate passed successfully',
};

const auditRecord = { id: 'audit-xyz' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.NOTIFICATION_FROM_EMAIL;
  appendDomainAudit.mockResolvedValue(auditRecord);
});

// Re-import after resetModules to get a fresh module with cleared _transporter cache.
async function svc() {
  return import('../../server/services/notificationService');
}

// ── sendProjectNotification ───────────────────────────────────────────────────

describe('sendProjectNotification', () => {
  describe('without SMTP configured', () => {
    it('returns auditId and 0 emailsSent when SMTP is not configured', async () => {
      const { sendProjectNotification } = await svc();
      const result = await sendProjectNotification(baseNotif);
      expect(result.auditId).toBe('audit-xyz');
      expect(result.emailsSent).toBe(0);
    });

    it('always calls appendDomainAudit', async () => {
      const { sendProjectNotification } = await svc();
      await sendProjectNotification(baseNotif);
      expect(appendDomainAudit).toHaveBeenCalledOnce();
      const call = appendDomainAudit.mock.calls[0][0];
      expect(call.entityType).toBe('PROJECT');
      expect(call.entityId).toBe('proj-001');
      expect(call.action).toBe('PROJECT_NOTIFICATION');
      expect(call.userId).toBe('user-1');
      expect(call.payload.event).toBe('STAGE_GATE_PASSED');
      expect(call.payload.message).toBe('Gate passed successfully');
    });

    it('does NOT query prisma.projectMember when SMTP is absent', async () => {
      const { sendProjectNotification } = await svc();
      await sendProjectNotification(baseNotif);
      expect(projectMemberFindMany).not.toHaveBeenCalled();
    });

    it('stores gateId null when not provided', async () => {
      const { sendProjectNotification } = await svc();
      const notif: ProjectNotification = { ...baseNotif, gateId: undefined };
      await sendProjectNotification(notif);
      expect(appendDomainAudit.mock.calls[0][0].payload.gateId).toBeNull();
    });

    it('stores subjectUserId null when not provided', async () => {
      const { sendProjectNotification } = await svc();
      await sendProjectNotification(baseNotif);
      expect(appendDomainAudit.mock.calls[0][0].payload.subjectUserId).toBeNull();
    });
  });

  describe('with SMTP configured', () => {
    beforeEach(() => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_USER = 'user@example.com';
      process.env.SMTP_PASS = 'secret';
      sendMail.mockResolvedValue({});
      nodemailerCreateTransport.mockReturnValue({ sendMail });
    });

    it('sends email to members whose bankidId contains @', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([
        { user: { bankidId: 'member@example.com' } },
        { user: { bankidId: '196001011234' } },
      ]);
      const result = await sendProjectNotification(baseNotif);
      expect(result.emailsSent).toBe(1);
      expect(sendMail).toHaveBeenCalledOnce();
    });

    it('skips members whose bankidId has no @', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([
        { user: { bankidId: '196001011234' } },
        { user: { bankidId: '199005051234' } },
      ]);
      const result = await sendProjectNotification(baseNotif);
      expect(result.emailsSent).toBe(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends to multiple email members', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([
        { user: { bankidId: 'a@example.com' } },
        { user: { bankidId: 'b@example.com' } },
      ]);
      const result = await sendProjectNotification(baseNotif);
      expect(result.emailsSent).toBe(2);
    });

    it('counts emailsSent only for successful sendMail calls', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([
        { user: { bankidId: 'ok@example.com' } },
        { user: { bankidId: 'fail@example.com' } },
      ]);
      sendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('SMTP error'));
      const result = await sendProjectNotification(baseNotif);
      expect(result.emailsSent).toBe(1);
    });

    it('uses NOTIFICATION_FROM_EMAIL when set', async () => {
      process.env.NOTIFICATION_FROM_EMAIL = 'system@gov.se';
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([{ user: { bankidId: 'r@example.com' } }]);
      await sendProjectNotification(baseNotif);
      const sentArgs = sendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(sentArgs.from).toBe('system@gov.se');
    });

    it('uses default from email noreply@miljobeslut.se when not set', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([{ user: { bankidId: 'r@example.com' } }]);
      await sendProjectNotification(baseNotif);
      const sentArgs = sendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(sentArgs.from).toBe('noreply@miljobeslut.se');
    });

    it('subject contains event label and projectId', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([{ user: { bankidId: 'r@example.com' } }]);
      await sendProjectNotification(baseNotif);
      const sentArgs = sendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(String(sentArgs.subject)).toContain('Stage Gate godkänd');
      expect(String(sentArgs.subject)).toContain('proj-001');
    });

    it('still returns auditId even when no members', async () => {
      const { sendProjectNotification } = await svc();
      projectMemberFindMany.mockResolvedValue([]);
      const result = await sendProjectNotification(baseNotif);
      expect(result.auditId).toBe('audit-xyz');
    });
  });
});

// ── notifyStageGate ───────────────────────────────────────────────────────────

describe('notifyStageGate', () => {
  it('calls sendProjectNotification with STAGE_GATE_PASSED for status PASSED', async () => {
    const { notifyStageGate } = await svc();
    await notifyStageGate({ projectId: 'proj-002', gateId: 'gate-A', status: 'PASSED', actingUserId: 'user-2' });
    const call = appendDomainAudit.mock.calls[0][0];
    expect(call.payload.event).toBe('STAGE_GATE_PASSED');
    expect(call.payload.gateId).toBe('gate-A');
  });

  it('uses STAGE_GATE_FAILED for status FAILED', async () => {
    const { notifyStageGate } = await svc();
    await notifyStageGate({ projectId: 'proj-003', gateId: 'gate-B', status: 'FAILED', actingUserId: 'user-3' });
    const call = appendDomainAudit.mock.calls[0][0];
    expect(call.payload.event).toBe('STAGE_GATE_FAILED');
    expect(call.payload.message).toContain('underkändes');
  });

  it('uses STAGE_GATE_BLOCKED for status BLOCKED', async () => {
    const { notifyStageGate } = await svc();
    await notifyStageGate({ projectId: 'proj-004', gateId: 'gate-C', status: 'BLOCKED', actingUserId: 'user-4' });
    const call = appendDomainAudit.mock.calls[0][0];
    expect(call.payload.event).toBe('STAGE_GATE_BLOCKED');
    expect(call.payload.message).toContain('blockerad');
  });

  it('uses STAGE_GATE_BLOCKED for an unexpected status string', async () => {
    const { notifyStageGate } = await svc();
    await notifyStageGate({ projectId: 'proj-005', gateId: 'gate-D', status: 'UNKNOWN', actingUserId: 'user-5' });
    expect(appendDomainAudit.mock.calls[0][0].payload.event).toBe('STAGE_GATE_BLOCKED');
  });

  it('message for PASSED references the gateId and projectId', async () => {
    const { notifyStageGate } = await svc();
    await notifyStageGate({ projectId: 'proj-006', gateId: 'gate-E', status: 'PASSED', actingUserId: 'user-6' });
    const call = appendDomainAudit.mock.calls[0][0];
    expect(call.payload.message).toContain('gate-E');
    expect(call.payload.message).toContain('proj-006');
  });

  it('resolves without throwing', async () => {
    const { notifyStageGate } = await svc();
    await expect(
      notifyStageGate({ projectId: 'p', gateId: 'g', status: 'PASSED', actingUserId: 'u' }),
    ).resolves.toBeUndefined();
  });
});
