import { createHash } from 'node:crypto';
import { canonicalizeStrict } from './canonicalize';
import {
  assertSupportedHashAlgorithm,
  type HashAlgorithmId,
  type SupportedHashAlgorithm,
} from './algorithms';

const DIGEST_LENGTHS: Record<SupportedHashAlgorithm, number> = {
  sha256: 64,
  sha512: 128,
};

/** @deprecated Prefer HashAlgorithmId — alias for SupportedHashAlgorithm during P1. */
export type HashAlgorithm = SupportedHashAlgorithm;

export interface ArtifactHash {
  readonly algorithm: HashAlgorithmId;
  readonly digest: string;
}

export interface HashProvider {
  digest(algorithm: SupportedHashAlgorithm, data: Uint8Array): Uint8Array;
}

export const NodeHashProvider: HashProvider = {
  digest(algorithm: SupportedHashAlgorithm, data: Uint8Array): Uint8Array {
    return createHash(algorithm).update(data).digest();
  },
};

/** [H-01] Parse and validate `algorithm:hexdigest` CAS addresses. */
export function parseHash(hashStr: string): ArtifactHash {
  const separator = hashStr.indexOf(':');
  if (separator <= 0 || separator !== hashStr.lastIndexOf(':')) {
    throw new TypeError(`[H-01] Invalid CAS address '${hashStr}'. Expected 'algorithm:digest'.`);
  }
  const algorithmRaw = hashStr.slice(0, separator);
  const digest = hashStr.slice(separator + 1);
  const algorithm = assertSupportedHashAlgorithm(algorithmRaw);

  const expectedLength = DIGEST_LENGTHS[algorithm];
  if (digest.length !== expectedLength || !/^[0-9a-f]+$/.test(digest)) {
    throw new TypeError(
      `[H-01] Invalid ${algorithm} digest format or length. Expected exactly ${expectedLength} hex chars.`,
    );
  }

  return { algorithm, digest };
}

/** Content-address opaque bytes (format-agnostic CAS hashing). */
export function hashBytes(
  bytes: Uint8Array,
  algorithm: SupportedHashAlgorithm = 'sha256',
  provider: HashProvider = NodeHashProvider,
): string {
  const digestBytes = provider.digest(algorithm, bytes);
  const digestHex = Buffer.from(digestBytes).toString('hex');
  return `${algorithm}:${digestHex}`;
}

export function hashSerialized(
  serialized: string,
  algorithm: SupportedHashAlgorithm = 'sha256',
  provider: HashProvider = NodeHashProvider,
): string {
  return hashBytes(Buffer.from(serialized, 'utf-8'), algorithm, provider);
}

export function hashCanonicalValue(
  value: unknown,
  algorithm: SupportedHashAlgorithm = 'sha256',
  provider: HashProvider = NodeHashProvider,
): string {
  return hashSerialized(canonicalizeStrict(value), algorithm, provider);
}

export function formatArtifactHash(hash: ArtifactHash): string {
  return `${hash.algorithm}:${hash.digest}`;
}

export function parseArtifactHashToStruct(hashStr: string): ArtifactHash {
  return parseHash(hashStr);
}
