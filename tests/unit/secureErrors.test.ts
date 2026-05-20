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

  it('SecureError defaults to 500 and "Internal server error" when not specified', () => {
    const err = new SecureError('internal detail');
    expect(err.statusCode).toBe(500);
    expect(err.publicMessage).toBe('Internal server error');
    expect(err.name).toBe('SecureError');
  });

  it('maps "unauthorized" keyword to Access denied', () => {
    expect(toSafeErrorResponse(new Error('unauthorized access'))).toEqual({
      ok: false,
      error: 'Access denied',
    });
  });
});
