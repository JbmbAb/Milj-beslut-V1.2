export interface PutResult {
  readonly hash: string;
  readonly size: number;
  readonly existed: boolean;
}

export interface CASRepository {
  put(obj: unknown): Promise<PutResult>;
  get<T = unknown>(hash: string, options?: { verifyHash?: boolean }): Promise<T | null>;
  exists(hash: string): Promise<boolean>;
  existsAuthoritative(hash: string): Promise<boolean>;
}

export type DurabilityMode = 'strict' | 'best-effort' | 'none';

export interface CommitStrategy {
  commit(tempPath: string, destinationPath: string): Promise<void>;
}

export class DurabilityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DurabilityError';
  }
}

export class CASIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CASIntegrityError';
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
