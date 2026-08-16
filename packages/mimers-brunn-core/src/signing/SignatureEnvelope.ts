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

/**
 * P2-SR-VERIFY-ONLY-01 — CAPABILITY SEPARATION.
 *
 * Checking a signature needs the public key. Minting one needs the private key. Bundling both
 * into a single provider meant every consumer that only wanted to VERIFY had to be handed an
 * object that could also SIGN — and, through `getSourceRegistrySigningKeyFromEnv()`, a runtime
 * that only wanted to read the source registry had to hold the GOVERNOR private key.
 *
 * That is authority acquired through an ambient channel rather than an explicit port: the
 * harvest runtime never took a signer as a parameter, it simply found one in its environment.
 *
 * The split is what makes minting structurally unavailable rather than merely forbidden. A
 * consumer typed against `VerificationKeyProvider` has no `sign` to call, so it cannot mint an
 * attestation until someone changes its declared capability — which is a visible, reviewable act.
 *
 * `SigningKeyProvider extends VerificationKeyProvider`, so anything that can sign can still
 * verify and every existing implementation and call site remains valid. The signature format,
 * the hash domain and the registry schema are untouched.
 */
export interface VerificationKeyProvider {
  readonly keyId: string;
  verify(payload: Uint8Array, signature: SignatureEnvelope): Promise<boolean>;
}

export interface SigningKeyProvider extends VerificationKeyProvider {
  sign(payload: Uint8Array): Promise<SignatureEnvelope>;
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
