/**
 * Canonical serialization (contract 4): RFC 8785 (JCS) -> UTF-8 -> SHA-256, computed with the repository's
 * existing identity primitive (packages/mps-compliance/src/canonical/sha256Canonical.ts). No other hashing path
 * exists in this package.
 */
import { canonicalize } from 'json-canonicalize';
import { sha256Bytes, sha256CanonicalJson } from '../../mps-compliance/src/canonical/sha256Canonical';

export interface CanonicalManifest {
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** canonical_bytes(manifest) and manifest_sha256 = SHA-256(canonical_bytes). No BOM, no trailing newline. */
export function canonicalizeManifest(value: unknown): CanonicalManifest {
  const bytes = Buffer.from(canonicalize(value), 'utf8');
  return { bytes, sha256: sha256Bytes(bytes) };
}

/** SHA-256(JCS(value)) -- the hash of every policy, derivation payload and record in this contract. */
export function hashJcs(value: unknown): string {
  return sha256CanonicalJson(value);
}

/** hashJcs that reports "cannot be canonicalised" (circular, unsupported) as undefined instead of throwing. */
export function tryHashJcs(value: unknown): string | undefined {
  try {
    return sha256CanonicalJson(value);
  } catch {
    return undefined;
  }
}

/** SHA-256 over raw bytes (used for prefix strings, which are bound by the hash of their exact UTF-8 bytes). */
export function sha256OfUtf8(text: string): string {
  return sha256Bytes(Buffer.from(text, 'utf8'));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}
