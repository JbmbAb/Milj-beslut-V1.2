import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import coreRouter from '../../server/coreApi.express';
import { getUserFromAccessToken } from '../../server/security/auth';
import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';

vi.mock('../../server/security/auth', () => ({
  getUserFromAccessToken: vi.fn(),
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use(coreRouter);

describe('Core API - Error Handling Paths', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.clearAllMocks();
  });

  it('döljer feldetaljer (details) när NODE_ENV är production', async () => {
    process.env.NODE_ENV = 'production';

    // Simulera giltig inloggning så att vi når valideringslagret
    vi.mocked(getUserFromAccessToken).mockResolvedValueOnce({
      id: 'user1',
      role: 'ADMIN',
      organisationId: 'org1',
      bankidId: 'bankid1',
    });

    // Skicka ogiltig data för att tvinga fram ett 400 VALIDATION_ERROR
    const res = await request(app)
      .post('/api/v1/compliance/risk-analysis')
      .set('Authorization', 'Bearer valid-token-123')
      .send({ invalid: 'data' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeUndefined(); // Details MÅSTE vara dolt i prod
  });

  it('returnerar 401 AUTH_MISSING när token saknas', async () => {
    const res = await request(app).get('/api/v1/projects');

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('AUTH_MISSING');
  });

  it('returnerar 401 AUTH_INVALID när token är felaktig eller utgången', async () => {
    // Simulera att auth-modulen avvisar token
    vi.mocked(getUserFromAccessToken).mockRejectedValueOnce(new Error('Invalid token'));

    const res = await request(app).get('/api/v1/projects').set('Authorization', 'Bearer bad-token-123');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID');
  });

  it('returnerar 403 PROJECT_ACCESS_DENIED vid obehörig sökning i annat projekt (Dataisolering)', async () => {
    // 1. Autentisera som en giltig konsult
    vi.mocked(getUserFromAccessToken).mockResolvedValueOnce({
      id: 'consultant1',
      role: 'CONSULTANT',
      organisationId: 'org1',
      bankidId: 'bankid1',
    });

    // 2. Simulera att systemet upptäcker att användaren INTE är inbjuden till projektet
    vi.mocked(assertProjectMembership).mockRejectedValueOnce(new Error('Not a member'));

    // 3. Utför RAG-sökning mot ett projekt som tillhör någon annan
    const res = await request(app)
      .get('/api/v1/projects/foreign-project-123/search?q=vatten')
      .set('Authorization', 'Bearer valid-token-123');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROJECT_ACCESS_DENIED');
  });
});
