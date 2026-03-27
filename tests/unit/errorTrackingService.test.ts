import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Sentry not installed in test env – dynamic import will fail gracefully
// (no additional mock needed)

// ─── Module under test (module-level state: _errors ring buffer + _sentryInitialized)

let svc: typeof import('../../server/services/errorTrackingService');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.SENTRY_DSN;
  svc = await import('../../server/services/errorTrackingService');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('errorTrackingService', () => {
  // ── captureException ──────────────────────────────────────────────────────

  describe('captureException', () => {
    it('returns a non-empty UUID string', async () => {
      const id = await svc.captureException(new Error('test error'));
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('captured error appears in getRecentErrors', async () => {
      await svc.captureException(new Error('visible error'));

      const errors = svc.getRecentErrors({ limit: 10 });
      expect(errors.some((e) => e.message === 'visible error')).toBe(true);
    });

    it('sets type to exception', async () => {
      await svc.captureException(new Error('exc type test'));

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].type).toBe('exception');
    });

    it('uses default severity "error" when not specified', async () => {
      await svc.captureException(new Error('default sev'));

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].severity).toBe('error');
    });

    it('respects custom severity', async () => {
      await svc.captureException(new Error('fatal err'), { severity: 'fatal' });

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].severity).toBe('fatal');
    });

    it('stores userId and url from context', async () => {
      await svc.captureException(new Error('ctx err'), { userId: 'u-123', url: '/api/test' });

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].userId).toBe('u-123');
      expect(errors[0].url).toBe('/api/test');
    });

    it('handles non-Error objects', async () => {
      const id = await svc.captureException('just a string error');
      expect(typeof id).toBe('string');
    });

    it('sentToSentry is false when no SENTRY_DSN is configured', async () => {
      await svc.captureException(new Error('no sentry'));

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].sentToSentry).toBe(false);
    });
  });

  // ── captureMessage ────────────────────────────────────────────────────────

  describe('captureMessage', () => {
    it('returns a UUID string', async () => {
      const id = await svc.captureMessage('info message');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('captured message appears in getRecentErrors', async () => {
      await svc.captureMessage('captured msg', 'warning');

      const errors = svc.getRecentErrors({ limit: 10 });
      expect(errors.some((e) => e.message === 'captured msg')).toBe(true);
    });

    it('sets type to message', async () => {
      await svc.captureMessage('msg type test', 'info');

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].type).toBe('message');
    });

    it('uses default severity "info" when not specified', async () => {
      await svc.captureMessage('default info msg');

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].severity).toBe('info');
    });

    it('stores context object', async () => {
      await svc.captureMessage('with ctx', 'warning', { extra: 'data' });

      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].context).toEqual({ extra: 'data' });
    });
  });

  // ── getRecentErrors ───────────────────────────────────────────────────────

  describe('getRecentErrors', () => {
    it('returns empty array when no errors captured', () => {
      const errors = svc.getRecentErrors({});
      expect(errors).toEqual([]);
    });

    it('returns newest errors first', async () => {
      await svc.captureMessage('first', 'info');
      await svc.captureMessage('second', 'info');
      await svc.captureMessage('third', 'info');

      const errors = svc.getRecentErrors({ limit: 3 });
      expect(errors[0].message).toBe('third');
      expect(errors[2].message).toBe('first');
    });

    it('respects the limit parameter', async () => {
      await svc.captureMessage('msg-1', 'info');
      await svc.captureMessage('msg-2', 'info');
      await svc.captureMessage('msg-3', 'info');

      const errors = svc.getRecentErrors({ limit: 2 });
      expect(errors.length).toBe(2);
    });

    it('filters by severity', async () => {
      await svc.captureException(new Error('err'), { severity: 'fatal' });
      await svc.captureMessage('warn msg', 'warning');
      await svc.captureMessage('info msg', 'info');

      const fatals = svc.getRecentErrors({ severity: 'fatal' });
      expect(fatals.length).toBe(1);
      expect(fatals[0].severity).toBe('fatal');

      const warnings = svc.getRecentErrors({ severity: 'warning' });
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toBe('warn msg');
    });

    it('defaults to limit 50 when not specified', async () => {
      for (let i = 0; i < 60; i++) {
        await svc.captureMessage(`msg-${i}`, 'info');
      }
      const errors = svc.getRecentErrors({});
      expect(errors.length).toBe(50);
    });
  });

  // ── captured error fields ─────────────────────────────────────────────────

  describe('captured error structure', () => {
    it('has all required fields', async () => {
      await svc.captureException(new Error('field test'));
      const errors = svc.getRecentErrors({ limit: 1 });
      const e = errors[0];

      expect(e.id).toBeTruthy();
      expect(e.type).toBeTruthy();
      expect(e.severity).toBeTruthy();
      expect(e.message).toBe('field test');
      expect(e.capturedAt).toBeTruthy();
      expect(new Date(e.capturedAt).getTime()).not.toBeNaN();
      expect(typeof e.sentToSentry).toBe('boolean');
    });

    it('includes stack trace for Error objects', async () => {
      await svc.captureException(new Error('stack test'));
      const errors = svc.getRecentErrors({ limit: 1 });
      expect(errors[0].stack).toBeTruthy();
    });
  });
});
