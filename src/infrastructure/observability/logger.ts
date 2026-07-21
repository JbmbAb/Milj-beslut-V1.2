/**
 * logger.ts
 *
 * Säkrad, strukturerad JSON-logger för det nya Clean Architecture-lagret i src/.
 * Alla loggrader skrivs som enrads-JSON till stdout/stderr för att möjliggöra
 * direkt integrering och sökbarhet i Google Cloud Logging utan extra parsing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private contextName?: string) {}

  private isDebugEnabled(): boolean {
    const env = process.env.LOG_LEVEL ?? process.env.NODE_ENV;
    return env === 'debug' || env === 'development';
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const record: LogRecord = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(this.contextName ? { context: this.contextName } : {}),
      ...meta,
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.isDebugEnabled()) {
      this.emit('debug', message, meta);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, meta);
  }
}

// Standard logger-instans för generell användning
export const logger = new Logger();

// Fabriksmetod för kontextuella loggers (t.ex. Logger för en specifik klass eller usecase)
export function createLogger(contextName: string): Logger {
  return new Logger(contextName);
}
