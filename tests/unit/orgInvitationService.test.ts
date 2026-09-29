import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  organisationFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  bankIdSessionFindUnique: vi.fn(),
  appendDomainAudit: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    organisation: {
      findUnique: mocks.organisationFindUnique,
    },
    user: {
      findFirst: mocks.userFindFirst,
      create: mocks.userCreate,
    },
    // Backs persistentReplayProtection.getCompletedSession, which acceptInvitation now uses
    // (HD-06) to resolve a verified bankidId instead of trusting a client-supplied one.
    bankIdSession: {
      findUnique: mocks.bankIdSessionFindUnique,
    },
  },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

// Import after mocks to ensure module uses fresh in-memory state.
import {
  createInvitation,
  listInvitations,
  acceptInvitation,
  revokeInvitation,
} from '../../server/services/orgInvitationService';

const ORG_ID = 'org-test-001';
const ACTING_USER = 'user-admin-001';

describe('createInvitation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.appendDomainAudit.mockResolvedValue(undefined);
  });

  it('creates and returns a new invitation', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID, name: 'Test Org' });

    const inv = await createInvitation({
      orgId: ORG_ID,
      email: 'user@example.com',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    expect(inv.orgId).toBe(ORG_ID);
    expect(inv.email).toBe('user@example.com');
    expect(inv.role).toBe('CONSULTANT');
    expect(inv.status).toBe('PENDING');
    expect(inv.token).toBeTruthy();
    expect(inv.id).toBeTruthy();
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INVITATION_CREATED' }),
    );
  });

  it('throws when organisation does not exist', async () => {
    mocks.organisationFindUnique.mockResolvedValue(null);

    await expect(
      createInvitation({ orgId: 'no-org', email: 'x@x.com', role: 'CONSULTANT', actingUserId: ACTING_USER }),
    ).rejects.toThrow('hittades inte');
  });

  it('normalises email to lowercase', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });

    const inv = await createInvitation({
      orgId: ORG_ID,
      email: 'USER@EXAMPLE.COM',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    expect(inv.email).toBe('user@example.com');
  });

  it('returns existing pending invitation for same email', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });

    const first = await createInvitation({
      orgId: ORG_ID,
      email: 'dup@example.com',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    // Reset call count to verify second call doesn't create another audit entry
    mocks.appendDomainAudit.mockClear();

    const second = await createInvitation({
      orgId: ORG_ID,
      email: 'dup@example.com',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    expect(second.id).toBe(first.id);
    expect(mocks.appendDomainAudit).not.toHaveBeenCalled();
  });
});

describe('listInvitations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.appendDomainAudit.mockResolvedValue(undefined);
  });

  it('returns invitations for the given orgId', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });

    await createInvitation({
      orgId: ORG_ID,
      email: 'list-test@example.com',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    const list = listInvitations(ORG_ID);
    expect(list.some((i) => i.email === 'list-test@example.com')).toBe(true);
  });

  it('does not return invitations from other orgs', async () => {
    const list = listInvitations('other-org-999');
    expect(list.every((i) => i.orgId === 'other-org-999')).toBe(true);
  });
});

