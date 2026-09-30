/**
 * PATTERN-PROOF-ENGINE-01 V1 -- canonical identity of artifacts.
 *
 * Reuses mimers-brunn-core's canonicalization + hashing (frozen design section 13: no parallel
 * signing/hashing model). Every PPE digest is `sha256:<64 hex>` over `canonicalizeStrict(value)`.
 * The CAS envelope's `content_hash` is the SAME digest expressed as `{ algorithm, value }` so that a
 * persisted artifact's content hash and its PPE identity can never disagree.
 */
import { canonicalizeStrict, hashCanonicalValue } from '@miljobeslut/mimers-brunn-core';
import { PatternProofError } from './errors';

export type Digest = `sha256:${string}`;

/** Structurally identical to mps-compliance's ContentHash (what ArtifactRepositoryPort.put expects). */
export interface PatternProofContentHash {
  readonly algorithm: 'sha256';
  readonly value: string;
}

export const PATTERN_PROOF_ARTIFACT_KINDS = [
  'discovery',
  'dependency-graph',
  'decision-gate',
  'red-plan',
  'candidate',
  'pattern-verification',
  'input-manifest',
  'proof-package',
] as const;

export type PatternProofArtifactKind = (typeof PATTERN_PROOF_ARTIFACT_KINDS)[number];

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && DIGEST_RE.test(value);
}

/**
 * Fails closed on anything canonicalizeStrict cannot serialize deterministically (undefined-valued
 * keys, Date, class instances, functions, bigint, circular references). It never strips or coerces.
 */
export function digestOf(value: unknown): Digest {
  try {
    // canonicalizeStrict is the authority on what is serializable; hashCanonicalValue re-runs it.
    canonicalizeStrict(value);
  } catch (error) {
    throw new PatternProofError('PPE_DIGEST_INPUT_INVALID', (error as Error).message);
  }
  const digest = hashCanonicalValue(value, 'sha256');
  if (!isDigest(digest)) {
    throw new PatternProofError('PPE_DIGEST_INPUT_INVALID', `unexpected digest format: ${digest}`);
  }
  return digest;
}

export function contentHashOf(value: unknown): PatternProofContentHash {
  const digest = digestOf(value);
  return Object.freeze({ algorithm: 'sha256', value: digest.slice('sha256:'.length) });
}

export function digestToContentHash(digest: Digest): PatternProofContentHash {
  if (!isDigest(digest)) throw new PatternProofError('PPE_DIGEST_INPUT_INVALID', `not a digest: ${digest}`);
  return Object.freeze({ algorithm: 'sha256', value: digest.slice('sha256:'.length) });
}

export function contentHashToDigest(hash: PatternProofContentHash): Digest {
  const digest = `sha256:${hash.value}`;
  if (!isDigest(digest))
    throw new PatternProofError('PPE_DIGEST_INPUT_INVALID', `not a content hash: ${hash.value}`);
  return digest;
}

/** Content-addressed artifact id: `ppe:<kind>:<hex>`. Same body => same id (WORM-friendly). */
export function artifactIdFor(kind: PatternProofArtifactKind, digest: Digest): string {
  if (!isDigest(digest)) throw new PatternProofError('PPE_DIGEST_INPUT_INVALID', `not a digest: ${digest}`);
  return `ppe:${kind}:${digest.slice('sha256:'.length)}`;
}

/** ArtifactReference.artifact_type for the kernel repository (free string per mps-compliance). */
export function artifactTypeFor(kind: PatternProofArtifactKind): string {
  return `PPE_${kind.toUpperCase().replace(/-/g, '_')}`;
}

export function isPatternProofArtifactKind(value: unknown): value is PatternProofArtifactKind {
  return typeof value === 'string' && (PATTERN_PROOF_ARTIFACT_KINDS as readonly string[]).includes(value);
}
