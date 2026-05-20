/**
 * Structured JSON logger for the Miljöbeslut backend.
 *
 * All log lines are emitted as single-line JSON to stdout/stderr so they can
 * be ingested by any log aggregator (Cloud Logging, Datadog, Splunk, etc.)
 * without additional parsing configuration.
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('server started', { port: 8787 });
 *   logger.warn('slow query', { durationMs: 1200 });
 *   logger.error('unhandled error', { err: error.message });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function isDebugEnabled(): boolean {
  const env = process.env.LOG_LEVEL ?? process.env.NODE_ENV;
  return env === 'debug' || env === 'development';
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const record: LogRecord = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (isDebugEnabled()) emit('debug', message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    emit('info', message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    emit('warn', message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    emit('error', message, context);
  },
};
