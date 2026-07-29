import {
  canonicalizeStrict,
  hashCanonicalValue,
  hashSerialized,
  type SignatureEnvelope,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import type { IntegrityProvider } from './integrityProvider';

/** Mimers v9 integrity provider (RFC8785 + SHA-256). */
export class MimersV9IntegrityProvider implements IntegrityProvider {
  constructor(private readonly signing?: SigningKeyProvider) {}

  canonicalize(value: unknown): string {
    return canonicalizeStrict(value);
  }

  hash(value: unknown): string {
    return hashCanonicalValue(value);
  }

  hashSerialized(serialized: string): string {
    return hashSerialized(serialized);
  }

  async sign(payload: Uint8Array): Promise<SignatureEnvelope> {
    if (!this.signing) throw new Error('MimersV9IntegrityProvider: no SigningKeyProvider configured');
    return this.signing.sign(payload);
  }

  async verify(payload: Uint8Array, signature: SignatureEnvelope): Promise<boolean> {
    if (!this.signing) throw new Error('MimersV9IntegrityProvider: no SigningKeyProvider configured');
    return this.signing.verify(payload, signature);
  }
}
