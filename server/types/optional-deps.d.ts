/**
 * Minimal type stubs for optional peer dependencies.
 * These packages are not required to run the application — they enhance it
 * when installed (AWS S3 backup, Sentry error tracking).
 * Install with: npm install @aws-sdk/client-s3 @sentry/node
 */

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config?: Record<string, unknown>);
    send(command: unknown): Promise<unknown>;
  }
  export class PutObjectCommand {
    constructor(input: { Bucket: string; Key: string; Body: Buffer | string; ContentType?: string });
  }
}

declare module '@sentry/node' {
  export function init(options: { dsn?: string; tracesSampleRate?: number }): void;
  export function captureException(exception: unknown, context?: Record<string, unknown>): string;
  export function captureMessage(message: string, level?: string): string;
}
