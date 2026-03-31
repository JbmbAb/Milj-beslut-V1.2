import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  submitPermitToAuthority: vi.fn(),
  getSubmission: vi.fn(),
  signDocumentEidas: vi.fn(),
  autoFetchLimsReports: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/permitAuthorityService', () => ({
  submitPermitToAuthority: mocks.submitPermitToAuthority,
  getSubmission: mocks.getSubmission,
}));

vi.mock('../../server/services/eidasSignatureService', () => ({
  signDocumentEidas: mocks.signDocumentEidas,
}));

vi.mock('../../server/services/limsAutoFetchService', () => ({
  autoFetchLimsReports: mocks.autoFetchLimsReports,
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertPermission: mocks.assertPermission,
}));

import complianceRoutes from '../../server/routes/compliance.routes';

const app = express();
app.use(express.json());
app.use(complianceRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'user:one',
      role: 'ADMIN',
    }).accessToken
  }`;
}

describe('compliance.routes – permit authority submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPermission.mockResolvedValue(undefined);
    mocks.submitPermitToAuthority.mockResolvedValue({
      referenceId: 'ref-1',
      status: 'submitted',
    });
    mocks.getSubmission.mockReturnValue({ referenceId: 'ref-1', status: 'submitted' });
    mocks.signDocumentEidas.mockResolvedValue({ signatureId: 'sig-1', level: 'ADVANCED' });
    mocks.autoFetchLimsReports.mockResolvedValue({ fetched: 3, skipped: 0 });
  });

  it('returns 401 without auth on authority submit', async () => {
    const res = await request(app).post('/api/projects/proj-1/permit/authority-submit').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/permit/authority-submit')
      .set('Authorization', authHeader())
      .send({ permitType: 'miljötillstånd' }); // missing applicantName and propertyDesignation
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('submits a permit and returns the submission', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/permit/authority-submit')
      .set('Authorization', authHeader())
      .send({
        permitType: 'miljötillstånd',
        applicantName: 'Bolaget AB',
        propertyDesignation: 'Fastighet 1:1',
        documentIds: ['doc-1'],
        authorityName: 'Länsstyrelsen',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.submission.referenceId).toBe('ref-1');
    expect(mocks.submitPermitToAuthority).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        permitType: 'miljötillstånd',
        applicantName: 'Bolaget AB',
      }),
    );
  });

  it('defaults documentIds to empty array when not provided', async () => {
    await request(app)
      .post('/api/projects/proj-1/permit/authority-submit')
      .set('Authorization', authHeader())
      .send({
        permitType: 'vattenverksamhet',
        applicantName: 'Test AB',
        propertyDesignation: 'Mark 2:2',
      });

    expect(mocks.submitPermitToAuthority).toHaveBeenCalledWith(expect.objectContaining({ documentIds: [] }));
  });

  it('returns 400 on service failure in submit', async () => {
    mocks.submitPermitToAuthority.mockRejectedValueOnce(new Error('authority unavailable'));
    const res = await request(app)
      .post('/api/projects/proj-1/permit/authority-submit')
      .set('Authorization', authHeader())
      .send({
        permitType: 'X',
        applicantName: 'Y',
        propertyDesignation: 'Z',
      });
    expect(res.status).toBe(400);
  });
});

describe('compliance.routes – get submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSubmission.mockReturnValue({ referenceId: 'ref-1', status: 'submitted' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/projects/proj-1/permit/submissions/ref-1');
    expect(res.status).toBe(401);
  });

  it('returns the submission by referenceId', async () => {
    const res = await request(app)
      .get('/api/projects/proj-1/permit/submissions/ref-1')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.submission.referenceId).toBe('ref-1');
  });

  it('returns 404 when submission not found', async () => {
    mocks.getSubmission.mockReturnValueOnce(undefined);
    const res = await request(app)
      .get('/api/projects/proj-1/permit/submissions/unknown-ref')
      .set('Authorization', authHeader());
    expect(res.status).toBe(404);
  });
});

describe('compliance.routes – eIDAS signature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signDocumentEidas.mockResolvedValue({ signatureId: 'sig-1', level: 'ADVANCED' });
  });

  it('returns 401 without auth on sign', async () => {
    const res = await request(app).post('/api/documents/doc-1/sign/eidas').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 when signerPersonalNumber is missing', async () => {
    const res = await request(app)
      .post('/api/documents/doc-1/sign/eidas')
      .set('Authorization', authHeader())
      .send({ signerName: 'Anna Svensson' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when signerName is missing', async () => {
    const res = await request(app)
      .post('/api/documents/doc-1/sign/eidas')
      .set('Authorization', authHeader())
      .send({ signerPersonalNumber: '199001011234' });
    expect(res.status).toBe(400);
  });

  it('signs a document successfully', async () => {
    const res = await request(app)
      .post('/api/documents/doc-1/sign/eidas')
      .set('Authorization', authHeader())
      .send({
        signerPersonalNumber: '199001011234',
        signerName: 'Anna Svensson',
        signatureText: 'Jag godkänner',
        format: 'PAdES',
        level: 'ADVANCED',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.signature.signatureId).toBe('sig-1');
    expect(mocks.signDocumentEidas).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        signerPersonalNumber: '199001011234',
        signerName: 'Anna Svensson',
      }),
      'user-1',
    );
  });

  it('returns 400 on signing service failure', async () => {
    mocks.signDocumentEidas.mockRejectedValueOnce(new Error('signing failed'));
    const res = await request(app)
      .post('/api/documents/doc-1/sign/eidas')
      .set('Authorization', authHeader())
      .send({ signerPersonalNumber: '199001011234', signerName: 'Test' });
    expect(res.status).toBe(400);
  });
});

describe('compliance.routes – LIMS auto-fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPermission.mockResolvedValue(undefined);
    mocks.autoFetchLimsReports.mockResolvedValue({ fetched: 2, skipped: 1 });
  });

  it('returns 401 without auth on LIMS auto-fetch', async () => {
    const res = await request(app).post('/api/projects/proj-1/lims/auto-fetch').send({});
    expect(res.status).toBe(401);
  });

  it('triggers LIMS auto-fetch and returns result', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/lims/auto-fetch')
      .set('Authorization', authHeader())
      .send({ since: '2024-01-01T00:00:00Z' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.fetched).toBe(2);
    expect(mocks.autoFetchLimsReports).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', since: '2024-01-01T00:00:00Z' }),
    );
  });

  it('works without since parameter', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/lims/auto-fetch')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(200);
    expect(mocks.autoFetchLimsReports).toHaveBeenCalledWith(expect.objectContaining({ since: undefined }));
  });

  it('returns 400 when assertPermission fails', async () => {
    mocks.assertPermission.mockRejectedValueOnce(new Error('no access'));
    const res = await request(app)
      .post('/api/projects/proj-1/lims/auto-fetch')
      .set('Authorization', authHeader())
      .send({});
    expect(res.status).toBe(400);
  });
});
