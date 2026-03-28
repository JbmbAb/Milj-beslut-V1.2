import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  createInvitation: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/orgInvitationService', () => ({
  createInvitation: mocks.createInvitation,
  listInvitations: mocks.listInvitations,
  acceptInvitation: mocks.acceptInvitation,
  revokeInvitation: mocks.revokeInvitation,
}));

import organisationRoutes from '../../server/routes/organisation.routes';

const app = express();
app.use(express.json());
app.use(organisationRoutes);

function authHeader(orgId = 'org-1') {
  return `Bearer ${
    createTokenPair({
      id: 'admin-1',
      organisationId: orgId,
      bankidId: 'admin:one',
      role: 'ADMIN',
    }).accessToken
  }`;
}

describe('organisation.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createInvitation.mockResolvedValue({
      id: 'invite-1',
      email: 'test@example.com',
      role: 'CONSULTANT',
    });
    mocks.listInvitations.mockReturnValue([{ id: 'invite-1' }]);
    mocks.acceptInvitation.mockResolvedValue({
      userId: 'user-1',
      orgId: 'org-1',
      role: 'CONSULTANT',
    });
    mocks.revokeInvitation.mockResolvedValue(undefined);
  });

  it('guards organisation invitation access by organisation and required fields', async () => {
    const forbidden = await request(app)
      .post('/api/orgs/org-2/invitations')
      .set('Authorization', authHeader('org-1'))
      .send({ email: 'test@example.com', role: 'CONSULTANT' });

    expect(forbidden.status).toBe(403);

    const invalid = await request(app)
      .post('/api/orgs/org-1/invitations')
      .set('Authorization', authHeader('org-1'))
      .send({ email: 'test@example.com' });

    expect(invalid.status).toBe(400);
  });

  it('creates and lists invitations for the authenticated organisation', async () => {
    const create = await request(app)
      .post('/api/orgs/org-1/invitations')
      .set('Authorization', authHeader('org-1'))
      .send({ email: 'test@example.com', role: 'CONSULTANT' });

    expect(create.status).toBe(200);
    expect(mocks.createInvitation).toHaveBeenCalledWith({
      orgId: 'org-1',
      email: 'test@example.com',
      role: 'CONSULTANT',
      actingUserId: 'admin-1',
    });

    const list = await request(app)
      .get('/api/orgs/org-1/invitations')
      .set('Authorization', authHeader('org-1'));

    expect(list.status).toBe(200);
    expect(list.body).toEqual({ ok: true, invitations: [{ id: 'invite-1' }] });
  });

  it('validates invitation acceptance payloads and allows successful accept flows', async () => {
    const invalid = await request(app)
      .post('/api/orgs/org-1/invitations/accept')
      .send({ token: 'invite-token' });

    expect(invalid.status).toBe(400);

    const accepted = await request(app)
      .post('/api/orgs/org-1/invitations/accept')
      .send({ token: 'invite-token', bankidId: '191212121212' });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({
      ok: true,
      userId: 'user-1',
      orgId: 'org-1',
      role: 'CONSULTANT',
    });
  });

  it('revokes invitations for the authenticated organisation', async () => {
    const res = await request(app)
      .delete('/api/orgs/org-1/invitations/invite-1')
      .set('Authorization', authHeader('org-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.revokeInvitation).toHaveBeenCalledWith({
      orgId: 'org-1',
      inviteId: 'invite-1',
      actingUserId: 'admin-1',
    });
  });
});
