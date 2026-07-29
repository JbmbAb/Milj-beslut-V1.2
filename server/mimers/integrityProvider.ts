import type { SignatureEnvelope } from '@miljobeslut/mimers-brunn-core';

/**
 * Bridge integrity API (ADR-042). Evolve/artifact call this — never import
 * core crypto ad-hoc from evolve modules.
 */
export interface IntegrityProvider {
  canonicalize(value: unknown): string;
  hash(value: unknown): string;
  hashSerialized(serialized: string): string;
  sign?(payload: Uint8Array): Promise<SignatureEnvelope>;
  verify?(payload: Uint8Array, signature: SignatureEnvelope): Promise<boolean>;
}

export interface IntegrityComparison {
  readonly legacyDigest: string;
  readonly v9Digest: string;
  readonly equal: boolean;
}
