import { canonicalizeStrict, hashCanonicalValue, type HashAlgorithmId } from '../serialization';
import type {
  SignatureEnvelope,
  SigningKeyProvider,
  VerificationKeyProvider,
  ArtifactAttestation,
} from '../signing/SignatureEnvelope';
import type { SignatureAlgorithmId } from '../serialization/algorithms';

export const ATTESTATION_DOMAIN = 'mimers-brunn/artifact-attestation/v1' as const;

export type AttestationPayload = {
  readonly domain: typeof ATTESTATION_DOMAIN;
  readonly mediaType: 'application/vnd.mimers.attestation.v1+json';
  readonly canonicalization: 'RFC8785';
  readonly subjectDigest: string;
  readonly predicateType: string;
  readonly predicate: Record<string, unknown>;
  readonly hashAlgorithm: HashAlgorithmId;
  readonly signatureAlgorithm: SignatureAlgorithmId;
};

/**
 * SLSA-inspired attestation over a subject digest + predicate (P1E).
 * Domain-separated so promotion signatures cannot be reused as attestations.
 */
export async function createArtifactAttestation(args: {
  readonly subjectDigest: string;
  readonly predicateType: string;
  readonly predicate: Record<string, unknown>;
  readonly signing: SigningKeyProvider;
  readonly hashAlgorithm?: HashAlgorithmId;
  readonly signatureAlgorithm?: SignatureAlgorithmId;
}): Promise<ArtifactAttestation> {
  const hashAlgorithm = args.hashAlgorithm ?? 'sha256';
  const signatureAlgorithm = args.signatureAlgorithm ?? 'Ed25519';
  const payload: AttestationPayload = {
    domain: ATTESTATION_DOMAIN,
    mediaType: 'application/vnd.mimers.attestation.v1+json',
    canonicalization: 'RFC8785',
    subjectDigest: args.subjectDigest,
    predicateType: args.predicateType,
    predicate: args.predicate,
    hashAlgorithm,
    signatureAlgorithm,
  };

  const bytes = Buffer.from(canonicalizeStrict(payload), 'utf-8');
  const envelope = await args.signing.sign(bytes);
  if (envelope.algorithm !== signatureAlgorithm) {
    throw new Error(
      `Attestation signature algorithm mismatch: expected ${signatureAlgorithm}, got ${envelope.algorithm}`,
    );
  }

  return {
    subjectDigest: args.subjectDigest,
    predicateType: args.predicateType,
    predicate: args.predicate,
    hashAlgorithm,
    signatureAlgorithm: envelope.algorithm,
    signer: envelope.keyId,
    signature: envelope.signature,
  };
}

/**
 * P2-SR-VERIFY-ONLY-01 — widened from `SigningKeyProvider` to `VerificationKeyProvider`.
 *
 * This function never called `sign`. Requiring a signer was therefore an over-demand that
 * forced minting capability onto every verifying consumer. Widening is source-compatible:
 * `SigningKeyProvider extends VerificationKeyProvider`, so existing callers still type-check.
 */
export async function verifyArtifactAttestation(
  attestation: ArtifactAttestation,
  signing: VerificationKeyProvider,
): Promise<boolean> {
  const payload: AttestationPayload = {
    domain: ATTESTATION_DOMAIN,
    mediaType: 'application/vnd.mimers.attestation.v1+json',
    canonicalization: 'RFC8785',
    subjectDigest: attestation.subjectDigest,
    predicateType: attestation.predicateType,
    predicate: attestation.predicate,
    hashAlgorithm: attestation.hashAlgorithm,
    signatureAlgorithm: attestation.signatureAlgorithm,
  };
  const bytes = Buffer.from(canonicalizeStrict(payload), 'utf-8');
  const digestAlgorithm =
    attestation.hashAlgorithm === 'blake3' ? 'sha256' : attestation.hashAlgorithm;
  const envelope: SignatureEnvelope = {
    algorithm: attestation.signatureAlgorithm,
    digestAlgorithm,
    canonicalization: 'RFC8785',
    keyId: attestation.signer,
    signature: attestation.signature,
    timestamp: 0,
  };
  return signing.verify(bytes, envelope);
}

export function attestationSubjectBinding(attestation: ArtifactAttestation): string {
  return hashCanonicalValue({
    subjectDigest: attestation.subjectDigest,
    predicateType: attestation.predicateType,
  });
}
