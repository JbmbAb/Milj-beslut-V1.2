import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../server/logger';

describe('logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('info', () => {
    it('emits JSON log to stdout', () => {
      logger.info('test message');

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('test message');
      expect(parsed.timestamp).toBeDefined();
    });

    it('includes context in log output', () => {
      logger.info('test with context', { userId: 123, action: 'login' });

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.userId).toBe(123);
      expect(parsed.action).toBe('login');
    });
  });

  describe('warn', () => {
    it('emits JSON log to stderr', () => {
      logger.warn('warning message');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalledTimes(0);

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('warn');
      expect(parsed.message).toBe('warning message');
    });

    it('includes context in warning', () => {
      logger.warn('slow query', { durationMs: 1200 });

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.durationMs).toBe(1200);
    });
  });

  describe('error', () => {
    it('emits JSON log to stderr', () => {
      logger.error('error message');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalledTimes(0);

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('error');
      expect(parsed.message).toBe('error message');
    });

    it('includes error context', () => {
      logger.error('unhandled error', { err: 'Database connection failed', stack: 'at line 42' });

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.err).toBe('Database connection failed');
      expect(parsed.stack).toBe('at line 42');
    });
  });

  describe('debug', () => {
    it('does not emit when LOG_LEVEL is not debug', () => {
      delete process.env.LOG_LEVEL;
      delete process.env.NODE_ENV;

      logger.debug('debug message');

      expect(stdoutSpy).toHaveBeenCalledTimes(0);
      expect(stderrSpy).toHaveBeenCalledTimes(0);
    });

    it('emits when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('debug message');

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('debug');
      expect(parsed.message).toBe('debug message');
    });

    it('emits when NODE_ENV=development', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';

      logger.debug('debug message');

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('debug');
    });

    it('emits when NODE_ENV=debug', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'debug';

      logger.debug('debug message');

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });

    it('includes context in debug logs', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('debug with context', { variable: 'value', count: 42 });

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.variable).toBe('value');
      expect(parsed.count).toBe(42);
    });
  });

  describe('timestamp format', () => {
    it('uses ISO 8601 format', () => {
      logger.info('test');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('JSON output format', () => {
    it('outputs single-line JSON with newline', () => {
      logger.info('test');

      const output = stdoutSpy.mock.calls[0][0] as string;

      expect(output.endsWith('\n')).toBe(true);
      expect(output.split('\n').length).toBe(2); // JSON line + trailing newline
    });

    it('escapes special characters in JSON', () => {
      logger.info('message with "quotes" and \n newlines');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.message).toBe('message with "quotes" and \n newlines');
    });
  });
});
