/**
 * First-class crypto algorithm types (ADR-042 crypto agility).
 * Used in manifests, attestations, envelopes, and verifiers.
 */

export const HASH_ALGORITHMS = ['sha256', 'sha512', 'blake3'] as const;
export type HashAlgorithmId = (typeof HASH_ALGORITHMS)[number];

/** Algorithms implemented by NodeHashProvider today. */
export const SUPPORTED_HASH_ALGORITHMS = ['sha256', 'sha512'] as const;
export type SupportedHashAlgorithm = (typeof SUPPORTED_HASH_ALGORITHMS)[number];

export const SIGNATURE_ALGORITHMS = ['ECDSA_P256_SHA256', 'Ed25519', 'RSA_PSS_SHA256'] as const;
export type SignatureAlgorithmId = (typeof SIGNATURE_ALGORITHMS)[number];

export function isHashAlgorithmId(value: string): value is HashAlgorithmId {
  return (HASH_ALGORITHMS as readonly string[]).includes(value);
}

export function isSignatureAlgorithmId(value: string): value is SignatureAlgorithmId {
  return (SIGNATURE_ALGORITHMS as readonly string[]).includes(value);
}

export function assertSupportedHashAlgorithm(algorithm: string): SupportedHashAlgorithm {
  if (algorithm === 'blake3') {
    throw new TypeError('[H-01] blake3 is reserved for future migration; not yet supported by NodeHashProvider.');
  }
  if (algorithm !== 'sha256' && algorithm !== 'sha512') {
    throw new TypeError(`[H-01] Unsupported hash algorithm: '${algorithm}'.`);
  }
  return algorithm;
}
