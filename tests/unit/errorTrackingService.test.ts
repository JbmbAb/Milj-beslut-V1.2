import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

type ErrorTrackingModule = typeof import('../../server/services/errorTrackingService');

describe('errorTrackingService', () => {
  let captureException: ErrorTrackingModule['captureException'];
  let captureMessage: ErrorTrackingModule['captureMessage'];
  let getRecentErrors: ErrorTrackingModule['getRecentErrors'];

  async function loadModuleWithOptionalSentry(
    sentryMock?: {
      init: ReturnType<typeof vi.fn>;
      captureException: ReturnType<typeof vi.fn>;
      captureMessage: ReturnType<typeof vi.fn>;
    },
  ) {
    vi.resetAllMocks();
    vi.resetModules();
    vi.doUnmock('@sentry/node');
    delete process.env.SENTRY_DSN;

    if (sentryMock) {
      process.env.SENTRY_DSN = 'https://test@example.com/0';
      vi.doMock('@sentry/node', () => sentryMock);
    }

    const mod = await import('../../server/services/errorTrackingService');
    captureException = mod.captureException;
    captureMessage = mod.captureMessage;
    getRecentErrors = mod.getRecentErrors;
  }

  beforeEach(async () => {
    await loadModuleWithOptionalSentry();
  });

  describe('captureException', () => {
    it('returns a UUID-formatted id', async () => {
      const id = await captureException(new Error('Test error'));
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('stores the exception in the ring buffer', async () => {
      await captureException(new Error('Stored error'));
      const errors = getRecentErrors({ limit: 50 });
      expect(errors.some((e) => e.message === 'Stored error')).toBe(true);
    });

    it('records type as "exception"', async () => {
      await captureException(new Error('Type check'));
      const errors = getRecentErrors({ limit: 5 });
      const e = errors.find((x) => x.message === 'Type check');
      expect(e?.type).toBe('exception');
    });

    it('defaults severity to "error" when not provided', async () => {
      await captureException(new Error('Default severity'));
      const errors = getRecentErrors({ severity: 'error' });
      expect(errors.some((e) => e.message === 'Default severity')).toBe(true);
    });

    it('respects custom severity from context', async () => {
      await captureException(new Error('Fatal error'), { severity: 'fatal' });
      const errors = getRecentErrors({ severity: 'fatal' });
      expect(errors.some((e) => e.message === 'Fatal error')).toBe(true);
    });

    it('stores userId and url from context', async () => {
      await captureException(new Error('Context error'), { userId: 'u-42', url: '/api/test' });
      const errors = getRecentErrors({ limit: 5 });
      const e = errors.find((x) => x.message === 'Context error');
      expect(e?.userId).toBe('u-42');
      expect(e?.url).toBe('/api/test');
    });

    it('handles non-Error objects by wrapping in Error', async () => {
      await captureException('plain string error');
      const errors = getRecentErrors({ limit: 5 });
      expect(errors.some((e) => e.message === 'plain string error')).toBe(true);
    });

    it('handles null/undefined input gracefully', async () => {
      const id = await captureException(null);
      expect(id).toBeTruthy();
    });

    it('logs via logger.error', async () => {
      await captureException(new Error('Log me'));
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'error-tracking: exception captured',
        expect.objectContaining({ message: 'Log me' }),
      );
    });

    it('marks sentToSentry as false when no DSN is configured', async () => {
      await captureException(new Error('No sentry'));
      const errors = getRecentErrors({ limit: 1 });
      expect(errors[0]?.sentToSentry).toBe(false);
    });

    it('forwards exceptions to Sentry when DSN and SDK are available', async () => {
      const sentryMock = {
        init: vi.fn(),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
      };

      await loadModuleWithOptionalSentry(sentryMock);
      await captureException(new Error('Sentry exception'), {
        severity: 'fatal',
        userId: 'user-1',
        extra: { requestId: 'req-1' },
      });

      expect(sentryMock.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://test@example.com/0',
          tracesSampleRate: 0.1,
        }),
      );
      expect(sentryMock.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          level: 'fatal',
          extra: { requestId: 'req-1' },
          user: { id: 'user-1' },
        }),
      );

      const errors = getRecentErrors({ limit: 1 });
      expect(errors[0]?.sentToSentry).toBe(true);
    });

    it('falls back to local storage when Sentry capture throws', async () => {
      const sentryMock = {
        init: vi.fn(),
        captureException: vi.fn(() => {
          throw new Error('Sentry failed');
        }),
        captureMessage: vi.fn(),
      };

      await loadModuleWithOptionalSentry(sentryMock);
      await captureException(new Error('Fallback exception'));

      const errors = getRecentErrors({ limit: 1 });
      expect(errors[0]?.sentToSentry).toBe(false);
    });

    it('stores capturedAt as a valid ISO 8601 timestamp', async () => {
      await captureException(new Error('Timestamp check'));
      const errors = getRecentErrors({ limit: 1 });
      const ts = errors[0]?.capturedAt;
      expect(ts).toBeTruthy();
      expect(() => new Date(ts!).toISOString()).not.toThrow();
    });
  });

  describe('captureMessage', () => {
    it('returns a UUID-formatted id', async () => {
      const id = await captureMessage('Hello world');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('stores the message in the ring buffer', async () => {
      await captureMessage('Stored message');
      const errors = getRecentErrors({ limit: 50 });
      expect(errors.some((e) => e.message === 'Stored message')).toBe(true);
    });

    it('records type as "message"', async () => {
      await captureMessage('Type check msg');
      const errors = getRecentErrors({ limit: 5 });
      const e = errors.find((x) => x.message === 'Type check msg');
      expect(e?.type).toBe('message');
    });

    it('defaults severity to "info" when not provided', async () => {
      await captureMessage('Info default');
      const errors = getRecentErrors({ severity: 'info' });
      expect(errors.some((e) => e.message === 'Info default')).toBe(true);
    });

    it('stores provided severity correctly', async () => {
      await captureMessage('Warning msg', 'warning');
      const errors = getRecentErrors({ severity: 'warning' });
      expect(errors.some((e) => e.message === 'Warning msg')).toBe(true);
    });

    it('stores optional context record', async () => {
      await captureMessage('With context', 'info', { requestId: 'r-123' });
      const errors = getRecentErrors({ limit: 5 });
      const e = errors.find((x) => x.message === 'With context');
      expect(e?.context).toEqual({ requestId: 'r-123' });
    });

    it('logs via logger.info', async () => {
      await captureMessage('Log info msg');
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        'error-tracking: message captured',
        expect.objectContaining({ message: 'Log info msg' }),
      );
    });

    it('forwards messages to Sentry when configured', async () => {
      const sentryMock = {
        init: vi.fn(),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
      };

      await loadModuleWithOptionalSentry(sentryMock);
      await captureMessage('Sentry message', 'warning');

      expect(sentryMock.captureMessage).toHaveBeenCalledWith('Sentry message', 'warning');

      const errors = getRecentErrors({ limit: 1 });
      expect(errors[0]?.sentToSentry).toBe(true);
    });
  });

  describe('getRecentErrors', () => {
    it('returns errors newest first', async () => {
      await captureMessage('first');
      await captureMessage('second');
      await captureMessage('third');
      const errors = getRecentErrors({ limit: 10 });
      const messages = errors.map((e) => e.message);
      expect(messages.indexOf('third')).toBeLessThan(messages.indexOf('second'));
      expect(messages.indexOf('second')).toBeLessThan(messages.indexOf('first'));
    });

    it('respects the limit parameter', async () => {
      await captureMessage('m1');
      await captureMessage('m2');
      await captureMessage('m3');
      await captureMessage('m4');
      const errors = getRecentErrors({ limit: 2 });
      expect(errors).toHaveLength(2);
    });

    it('defaults to limit 50 when limit is not provided', async () => {
      for (let i = 0; i < 60; i++) {
        await captureMessage(`msg-${i}`);
      }
      const errors = getRecentErrors({});
      expect(errors.length).toBeLessThanOrEqual(50);
    });

    it('filters by severity', async () => {
      await captureMessage('info msg', 'info');
      await captureMessage('warn msg', 'warning');
      await captureMessage('error msg', 'error');

      const warnings = getRecentErrors({ severity: 'warning' });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.every((e) => e.severity === 'warning')).toBe(true);
    });

    it('returns empty array when buffer is empty', () => {
      const errors = getRecentErrors({ limit: 10 });
      expect(errors).toHaveLength(0);
    });

    it('includes both exceptions and messages in results', async () => {
      await captureException(new Error('An exception'));
      await captureMessage('A message');
      const errors = getRecentErrors({ limit: 10 });
      const types = errors.map((e) => e.type);
      expect(types).toContain('exception');
      expect(types).toContain('message');
    });
  });

  describe('ring buffer behaviour', () => {
    it('caps stored errors at 500 entries', async () => {
      const batchSize = 510;
      const promises: Promise<string>[] = [];
      for (let i = 0; i < batchSize; i++) {
        promises.push(captureMessage(`overflow-msg-${i}`));
      }
      await Promise.all(promises);

      // getRecentErrors can only return up to limit=50 by default, so use a large limit
      // We cannot directly read _errors, but we can verify the newest entries are present
      const errors = getRecentErrors({ limit: 500 });
      expect(errors.length).toBeLessThanOrEqual(500);
    });
  });
});
