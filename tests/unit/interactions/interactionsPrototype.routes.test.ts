import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../../server/security/auth';

vi.mock('../../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../../server/modules/ai/interactions/interactionsOrchestrator', () => ({
  runInteractionPrototypeTurn: vi.fn(),
}));

import interactionsPrototypeRoutes from '../../../server/modules/ai/interactions/interactionsPrototype.routes';
import { runInteractionPrototypeTurn } from '../../../server/modules/ai/interactions/interactionsOrchestrator';

const app = express();
app.use(express.json());
app.use(interactionsPrototypeRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'bankid-user-1',
      role: 'ADMIN',
    }).accessToken
  }`;
}

describe('interactionsPrototype.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERACTIONS_PROTOTYPE_ENABLED = 'true';
    process.env.INTERACTIONS_GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.INTERACTIONS_PROTOTYPE_ENABLED;
    delete process.env.INTERACTIONS_GEMINI_API_KEY;
  });

  it('returns 404 when prototype flag is disabled', async () => {
    delete process.env.INTERACTIONS_PROTOTYPE_ENABLED;

    const res = await request(app)
      .post('/api/prototype/interactions')
      .set('Authorization', authHeader())
      .send({ prompt: 'hello' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/prototype/interactions').send({ prompt: 'hello' });
    expect(res.status).toBe(401);
  });

  it('returns model output and session id', async () => {
    vi.mocked(runInteractionPrototypeTurn).mockResolvedValue({
      ok: true,
      sessionId: 'sess-1',
      interactionId: 'int-1',
      outputText: 'Environment Investigator',
      status: 'completed',
      meta: { model: 'gemini-3.5-flash', stepCount: 2 },
    });

    const res = await request(app)
      .post('/api/prototype/interactions')
      .set('Authorization', authHeader())
      .send({ prompt: 'What is my name?', sessionId: 'sess-1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sessionId).toBe('sess-1');
    expect(res.body.outputText).toBe('Environment Investigator');
    expect(runInteractionPrototypeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'What is my name?',
        sessionId: 'sess-1',
      }),
    );
  });

  it('returns orchestrator validation errors', async () => {
    vi.mocked(runInteractionPrototypeTurn).mockResolvedValue({
      ok: false,
      status: 400,
      error: 'prompt is required',
    });

    const res = await request(app)
      .post('/api/prototype/interactions')
      .set('Authorization', authHeader())
      .send({ prompt: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('prompt is required');
  });
});
