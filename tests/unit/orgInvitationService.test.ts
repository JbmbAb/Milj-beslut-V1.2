import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  organisationFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
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
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      create: mocks.userCreate,
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
    mocks.userFindUnique.mockResolvedValue({ id: ACTING_USER, organisationId: ORG_ID, role: 'ADMIN' });
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

  it('denies ADMIN invitations from non-ADMIN organisation members', async () => {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });
    mocks.userFindUnique.mockResolvedValue({
      id: 'consultant-1',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    await expect(
      createInvitation({
        orgId: ORG_ID,
        email: 'admin@example.com',
        role: 'ADMIN',
        actingUserId: 'consultant-1',
      }),
    ).rejects.toThrow('ADMIN-inbjudan kräver ADMIN-behörighet');
    expect(mocks.appendDomainAudit).not.toHaveBeenCalled();
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
    mocks.userFindUnique.mockResolvedValue({ id: ACTING_USER, organisationId: ORG_ID, role: 'ADMIN' });
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
    mocks.userFindUnique.mockResolvedValue({ id: ACTING_USER, organisationId: ORG_ID, role: 'ADMIN' });
  });

  async function createTestInvitation(email = 'accept@example.com') {
    mocks.organisationFindUnique.mockResolvedValue({ id: ORG_ID });
    return createInvitation({ orgId: ORG_ID, email, role: 'CONSULTANT', actingUserId: ACTING_USER });
  }

  it('accepts a valid invitation and returns user info', async () => {
    const inv = await createTestInvitation('accept-happy@example.com');
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: 'new-user-001',
      bankidId: 'bid123',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    const result = await acceptInvitation({ orgId: ORG_ID, token: inv.token, verifiedBankidId: 'bid123' });

    expect(result.userId).toBe('new-user-001');
    expect(result.orgId).toBe(ORG_ID);
    expect(result.role).toBe('CONSULTANT');
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INVITATION_ACCEPTED' }),
    );
  });

  it('reuses existing user if found', async () => {
    const inv = await createTestInvitation('reuse@example.com');
    mocks.userFindFirst.mockResolvedValue({
      id: 'existing-user',
      bankidId: 'bid-existing',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    const result = await acceptInvitation({
      orgId: ORG_ID,
      token: inv.token,
      verifiedBankidId: 'bid-existing',
    });

    expect(result.userId).toBe('existing-user');
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('throws when token is not found', async () => {
    await expect(
      acceptInvitation({ orgId: ORG_ID, token: 'invalid-token', verifiedBankidId: 'bid' }),
    ).rejects.toThrow('hittades inte');
  });

  it('throws when invitation is already accepted', async () => {
    const inv = await createTestInvitation('already-accepted@example.com');
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: 'u1',
      bankidId: 'b1',
      organisationId: ORG_ID,
      role: 'CONSULTANT',
    });

    // Accept once
    await acceptInvitation({ orgId: ORG_ID, token: inv.token, verifiedBankidId: 'b1' });

    // Try again
    await expect(
      acceptInvitation({ orgId: ORG_ID, token: inv.token, verifiedBankidId: 'b1' }),
    ).rejects.toThrow('ACCEPTED');
  });
});

describe('revokeInvitation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.appendDomainAudit.mockResolvedValue(undefined);
    mocks.userFindUnique.mockResolvedValue({ id: ACTING_USER, organisationId: ORG_ID, role: 'ADMIN' });
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
