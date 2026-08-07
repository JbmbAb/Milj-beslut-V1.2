import {
  CASBoundaryViolation,
  CAS_I03,
  CAS_I05,
  CAS_I06,
  CAS_INVALID_HASH,
  CAS_REVERSE_IDENTITY_FORBIDDEN,
} from './CASInvariants';

export type CASAlgorithm = 'sha256' | 'sha512';

const DIGEST_LENGTH: Record<CASAlgorithm, number> = { sha256: 64, sha512: 128 };
const SHARD_LENGTH = 2;
const OBJECT_ROOT_SEGMENT = 'objects';
const HEX = /^[0-9a-f]+$/;

export interface CASHashRef {
  readonly algorithm: CASAlgorithm;
  readonly digest: string;
}

export interface CASObjectLocation extends CASHashRef {
  /** Path segments relative to an unspecified CAS root — never absolute, never rooted. */
  readonly segments: readonly string[];
  /** POSIX-joined form of `segments`. Stable across OS, cwd and environment. */
  readonly relativePath: string;
}

function isAlgorithm(value: string): value is CASAlgorithm {
  return value === 'sha256' || value === 'sha512';
}

/** Accepts `sha256:<hex>` / `sha512:<hex>`, or a bare hex digest whose length implies the algorithm. */
export function parseCASHash(hash: string): CASHashRef {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new CASBoundaryViolation(CAS_INVALID_HASH, CAS_I05, 'hash must be a non-empty string');
  }

  const normalized = hash.trim().toLowerCase();
  const separator = normalized.indexOf(':');

  if (separator !== -1) {
    const algorithm = normalized.slice(0, separator);
    const digest = normalized.slice(separator + 1);
    if (!isAlgorithm(algorithm)) {
      throw new CASBoundaryViolation(CAS_INVALID_HASH, CAS_I05, `unsupported algorithm '${algorithm}'`);
    }
    assertDigest(algorithm, digest);
    return { algorithm, digest };
  }

  const algorithm: CASAlgorithm | undefined =
    normalized.length === DIGEST_LENGTH.sha256
      ? 'sha256'
      : normalized.length === DIGEST_LENGTH.sha512
        ? 'sha512'
        : undefined;

  if (!algorithm) {
    throw new CASBoundaryViolation(CAS_INVALID_HASH, CAS_I05, `digest length ${normalized.length} is not a CAS digest`);
  }

  assertDigest(algorithm, normalized);
  return { algorithm, digest: normalized };
}

function assertDigest(algorithm: CASAlgorithm, digest: string): void {
  if (digest.length !== DIGEST_LENGTH[algorithm] || !HEX.test(digest)) {
    throw new CASBoundaryViolation(
      CAS_INVALID_HASH,
      CAS_I05,
      `digest is not ${DIGEST_LENGTH[algorithm]} lowercase hex characters`,
    );
  }
}

/**
 * CAS-I05: the only direction the resolver knows is hash -> path.
 * The result depends on the digest alone: no cwd, no env, no platform, no mount root.
 */
export function resolveObjectPath(hash: string): CASObjectLocation {
  const { algorithm, digest } = parseCASHash(hash);
  const segments = [OBJECT_ROOT_SEGMENT, algorithm, digest.slice(0, SHARD_LENGTH), digest.slice(SHARD_LENGTH)];
  return { algorithm, digest, segments, relativePath: segments.join('/') };
}

/**
 * CAS-I03: the mount root enters at the physical edge only, and never at identity level.
 * Relocating a store therefore cannot change hash, identity or replay capability.
 */
export function joinCASRoot(root: string, location: CASObjectLocation): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  return `${trimmed}/${location.relativePath}`;
}

/**
 * CAS-I06 (permitted direction): decode the *location* of an object from a path that CAS itself
 * produced. This locates an already-identified object; it never mints identity.
 * Returns null for any path that is not a canonical CAS object path.
 */
export function readDigestFromCASPath(candidate: string): CASHashRef | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;

  const segments = candidate.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = segments.length - 4; i >= 0; i -= 1) {
    if (segments[i] !== OBJECT_ROOT_SEGMENT) continue;

    const algorithm = segments[i + 1];
    const shard = segments[i + 2];
    const rest = segments[i + 3];
    if (!isAlgorithm(algorithm) || shard === undefined || rest === undefined) continue;
    if (shard.length !== SHARD_LENGTH) continue;

    const digest = `${shard}${rest}`;
    if (digest.length !== DIGEST_LENGTH[algorithm] || !HEX.test(digest)) continue;

    // Only accept a path this resolver could itself have produced.
    if (resolveObjectPath(`${algorithm}:${digest}`).relativePath !== segments.slice(i, i + 4).join('/')) continue;

    return { algorithm, digest };
  }

  return null;
}

/**
 * CAS-I06: identity is created by hashing bytes, never by looking at where a file happens to live.
 * This function exists so the forbidden direction has a name, and that name always throws.
 */
export function deriveIdentityFromPath(candidate: string): never {
  throw new CASBoundaryViolation(
    CAS_REVERSE_IDENTITY_FORBIDDEN,
    CAS_I06,
    `path '${candidate}' cannot produce artifact identity; identity is derived from bytes only`,
  );
}
