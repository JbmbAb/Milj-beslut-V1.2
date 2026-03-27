import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const prismaMocks = vi.hoisted(() => ({
  orgFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    organisation: { findUnique: prismaMocks.orgFindUnique },
    user: {
      findFirst: prismaMocks.userFindFirst,
      create: prismaMocks.userCreate,
    },
  },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

// Reset modules per test to get a clean in-memory invitations map.
let svc: typeof import('../../server/services/orgInvitationService');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  svc = await import('../../server/services/orgInvitationService');

  // Default: organisation exists
  prismaMocks.orgFindUnique.mockResolvedValue({ id: 'org-1', name: 'Test Org' });
});

// ─── Counter for unique org/email IDs ─────────────────────────────────────────
let counter = 0;
function uniqueOrg() {
  return `org-test-${++counter}`;
}
function uniqueEmail() {
  return `user-${counter}@example.com`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('orgInvitationService', () => {
  // ── createInvitation ───────────────────────────────────────────────────────

  describe('createInvitation', () => {
    it('creates an invitation with correct fields', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: 'anna@example.com',
        role: 'CONSULTANT',
        actingUserId: 'admin-1',
      });

      expect(inv.id).toBeTruthy();
      expect(inv.orgId).toBe(orgId);
      expect(inv.email).toBe('anna@example.com');
      expect(inv.role).toBe('CONSULTANT');
      expect(inv.status).toBe('PENDING');
      expect(new Date(inv.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('normalises email to lowercase', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: 'ANNA@EXAMPLE.COM',
        role: 'CONSULTANT',
        actingUserId: 'admin-1',
      });

      expect(inv.email).toBe('anna@example.com');
    });

    it('throws when organisation does not exist', async () => {
      prismaMocks.orgFindUnique.mockResolvedValue(null);

      await expect(
        svc.createInvitation({
          orgId: 'org-missing',
          email: 'x@example.com',
          role: 'CONSULTANT',
          actingUserId: 'admin-1',
        }),
      ).rejects.toThrow('hittades inte');
    });

    it('deduplicates: returns existing PENDING invite for same email+org', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv1 = await svc.createInvitation({
        orgId,
        email: 'dup@example.com',
        role: 'CONSULTANT',
        actingUserId: 'admin-1',
      });

      const inv2 = await svc.createInvitation({
        orgId,
        email: 'dup@example.com',
        role: 'ADMIN',
        actingUserId: 'admin-2',
      });

      expect(inv2.id).toBe(inv1.id);
    });

    it('creates a new invite if previous one was for different org', async () => {
      const orgA = uniqueOrg();
      const orgB = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgA });

      const inv1 = await svc.createInvitation({
        orgId: orgA,
        email: 'shared@example.com',
        role: 'CONSULTANT',
        actingUserId: 'admin-1',
      });

      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgB });
      const inv2 = await svc.createInvitation({
        orgId: orgB,
        email: 'shared@example.com',
        role: 'CONSULTANT',
        actingUserId: 'admin-1',
      });

      expect(inv2.id).not.toBe(inv1.id);
    });

    it('writes an audit event', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'admin-audit',
      });

      expect(appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_CREATED', entityType: 'ORG_INVITATION' }),
      );
    });
  });

  // ── listInvitations ────────────────────────────────────────────────────────

  describe('listInvitations', () => {
    it('returns empty array when no invitations exist for org', () => {
      expect(svc.listInvitations('org-empty')).toHaveLength(0);
    });

    it('returns only invitations for the requested org', async () => {
      const orgA = uniqueOrg();
      const orgB = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgA });

      await svc.createInvitation({
        orgId: orgA,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'a',
      });

      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgB });
      await svc.createInvitation({
        orgId: orgB,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'a',
      });

      const list = svc.listInvitations(orgA);
      expect(list.every((inv) => inv.orgId === orgA)).toBe(true);
    });

    it('marks expired invitations as EXPIRED', async () => {
      // Create an invite, then manually expire it by directly overriding expiresAt
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'a',
      });

      // Manipulate via the returned object reference that's also stored in the map
      // (the map stores the same reference, so mutating inv affects the map)
      inv.expiresAt = new Date(Date.now() - 1000).toISOString();

      const list = svc.listInvitations(orgId);
      const listed = list.find((i) => i.id === inv.id);
      expect(listed?.status).toBe('EXPIRED');
    });
  });

  // ── revokeInvitation ───────────────────────────────────────────────────────

  describe('revokeInvitation', () => {
    it('marks the invitation as REVOKED', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'a',
      });

      await svc.revokeInvitation({ orgId, inviteId: inv.id, actingUserId: 'admin-r' });

      const found = svc.listInvitations(orgId).find((i) => i.id === inv.id);
      expect(found?.status).toBe('REVOKED');
    });

    it('throws when inviteId does not exist', async () => {
      await expect(
        svc.revokeInvitation({ orgId: 'org-x', inviteId: 'no-such-invite', actingUserId: 'a' }),
      ).rejects.toThrow('hittades inte');
    });

    it('throws when inviteId belongs to a different org', async () => {
      const orgA = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgA });
      const inv = await svc.createInvitation({
        orgId: orgA,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'a',
      });

      await expect(
        svc.revokeInvitation({ orgId: 'org-wrong', inviteId: inv.id, actingUserId: 'a' }),
      ).rejects.toThrow('hittades inte');
    });

    it('writes an audit event on revoke', async () => {
      const { appendDomainAudit } = await import('../../server/security/auditTrail');
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });
      const inv = await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'a',
      });

      await svc.revokeInvitation({ orgId, inviteId: inv.id, actingUserId: 'admin-audit' });

      expect(appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_REVOKED' }),
      );
    });
  });

  // ── acceptInvitation ───────────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    it('accepts a valid invitation and returns userId, orgId, role', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'admin-a',
      });

      prismaMocks.userFindFirst.mockResolvedValue(null);
      prismaMocks.userCreate.mockResolvedValue({
        id: 'user-new',
        bankidId: '19900101-1234',
        organisationId: orgId,
        role: 'CONSULTANT',
      });

      const result = await svc.acceptInvitation({
        orgId,
        token: inv.token,
        bankidId: '19900101-1234',
      });

      expect(result.userId).toBe('user-new');
      expect(result.orgId).toBe(orgId);
      expect(result.role).toBe('CONSULTANT');
    });

    it('throws for an invalid (unknown) token', async () => {
      const orgId = uniqueOrg();
      await expect(
        svc.acceptInvitation({ orgId, token: 'invalid-token', bankidId: 'some-id' }),
      ).rejects.toThrow('hittades inte');
    });

    it('throws for an already revoked invitation', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'CONSULTANT',
        actingUserId: 'admin-a',
      });

      await svc.revokeInvitation({ orgId, inviteId: inv.id, actingUserId: 'admin-a' });

      await expect(svc.acceptInvitation({ orgId, token: inv.token, bankidId: 'some-id' })).rejects.toThrow(
        'REVOKED',
      );
    });

    it('reuses an existing user when bankidId already has a record', async () => {
      const orgId = uniqueOrg();
      prismaMocks.orgFindUnique.mockResolvedValue({ id: orgId });

      const inv = await svc.createInvitation({
        orgId,
        email: uniqueEmail(),
        role: 'ADMIN',
        actingUserId: 'admin-a',
      });

      const existingUser = {
        id: 'user-existing',
        bankidId: 'existing-bankid',
        organisationId: orgId,
        role: 'ADMIN',
      };
      prismaMocks.userFindFirst.mockResolvedValue(existingUser);

      const result = await svc.acceptInvitation({
        orgId,
        token: inv.token,
        bankidId: 'existing-bankid',
      });

      expect(result.userId).toBe('user-existing');
      expect(prismaMocks.userCreate).not.toHaveBeenCalled();
    });
  });
});
