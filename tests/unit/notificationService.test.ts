import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn().mockResolvedValue({ id: 'audit-notify-1' }),
}));

// Nodemailer is dynamically imported – stub it out globally
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
  })),
}));

const prismaMocks = vi.hoisted(() => ({
  projectMemberFindMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    projectMember: { findMany: prismaMocks.projectMemberFindMany },
  },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

// _transporter is module-level state, reset per test
let svc: typeof import('../../server/services/notificationService');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  svc = await import('../../server/services/notificationService');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('notificationService', () => {

  // ── sendProjectNotification ────────────────────────────────────────────────

  describe('sendProjectNotification', () => {
    it('always writes to audit trail and returns auditId', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      const result = await svc.sendProjectNotification({
        projectId: 'proj-1',
        event: 'STAGE_GATE_PASSED',
        gateId: 'gate-a',
        actingUserId: 'user-1',
        message: 'Gate passed',
      });

      expect(appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'PROJECT',
          entityId: 'proj-1',
          action: 'PROJECT_NOTIFICATION',
          userId: 'user-1',
          payload: expect.objectContaining({ event: 'STAGE_GATE_PASSED' }),
        }),
      );

      expect(result.auditId).toBe('audit-notify-1');
    });

    it('returns emailsSent=0 when SMTP is not configured', async () => {
      const result = await svc.sendProjectNotification({
        projectId: 'proj-2',
        event: 'MEMBER_ADDED',
        actingUserId: 'user-2',
        message: 'Ny medlem',
      });

      expect(result.emailsSent).toBe(0);
    });

    it('includes gateId and subjectUserId in audit payload when provided', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.sendProjectNotification({
        projectId: 'proj-3',
        event: 'STAGE_GATE_FAILED',
        gateId: 'gate-b',
        subjectUserId: 'sub-user',
        actingUserId: 'user-3',
        message: 'Gate failed',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.gateId).toBe('gate-b');
      expect(call.payload.subjectUserId).toBe('sub-user');
    });
  });

  // ── notifyStageGate ────────────────────────────────────────────────────────

  describe('notifyStageGate', () => {
    it('sends STAGE_GATE_PASSED event for status=PASSED', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.notifyStageGate({
        projectId: 'proj-sg-1',
        gateId: 'gate-1',
        status: 'PASSED',
        actingUserId: 'user-sg',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.event).toBe('STAGE_GATE_PASSED');
    });

    it('sends STAGE_GATE_FAILED event for status=FAILED', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.notifyStageGate({
        projectId: 'proj-sg-2',
        gateId: 'gate-2',
        status: 'FAILED',
        actingUserId: 'user-sg-2',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.event).toBe('STAGE_GATE_FAILED');
    });

    it('sends STAGE_GATE_BLOCKED event for status=BLOCKED', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.notifyStageGate({
        projectId: 'proj-sg-3',
        gateId: 'gate-3',
        status: 'BLOCKED',
        actingUserId: 'user-sg-3',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.event).toBe('STAGE_GATE_BLOCKED');
    });

    it('treats any unknown status as BLOCKED', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.notifyStageGate({
        projectId: 'proj-sg-4',
        gateId: 'gate-4',
        status: 'SOME_UNKNOWN_STATUS',
        actingUserId: 'user-sg-4',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.event).toBe('STAGE_GATE_BLOCKED');
    });

    it('includes gateId in audit payload', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.notifyStageGate({
        projectId: 'proj-sg-5',
        gateId: 'gate-5',
        status: 'PASSED',
        actingUserId: 'u',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.gateId).toBe('gate-5');
    });

    it('message contains projectId for PASSED status', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');

      await svc.notifyStageGate({
        projectId: 'proj-sg-6',
        gateId: 'gate-6',
        status: 'PASSED',
        actingUserId: 'u',
      });

      const call = (appendDomainAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.payload.message).toContain('proj-sg-6');
    });
  });
});
