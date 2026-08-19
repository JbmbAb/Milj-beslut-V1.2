// tests/unit/governanceRoutes.test.ts
//
// Regression coverage for server/routes/governance.routes.ts's promote/reject
// containment (see docs/architecture/GAP-REPORT-harvest-governance-2026-08-10.md,
// "URGENT ADDENDUM" and "SPEC TIGHTENED").
//
// Before the 2026-08-10 fix: POST /api/governance/quarantine/:id/promote had no auth
// and read `approvedBy` from the request body, so any caller could promote any
// quarantined item to permanent CAS storage while asserting any name as the approver.
// Before the 2026-08-11 Level 2 fix: the "approval" passed to QuarantinePromoter.promote()
// was a bare string, not a verified cryptographic artifact.
//
// These tests prove: (1) unauthenticated calls are rejected, (2) non-ADMIN authenticated
// calls are rejected, (3) an authenticated ADMIN call succeeds AND the route builds the
// promotion attestation predicate server-side — bound to the authenticated principal's id
// and role, never to client-supplied body values — and passes the signed attestation
// object (not a string) to QuarantinePromoter.promote().

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  promote: vi.fn(),
  updateStatus: vi.fn(),
  list: vi.fn(),
  getBytes: vi.fn(),
  getMetadata: vi.fn(),
  initHasher: vi.fn(),
  initialize: vi.fn(),
  createArtifactAttestation: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/security/governanceSigningKey', () => ({
  getGovernanceSigningProvider: () => ({
    keyId: 'ed25519:test-governance-key',
    sign: vi.fn(),
    verify: vi.fn(),
  }),
}));

// Route module constructs its collaborators at import time (including two
// top-level `await`s), so they're mocked at the package/module boundary
// rather than injected — there is no seam to swap them in per-test otherwise.
vi.mock('@miljobeslut/mimers-brunn-core', () => ({
  FileCASRepository: class {
    initialize = mocks.initialize.mockResolvedValue(undefined);
    getBytes = mocks.getBytes;
  },
  DiskQuarantineStorage: class {
    list = mocks.list.mockResolvedValue([]);
    updateStatus = mocks.updateStatus.mockResolvedValue(undefined);
    get = vi.fn();
    getMetadata = mocks.getMetadata;
  },
  QuarantinePromoter: class {
    promote = mocks.promote;
  },
  createArtifactAttestation: mocks.createArtifactAttestation,
  PROMOTION_ACTION: 'quarantine.promote',
  PROMOTION_ATTESTATION_PREDICATE_TYPE: 'mimers-brunn/quarantine-promotion/v1',
  PROMOTION_ATTESTATION_SCHEMA_VERSION: 1,
}));

vi.mock('../../packages/mps-canonical/src/CanonicalPipeline.js', () => ({
  DefaultCanonicalPipeline: class {
    initHasher = mocks.initHasher.mockResolvedValue(undefined);
    hashCanonical = vi.fn().mockReturnValue({ digest: 'fake-digest' });
  },
}));

const { governanceRouter } = await import('../../server/routes/governance.routes');

const app = express();
app.use(express.json());
app.use('/api/governance', governanceRouter);

function authHeader(role: 'ADMIN' | 'CONSULTANT', id: string) {
  return `Bearer ${
    createTokenPair({ id, organisationId: 'org-1', bankidId: `${role.toLowerCase()}:${id}`, role }).accessToken
  }`;
}

const FAKE_ATTESTATION = { subjectDigest: 'sha256:fake-attestation', signature: 'fake-signature' };

