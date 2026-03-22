/**
 * errorTrackingService.test.ts
 *
 * Direkta enhetstester för errorTrackingService.
 * Tjänsten använder in-memory ring-buffer — inga DB-beroenden.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  captureException,
  captureMessage,
  getRecentErrors,
} from '../../server/services/errorTrackingService';

// Mocka logger för att undvika brus i test-output
vi.mock('../../server/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Se till att ingen SENTRY_DSN är konfigurerad under tester
beforeEach(() => {
  delete process.env.SENTRY_DSN;
});

describe('captureException()', () => {
  it('returns a UUID string', async () => {
    const id = await captureException(new Error('test error'));
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('captures an Error object', async () => {
    const err = new Error('något gick fel');
    const id = await captureException(err);
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured).toBeDefined();
    expect(captured?.message).toBe('något gick fel');
    expect(captured?.type).toBe('exception');
  });

  it('captures a non-Error value (string)', async () => {
    const id = await captureException('just a string error');
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured).toBeDefined();
    expect(captured?.message).toBe('just a string error');
  });

  it('uses default severity "error"', async () => {
    const id = await captureException(new Error('default sev'));
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.severity).toBe('error');
  });

  it('respects custom severity in context', async () => {
    const id = await captureException(new Error('fatal error'), { severity: 'fatal' });
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.severity).toBe('fatal');
  });

  it('stores userId when provided', async () => {
    const id = await captureException(new Error('user error'), { userId: 'user-123' });
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.userId).toBe('user-123');
  });

  it('stores url when provided', async () => {
    const id = await captureException(new Error('url error'), { url: '/api/test' });
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.url).toBe('/api/test');
  });

  it('stores extra context when provided', async () => {
    const id = await captureException(new Error('ctx error'), {
      extra: { requestId: 'abc123', detail: 'extra info' },
    });
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.context?.requestId).toBe('abc123');
  });

  it('sets sentToSentry to false when no SENTRY_DSN', async () => {
    const id = await captureException(new Error('no sentry'));
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.sentToSentry).toBe(false);
  });

  it('sets capturedAt to a valid ISO timestamp', async () => {
    const before = Date.now();
    const id = await captureException(new Error('time test'));
    const after = Date.now();
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.capturedAt).toBeDefined();
    const ts = new Date(captured!.capturedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100); // Small tolerance
  });
});

describe('captureMessage()', () => {
  it('returns a UUID string', async () => {
    const id = await captureMessage('test message');
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('captures message with type="message"', async () => {
    const id = await captureMessage('hello message');
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.type).toBe('message');
    expect(captured?.message).toBe('hello message');
  });

  it('uses default severity "info"', async () => {
    const id = await captureMessage('info message');
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.severity).toBe('info');
  });

  it('respects custom severity', async () => {
    const id = await captureMessage('warning message', 'warning');
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.severity).toBe('warning');
  });

  it('stores context when provided', async () => {
    const id = await captureMessage('ctx msg', 'info', { key: 'value' });
    const recent = getRecentErrors({ limit: 10 });
    const captured = recent.find((e) => e.id === id);
    expect(captured?.context?.key).toBe('value');
  });
});

describe('getRecentErrors()', () => {
  it('returns an array', () => {
    const result = getRecentErrors({});
    expect(Array.isArray(result)).toBe(true);
  });

  it('limits results by limit parameter', async () => {
    // Add several errors
    await captureMessage('limit test 1');
    await captureMessage('limit test 2');
    await captureMessage('limit test 3');
    const result = getRecentErrors({ limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('returns newest first (reverse chronological order)', async () => {
    const id1 = await captureMessage('oldest');
    await new Promise((r) => setTimeout(r, 5));
    const id2 = await captureMessage('newest');
    const result = getRecentErrors({ limit: 100 });
    const idx1 = result.findIndex((e) => e.id === id1);
    const idx2 = result.findIndex((e) => e.id === id2);
    // newest (id2) should come before oldest (id1)
    expect(idx2).toBeLessThan(idx1);
  });

  it('filters by severity when provided', async () => {
    await captureException(new Error('fatal one'), { severity: 'fatal' });
    await captureMessage('info one', 'info');
    const fatals = getRecentErrors({ severity: 'fatal' });
    for (const e of fatals) {
      expect(e.severity).toBe('fatal');
    }
  });

  it('uses default limit of 50 when not specified', async () => {
    // The function should work without limit
    const result = getRecentErrors({});
    expect(result.length).toBeLessThanOrEqual(50);
  });
});
