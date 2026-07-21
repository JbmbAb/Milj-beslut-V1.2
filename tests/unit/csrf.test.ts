import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, default: actual };
});

import { csrfProtection } from '../../server/security/csrf';

const CSRF_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-csrf-token' : 'csrf-token';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    cookies: {},
    path: '/',
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _locals: Record<string, unknown> } {
  const locals: Record<string, unknown> = {};
  const cookieStore: Record<string, string> = {};

  const res = {
    locals,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockImplementation((name: string, val: string) => {
      cookieStore[name] = val;
      locals[name] = val;
    }),
    _cookies: cookieStore,
    _locals: locals,
  } as unknown as Response & { _locals: Record<string, unknown> };

  return res;
}

describe('csrfProtection', () => {
  it('sÃ¤tter en ny CSRF-cookie om ingen finns (GET)', () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('slipper igenom GET-anrop utan att validera header', () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('slipper igenom HEAD-anrop', () => {
    const req = makeReq({ method: 'HEAD' });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blockerar POST utan CSRF-header med 403', () => {
    const token = 'abc123';
    const req = makeReq({
      method: 'POST',
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: {},
    });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(next).not.toHaveBeenCalled();
  });

  it('blockerar POST med fel CSRF-header', () => {
    const token = 'correct-token';
    const req = makeReq({
      method: 'POST',
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { 'x-csrf-token': 'wrong-token' },
    });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('slipper igenom POST med korrekt CSRF-token', () => {
    const token = 'valid-token-xyz';
    const req = makeReq({
      method: 'POST',
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { 'x-csrf-token': token },
    });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lÃ¤ser token frÃ¥n cookie-header om cookies saknas', () => {
    const token = 'from-raw-cookie';
    const req = makeReq({
      method: 'PUT',
      cookies: undefined,
      headers: {
        cookie: `${CSRF_COOKIE_NAME}=${token}; other=val`,
        'x-csrf-token': token,
      },
    });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });

  it('sÃ¤tter res.locals.csrfToken fÃ¶r anvÃ¤ndning i templates', () => {
    const token = 'some-csrf-token';
    const req = makeReq({
      method: 'GET',
      cookies: { [CSRF_COOKIE_NAME]: token },
    });
    const res = makeRes();
    const next = vi.fn();

    csrfProtection(req, res, next as NextFunction);

    expect(res.locals.csrfToken).toBe(token);
  });
});