describe('governance.routes — promote/reject containment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promote.mockResolvedValue({
      approval_hash: 'sha256:fake',
      content_hash: 'sha256:fake',
      is_duplicate: false,
      artifact: {},
    });
    mocks.getMetadata.mockResolvedValue({
      quarantine_id: 'item-1',
      source_id: 'source-1',
      content_hash: 'deadbeef',
      status: 'quarantined',
    });
    mocks.createArtifactAttestation.mockResolvedValue(FAKE_ATTESTATION);
    mocks.getBytes.mockResolvedValue(Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8'));
  });

  it('rejects an unauthenticated promote request (401)', async () => {
    const res = await request(app)
      .post('/api/governance/quarantine/item-1/promote')
      .send({ approvedBy: 'attacker', governanceRelease: 'v1' });

    expect(res.status).toBe(401);
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-ADMIN promote request (403)', async () => {
    const res = await request(app)
      .post('/api/governance/quarantine/item-1/promote')
      .set('Authorization', authHeader('CONSULTANT', 'consultant-1'))
      .send({ approvedBy: 'attacker', governanceRelease: 'v1' });

    expect(res.status).toBe(403);
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('allows an ADMIN promote request, using the authenticated id as approver — not the request body', async () => {
    const res = await request(app)
      .post('/api/governance/quarantine/item-1/promote')
      .set('Authorization', authHeader('ADMIN', 'admin-1'))
      .send({ approvedBy: 'someone-the-client-made-up', governanceRelease: 'v1' });

    expect(res.status).toBe(200);

    // The route builds the signed predicate server-side, bound to the authenticated
    // principal — never to the client-supplied `approvedBy` body value.
    expect(mocks.createArtifactAttestation).toHaveBeenCalledTimes(1);
    const attestationArgs = mocks.createArtifactAttestation.mock.calls[0][0];
    expect(attestationArgs.predicate).toMatchObject({
      action: 'quarantine.promote',
      quarantine_artifact_id: 'item-1',
      quarantine_content_hash: 'deadbeef',
      approver_actor_id: 'admin-1',
      approver_role: 'ADMIN',
      governance_release: 'v1',
      attestation_schema_version: 1,
      signer_key_id: 'ed25519:test-governance-key',
    });
    expect(attestationArgs.predicate.approver_actor_id).not.toBe('someone-the-client-made-up');

    // promoter.promote() receives the signed attestation object, not a bare string.
    expect(mocks.promote).toHaveBeenCalledTimes(1);
    expect(mocks.promote).toHaveBeenCalledWith('item-1', FAKE_ATTESTATION, 'v1');
  });

  it('returns 404 when the quarantine artifact does not exist, without attempting to sign or promote', async () => {
    mocks.getMetadata.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/governance/quarantine/missing-item/promote')
      .set('Authorization', authHeader('ADMIN', 'admin-1'))
      .send({ governanceRelease: 'v1' });

    expect(res.status).toBe(404);
    expect(mocks.createArtifactAttestation).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated reject request (401)', async () => {
    const res = await request(app).post('/api/governance/quarantine/item-1/reject').send({ errors: [] });

    expect(res.status).toBe(401);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-ADMIN reject request (403)', async () => {
    const res = await request(app)
      .post('/api/governance/quarantine/item-1/reject')
      .set('Authorization', authHeader('CONSULTANT', 'consultant-1'))
      .send({ errors: [] });

    expect(res.status).toBe(403);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('allows an ADMIN reject request', async () => {
    const res = await request(app)
      .post('/api/governance/quarantine/item-1/reject')
      .set('Authorization', authHeader('ADMIN', 'admin-1'))
      .send({ errors: ['bad checksum'] });

    expect(res.status).toBe(200);
    expect(mocks.updateStatus).toHaveBeenCalledWith('item-1', 'rejected', ['bad checksum']);
  });

  it('rejects unauthenticated governance session/read routes before exposing runtime state', async () => {
    const cases: Array<['get' | 'post', string, unknown?]> = [
      ['post', '/api/governance/session/start', { capability: { artifact_id: 'cap-1' } }],
      ['get', '/api/governance/quarantine/candidates'],
      ['get', '/api/governance/stats'],
      ['get', '/api/governance/cas/artifact/sha256:abc'],
    ];

    for (const [method, url, body] of cases) {
      const res = method === 'get'
        ? await request(app).get(url)
        : await request(app).post(url).send(body);
      expect(res.status).toBe(401);
    }

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.getBytes).not.toHaveBeenCalled();
  });

  it('rejects authenticated non-ADMIN governance session/read routes', async () => {
    const res = await request(app)
      .get('/api/governance/quarantine/candidates')
      .set('Authorization', authHeader('CONSULTANT', 'consultant-1'));

    expect(res.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('allows ADMIN access to sensitive governance reads', async () => {
    const candidates = await request(app)
      .get('/api/governance/quarantine/candidates')
      .set('Authorization', authHeader('ADMIN', 'admin-1'));
    const stats = await request(app)
      .get('/api/governance/stats')
      .set('Authorization', authHeader('ADMIN', 'admin-1'));
    const artifact = await request(app)
      .get('/api/governance/cas/artifact/sha256:abc')
      .set('Authorization', authHeader('ADMIN', 'admin-1'));

    expect(candidates.status).toBe(200);
    expect(stats.status).toBe(200);
    expect(artifact.status).toBe(200);
    expect(mocks.list).toHaveBeenCalled();
    expect(mocks.getBytes).toHaveBeenCalledWith('sha256:abc');
  });
});
