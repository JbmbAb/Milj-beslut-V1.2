import type { HashAlgorithmId, SignatureAlgorithmId } from '../serialization/algorithms';

/**
 * Cryptographic signature envelope (ADR-042).
 * Content identity is hash(canonical bytes); this envelope attests those bytes.
 */
export interface SignatureEnvelope {
  readonly algorithm: SignatureAlgorithmId;
  readonly digestAlgorithm: HashAlgorithmId;
  readonly canonicalization: 'RFC8785';
  readonly keyId: string;
  readonly signature: string;
  readonly timestamp: number;
}

export interface SigningKeyProvider {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<SignatureEnvelope>;
  verify(payload: Uint8Array, signature: SignatureEnvelope): Promise<boolean>;
}

export interface ArtifactAttestation {
  readonly subjectDigest: string;
  readonly predicateType: string;
  readonly predicate: Record<string, unknown>;
  readonly hashAlgorithm: HashAlgorithmId;
  readonly signatureAlgorithm: SignatureAlgorithmId;
  readonly signer: string;
  readonly signature: string;
}
