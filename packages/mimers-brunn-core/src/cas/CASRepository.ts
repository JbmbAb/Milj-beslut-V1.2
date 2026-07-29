export interface PutResult {
  readonly hash: string;
  readonly size: number;
  readonly existed: boolean;
}

export interface ObjectVerifyResult {
  readonly ok: boolean;
  readonly size?: number;
  readonly error?: string;
}

export interface CASVerificationResult {
  readonly ok: boolean;
  readonly digestValid: boolean;
  readonly sizeValid: boolean;
  readonly mediaTypeValid: boolean;
  readonly error?: string;
}

export interface QuarantineResult {
  readonly quarantined: boolean;
  readonly quarantinePath?: string;
  readonly error?: string;
}

export interface CASDescriptorLike {
  readonly mediaType: string;
  readonly digest: string;
  readonly size: number;
}

export type PutBytesOptions = {
  /** Defaults to repository-configured algorithm (usually sha256). */
  readonly algorithm?: 'sha256' | 'sha512';
};

/**
 * Content-addressed store: opaque bytes only at the core.
 * JSON helpers (`putCanonical` / `get`) sit one layer above `putBytes` / `getBytes`.
 */
export interface CASRepository {
  /** Format-agnostic put: hash raw bytes and store atomically. */
  putBytes(bytes: Uint8Array, options?: PutBytesOptions): Promise<PutResult>;
  /** Format-agnostic get with copy-on-read (never returns a mutable cache reference). */
  getBytes(hash: string, options?: { verifyHash?: boolean }): Promise<Uint8Array | null>;
  /** UTF-8 string → putBytes. */
  putSerialized(serialized: string, options?: PutBytesOptions): Promise<PutResult>;
  /** canonicalizeStrict → putSerialized (JSON domain). */
  putCanonical(obj: unknown, options?: PutBytesOptions): Promise<PutResult>;
  /** @deprecated Prefer putCanonical — thin alias for backward compatibility. */
  put(obj: unknown): Promise<PutResult>;
  /**
   * JSON helper: getBytes + JSON.parse.
   * Invalid for non-UTF8 / non-JSON payloads — use getBytes for binary.
   */
  get<T = unknown>(hash: string, options?: { verifyHash?: boolean }): Promise<T | null>;
  exists(hash: string): Promise<boolean>;
  existsAuthoritative(hash: string): Promise<boolean>;
  /** Re-hash on-disk bytes (bypasses cache). Used by L2/L3 audits. */
  verifyStoredObject(hash: string): Promise<ObjectVerifyResult>;
  /** Structured descriptor verification (digest + size + mediaType). */
  verifyDescriptor(
    descriptor: CASDescriptorLike,
    expectedMediaType?: string,
  ): Promise<CASVerificationResult>;
  /** Move a corrupt object out of the live store (evidence-preserving). */
  quarantineObject(hash: string, reason: string): Promise<QuarantineResult>;
  /** Stream all content-address digests. Memory O(1) aside from walk state. */
  streamObjectDigests(signal?: AbortSignal): AsyncIterable<string>;
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
