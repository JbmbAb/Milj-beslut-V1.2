import { describe, expect, it, vi } from 'vitest';
import {
  SecureError,
  toSafeErrorResponse,
  secureErrorHandler,
} from '../../server/security/secureErrors';

describe('SecureError', () => {
  it('creates error with custom public message and status code', () => {
    const err = new SecureError('DB connection failed', 'Service unavailable', 503);
    expect(err.message).toBe('DB connection failed');
    expect(err.publicMessage).toBe('Service unavailable');
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe('SecureError');
  });

  it('defaults to generic message and 500 status', () => {
    const err = new SecureError('some internal detail');
    expect(err.publicMessage).toBe('Internal server error');
    expect(err.statusCode).toBe(500);
  });
});

describe('toSafeErrorResponse', () => {
  it('returns public message for SecureError', () => {
    const err = new SecureError('private', 'Service unavailable', 503);
    const result = toSafeErrorResponse(err);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Service unavailable');
    expect(result.code).toBe('503');
    // Internal message must NOT leak
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('maps "not found" errors to safe message', () => {
    const result = toSafeErrorResponse(new Error('record not found in database'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Resource not found');
  });

  it('maps "unauthorized"/"permission" errors to access denied', () => {
    expect(toSafeErrorResponse(new Error('unauthorized operation')).error).toBe('Access denied');
    expect(toSafeErrorResponse(new Error('insufficient permission')).error).toBe('Access denied');
  });

  it('maps "invalid token" errors to authentication failed', () => {
    const result = toSafeErrorResponse(new Error('invalid access token supplied'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Authentication failed');
  });

  it('maps "expired" errors to session expired', () => {
    const result = toSafeErrorResponse(new Error('Token expired'));
    expect(result.error).toBe('Session expired');
  });

  it('maps "reuse" errors to security check failed', () => {
    const result = toSafeErrorResponse(new Error('Refresh token reuse detected'));
    expect(result.error).toBe('Session security check failed - please login again');
  });

  it('returns generic message for unknown Error subclasses', () => {
    const result = toSafeErrorResponse(new TypeError('some unexpected issue'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('An error occurred processing your request');
    // Stack trace must NOT leak
    expect(JSON.stringify(result)).not.toContain('TypeError');
  });

  it('handles non-Error thrown values', () => {
    expect(toSafeErrorResponse('a plain string').error).toBe('Unknown error');
    expect(toSafeErrorResponse(null).error).toBe('Unknown error');
    expect(toSafeErrorResponse(42).error).toBe('Unknown error');
  });
});

describe('secureErrorHandler', () => {
  it('uses 500 for generic Error and returns safe body', () => {
    const res = { statusCode: 0, status: vi.fn().mockReturnThis(), json: vi.fn() };
    secureErrorHandler(new Error('boom'), {}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0] as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('uses statusCode from SecureError', () => {
    const err = new SecureError('db error', 'Unavailable', 503);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    secureErrorHandler(err, {}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0] as { error: string };
    expect(body.error).toBe('Unavailable');
  });
});