describe('acceptInvitation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.appendDomainAudit.mockResolvedValue(undefined);
  });

  async function createTestInvitation(email = 'accept@example.com') {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });
    return createInvitation({ orgId: ORG_ID, email, role: 'CONSULTANT', actingUserId: ACTING_USER });
  }

  function mockCompletedSession(bankidId: string) {
    mocks.bankIdSessionFindUnique.mockResolvedValue({
      orderRef: 'order-ref-1',
      status: 'COMPLETED',
      bankidId,
    });
  }

  it('accepts a valid invitation backed by a completed BankID session and returns user info', async () => {
    const inv = await createTestInvitation('accept-happy@example.com');
    mockCompletedSession('bid123');
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: 'new-user-001',
      bankidId: 'bid123',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    const result = await acceptInvitation({ orgId: ORG_ID, token: inv.token, orderRef: 'order-ref-1' });

    expect(result.userId).toBe('new-user-001');
    expect(result.orgId).toBe(ORG_ID);
    expect(result.role).toBe('CONSULTANT');
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bankidId: 'bid123' }) }),
    );
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INVITATION_ACCEPTED' }),
    );
  });

  it('reuses existing user if found', async () => {
    const inv = await createTestInvitation('reuse@example.com');
    mockCompletedSession('bid-existing');
    mocks.userFindFirst.mockResolvedValue({
      id: 'existing-user',
      bankidId: 'bid-existing',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    const result = await acceptInvitation({ orgId: ORG_ID, token: inv.token, orderRef: 'order-ref-1' });

    expect(result.userId).toBe('existing-user');
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('throws when token is not found', async () => {
    mockCompletedSession('bid');
    await expect(
      acceptInvitation({ orgId: ORG_ID, token: 'invalid-token', orderRef: 'order-ref-1' }),
    ).rejects.toThrow('hittades inte');
  });

  it('throws when invitation is already accepted', async () => {
    const inv = await createTestInvitation('already-accepted@example.com');
    mockCompletedSession('b1');
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: 'u1',
      bankidId: 'b1',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    // Accept once
    await acceptInvitation({ orgId: ORG_ID, token: inv.token, orderRef: 'order-ref-1' });

    // Try again
    await expect(
      acceptInvitation({ orgId: ORG_ID, token: inv.token, orderRef: 'order-ref-1' }),
    ).rejects.toThrow('ACCEPTED');
  });

  // HD-06 (AOP-08): the whole point of this fix -- without a genuinely completed BankID session,
  // acceptance must fail closed. No session found for the given orderRef.
  it('fails closed when no BankID session exists for the given orderRef', async () => {
    const inv = await createTestInvitation('no-session@example.com');
    mocks.bankIdSessionFindUnique.mockResolvedValue(null);

    await expect(
      acceptInvitation({ orgId: ORG_ID, token: inv.token, orderRef: 'nonexistent-order-ref' }),
    ).rejects.toThrow(/verifierad|slutförts/i);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  // HD-06: a session that exists but never completed (still PENDING, or FAILED) must not be
  // treated as a verified identity either.
  it('fails closed when the BankID session exists but has not completed', async () => {
    const inv = await createTestInvitation('pending-session@example.com');
    mocks.bankIdSessionFindUnique.mockResolvedValue({
      orderRef: 'order-ref-1',
      status: 'PENDING',
      bankidId: null,
    });

    await expect(
      acceptInvitation({ orgId: ORG_ID, token: inv.token, orderRef: 'order-ref-1' }),
    ).rejects.toThrow(/verifierad|slutförts/i);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});

describe('revokeInvitation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.appendDomainAudit.mockResolvedValue(undefined);
  });

  it('revokes a pending invitation', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });

    const inv = await createInvitation({
      orgId: ORG_ID,
      email: 'revoke@example.com',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    await revokeInvitation({ orgId: ORG_ID, inviteId: inv.id, actingUserId: ACTING_USER });

    const list = listInvitations(ORG_ID);
    const found = list.find((i) => i.id === inv.id);
    expect(found?.status).toBe('REVOKED');
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INVITATION_REVOKED' }),
    );
  });

  it('throws when invitation id does not exist', async () => {
    await expect(
      revokeInvitation({ orgId: ORG_ID, inviteId: 'no-such-id', actingUserId: ACTING_USER }),
    ).rejects.toThrow('hittades inte');
  });

  it('throws when invitation belongs to different org', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });

    const inv = await createInvitation({
      orgId: ORG_ID,
      email: 'wrong-org@example.com',
      role: 'CONSULTANT',
      actingUserId: ACTING_USER,
    });

    await expect(
      revokeInvitation({ orgId: 'different-org', inviteId: inv.id, actingUserId: ACTING_USER }),
    ).rejects.toThrow('hittades inte');
  });
});
