import { describe, expect, it, vi } from 'vitest';
import type { ActionFunctionArgs } from '@remix-run/node';
import { action, loader } from '../../legacy/remix-poc/routes/api/gemini';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

function asActionArgs(request: Request): ActionFunctionArgs {
  return { request, params: {}, context: {} as never };
}

describe('app/routes/api/gemini', () => {
  it('loader returns a POST usage message', async () => {
    const response = await loader();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: 'Use POST to call methods.',
    });
  });

  it('action requires auth for non-anonymous methods', async () => {
    const request = new Request('http://localhost/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'analyzePermitRisk',
        payload: { permit: {} },
      }),
    });

    const response = await action(asActionArgs(request));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unauthorized',
    });
  });

  it('action returns error payload for unknown methods with valid auth', async () => {
    const accessToken = createTokenPair({
      id: 'unit-user',
      organisationId: 'unit-org',
      bankidId: 'unit:bankid',
      role: 'ADMIN',
    }).accessToken;

    const request = new Request('http://localhost/api/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        method: 'unknownMethod',
        payload: {},
      }),
    });

    const response = await action(asActionArgs(request));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { ok?: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(String(json.error || '')).toMatch(/Unknown method/i);
  });
});
