import type { SigningKeyProvider } from '../signing/SignatureEnvelope';

export type AuditStatus = 'CLEAN' | 'DEGRADED' | 'CORRUPTED';

export interface AuditReport {
  readonly status: AuditStatus;
  readonly level: 'L0' | 'L1' | 'L2' | 'L3';
  readonly processedCount: number;
  readonly errors: readonly string[];
  /** Digests moved out of the live CAS store during L3 quarantine. */
  readonly quarantined?: readonly string[];
}

export interface AuditL2Options {
  readonly concurrency?: number;
  readonly signing?: SigningKeyProvider;
  /** When true, missing promotion signatureEnvelope is an audit failure. */
  readonly requireSignatures?: boolean;
  readonly signal?: AbortSignal;
}

export interface AuditL3Options {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** Optional resume cursor (exclusive): skip digests until after this hash. */
  readonly afterDigest?: string;
  /** When true, move corrupt objects under cas/quarantine/ (evidence preserved). */
  readonly quarantine?: boolean;
}

export function statusFromErrors(errors: readonly string[]): AuditStatus {
  return errors.length === 0 ? 'CLEAN' : 'CORRUPTED';
}
