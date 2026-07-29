/**
 * Bridge: keep legacy key-material API while core uses SignatureEnvelope SigningKeyProvider.
 * Prefer @miljobeslut/mimers-brunn-core LocalPemSigningKeyProvider for new code.
 */
export {
  LocalPemSigningKeyProvider as CoreLocalPemSigningKeyProvider,
  type SignatureEnvelope,
  type SigningKeyProvider as EnvelopeSigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';

/** @deprecated Prefer EnvelopeSigningKeyProvider from mimers-brunn-core (ADR-042). */
export interface SigningKeyProvider {
  readonly signingKeyId: string;
  getPrivateKey(): string | Promise<string>;
  getPublicKey?(): string | Promise<string | undefined>;
}

/** @deprecated Prefer CoreLocalPemSigningKeyProvider. */
export class LocalPemSigningKeyProvider implements SigningKeyProvider {
  constructor(
    readonly signingKeyId: string,
    private readonly privateKeyPem: string,
    private readonly publicKeyPem?: string,
  ) {}

  getPrivateKey(): string {
    return this.privateKeyPem;
  }

  getPublicKey(): string | undefined {
    return this.publicKeyPem;
  }
}
