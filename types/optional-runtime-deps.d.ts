declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config?: unknown);
    send(command: unknown): Promise<unknown>;
  }

  export class PutObjectCommand {
    constructor(input?: unknown);
  }
}

declare module '@sentry/node' {
  export function init(options?: unknown): void;
  export function captureException(error: unknown, context?: unknown): string;
  export function captureMessage(message: string, level?: unknown): string;
}
