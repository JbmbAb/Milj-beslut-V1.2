/**
 * logger.test.ts
 *
 * Tests for the structured JSON logger.
 * Mocks process.stdout and process.stderr to avoid polluting test output.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../server/logger';
import type { LogRecord } from '../../server/logger';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  delete process.env.LOG_LEVEL;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function getLastStdout(): LogRecord {
  const calls = stdoutSpy.mock.calls;
  const last = calls[calls.length - 1][0] as string;
  return JSON.parse(last) as LogRecord;
}

function getLastStderr(): LogRecord {
  const calls = stderrSpy.mock.calls;
  const last = calls[calls.length - 1][0] as string;
  return JSON.parse(last) as LogRecord;
}

describe('logger.info()', () => {
  it('writes to stdout (not stderr)', () => {
    logger.info('test message');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('produces valid JSON line', () => {
    logger.info('valid json');
    expect(() => getLastStdout()).not.toThrow();
  });

  it('includes level="info"', () => {
    logger.info('level test');
    expect(getLastStdout().level).toBe('info');
  });

  it('includes the message', () => {
    logger.info('my info message');
    expect(getLastStdout().message).toBe('my info message');
  });

  it('includes a timestamp in ISO format', () => {
    logger.info('timestamp test');
    const { timestamp } = getLastStdout();
    expect(typeof timestamp).toBe('string');
    expect(new Date(timestamp).getTime()).not.toBeNaN();
  });

  it('includes context fields', () => {
    logger.info('with context', { requestId: 'abc', userId: 'u1' });
    const record = getLastStdout();
    expect(record.requestId).toBe('abc');
    expect(record.userId).toBe('u1');
  });
});

describe('logger.warn()', () => {
  it('writes to stderr (not stdout)', () => {
    logger.warn('a warning');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('includes level="warn"', () => {
    logger.warn('warn level');
    expect(getLastStderr().level).toBe('warn');
  });

  it('includes the message', () => {
    logger.warn('warn message');
    expect(getLastStderr().message).toBe('warn message');
  });

  it('includes context fields', () => {
    logger.warn('warn ctx', { code: 429 });
    expect(getLastStderr().code).toBe(429);
  });
});

describe('logger.error()', () => {
  it('writes to stderr (not stdout)', () => {
    logger.error('an error');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('includes level="error"', () => {
    logger.error('error level');
    expect(getLastStderr().level).toBe('error');
  });

  it('includes the message', () => {
    logger.error('error message');
    expect(getLastStderr().message).toBe('error message');
  });

  it('includes context fields', () => {
    logger.error('error ctx', { stack: 'Error: ...' });
    expect(getLastStderr().stack).toBe('Error: ...');
  });
});

describe('logger.debug()', () => {
  it('does NOT emit when LOG_LEVEL is not set', () => {
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    logger.debug('silent debug');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits to stdout when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('debug message');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(getLastStdout().level).toBe('debug');
    expect(getLastStdout().message).toBe('debug message');
    delete process.env.LOG_LEVEL;
  });

  it('emits to stdout when NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    logger.debug('dev debug');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(getLastStdout().level).toBe('debug');
    delete process.env.NODE_ENV;
  });

  it('emits to stdout when NODE_ENV=debug', () => {
    process.env.NODE_ENV = 'debug';
    logger.debug('debug env');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(getLastStdout().level).toBe('debug');
    delete process.env.NODE_ENV;
  });

  it('does NOT emit when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    logger.debug('production debug');
    expect(stdoutSpy).not.toHaveBeenCalled();
    delete process.env.NODE_ENV;
  });

  it('includes context in debug output', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('debug ctx', { key: 'val' });
    expect(getLastStdout().key).toBe('val');
    delete process.env.LOG_LEVEL;
  });
});

describe('logger JSON output', () => {
  it('writes a single JSON line ending with newline', () => {
    logger.info('single line');
    const raw = stdoutSpy.mock.calls[0][0] as string;

    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.split('\n')).toHaveLength(2);
  });

  it('preserves special characters in JSON output', () => {
    logger.info('message with "quotes" and \n newlines');
    expect(getLastStdout().message).toBe('message with "quotes" and \n newlines');
  });
});
