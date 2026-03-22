import { describe, expect, it, vi } from 'vitest';
import { SecureError, secureErrorHandler, toSafeErrorResponse } from '../../server/security/secureErrors';

describe('secureErrors', () => {
  it('maps secure errors to public payloads', () => {
    const response = toSafeErrorResponse(
      new SecureError('Database exploded', 'Temporarily unavailable', 503),
    );

    expect(response).toEqual({
      ok: false,
      error: 'Temporarily unavailable',
      code: '503',
    });
  });

  it('maps known native error messages to safe responses', () => {
    expect(toSafeErrorResponse(new Error('resource not found'))).toEqual({
      ok: false,
      error: 'Resource not found',
    });
    expect(toSafeErrorResponse(new Error('permission denied'))).toEqual({
      ok: false,
      error: 'Access denied',
    });
    expect(toSafeErrorResponse(new Error('invalid token supplied'))).toEqual({
      ok: false,
      error: 'Authentication failed',
    });
    expect(toSafeErrorResponse(new Error('session expired'))).toEqual({
      ok: false,
      error: 'Session expired',
    });
    expect(toSafeErrorResponse(new Error('refresh token reuse detected'))).toEqual({
      ok: false,
      error: 'Session security check failed - please login again',
    });
  });

  it('falls back to generic and unknown messages when needed', () => {
    expect(toSafeErrorResponse(new Error('boom'))).toEqual({
      ok: false,
      error: 'An error occurred processing your request',
    });
    expect(toSafeErrorResponse('plain-string-error')).toEqual({
      ok: false,
      error: 'Unknown error',
    });
  });

  it('writes safe responses through express middleware', () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json };

    secureErrorHandler(new SecureError('secret', 'Nope', 418), {} as never, res as never, vi.fn());
    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      error: 'Nope',
      code: '418',
    });

    status.mockClear();
    json.mockClear();

    secureErrorHandler(new Error('other'), {} as never, res as never, vi.fn());
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      error: 'An error occurred processing your request',
    });
  });
});
