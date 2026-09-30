/**
 * PATTERN-PROOF-ENGINE-01 V1 -- persistence through the EXISTING CAS-backed artifact repository.
 *
 * Frozen design section 13: "Reuse entirely for DiscoveryArtifact/DependencyGraphArtifact/
 * CandidateArtifact/ProofPackage persistence, not a new store". This module is the ONLY file in the
 * package that calls `.put(`, and it does so on the injected `ArtifactRepositoryPort` under the
 * variable name `repository` (plan constraint 7a; admitted in scripts/audit/master-boundary-audit
 * AUTHORIZED_CAS_WRITERS with a dated comment, plan D5). It writes no files (constraint 7b).
 *
 * The port's `put()` neither computes nor verifies `content_hash` (reuse-apis fact), so identity is
 * computed HERE with ./identity.ts: artifact_id = `ppe:<kind>:<hex>` and content_hash = the same
 * digest, which makes storage content-addressed and WORM-friendly (same body => same id; different
 * body under an existing id => the backend's WORM violation, which this module never catches).
 * `loadArtifact` recomputes the content hash on read and fails closed on any mismatch.
 */
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { PatternProofError } from './errors';
import type { EvidenceLocator } from './evidence';
import {
  artifactIdFor,
  artifactTypeFor,
  contentHashOf,
  digestOf,
  isPatternProofArtifactKind,
  PATTERN_PROOF_ARTIFACT_KINDS,
  type Digest,
  type PatternProofArtifactKind,
  type PatternProofContentHash,
} from './identity';
import type { PatternProofArtifactByKind } from './artifacts';
import { validateArtifact } from './validators';

export interface PersistedArtifactRef {
  readonly kind: PatternProofArtifactKind;
  readonly artifactId: string;
  readonly artifactType: string;
  readonly contentHash: PatternProofContentHash;
  readonly digest: Digest;
  /** `{ kind: 'cas_artifact', ref: artifactId }` -- what other artifacts cite. */
  readonly locator: EvidenceLocator;
}

const ARTIFACT_ID_RE = /^ppe:([a-z-]+):([0-9a-f]{64})$/;

/** Inverse of ./identity.ts `artifactTypeFor`; undefined for a type this package does not own. */
export function kindFromArtifactType(artifactType: string): PatternProofArtifactKind | undefined {
  return PATTERN_PROOF_ARTIFACT_KINDS.find((kind) => artifactTypeFor(kind) === artifactType);
}

/**
 * Rebuilds the full reference from a content-addressed id (`ppe:<kind>:<hex>`): the hex IS the
 * content hash, so a `cas_artifact` locator's `ref` alone identifies kind, type and expected hash.
 */
export function persistedRefFromArtifactId(artifactId: string): PersistedArtifactRef {
  const match = ARTIFACT_ID_RE.exec(artifactId);
  if (!match || !isPatternProofArtifactKind(match[1])) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', `not a PPE artifact id: ${artifactId}`);
  }
  const kind = match[1];
  const digest: Digest = `sha256:${match[2]}`;
  return Object.freeze({
    kind,
    artifactId,
    artifactType: artifactTypeFor(kind),
    contentHash: Object.freeze({ algorithm: 'sha256' as const, value: match[2] }),
    digest,
    locator: Object.freeze({ kind: 'cas_artifact' as const, ref: artifactId }),
  });
}

function buildRef(
  kind: PatternProofArtifactKind,
  artifactId: string,
  artifactType: string,
  digest: Digest,
): PersistedArtifactRef {
  return Object.freeze({
    kind,
    artifactId,
    artifactType,
    contentHash: Object.freeze({ algorithm: 'sha256' as const, value: digest.slice('sha256:'.length) }),
    digest,
    locator: Object.freeze({ kind: 'cas_artifact' as const, ref: artifactId }),
  });
}

export class PatternProofArtifactStore {
  private readonly repository: ArtifactRepositoryPort;

  constructor(options: { readonly repository: ArtifactRepositoryPort }) {
    this.repository = options.repository;
  }

  /**
   * Validates `artifact` as `kind`, then persists the FROZEN validated copy under its
   * content-addressed id. Persisting the same artifact twice is idempotent (same bytes, same id).
   */
  async persistArtifact<K extends PatternProofArtifactKind>(
    kind: K,
    artifact: unknown,
  ): Promise<PersistedArtifactRef> {
    const validated: PatternProofArtifactByKind[K] = validateArtifact(kind, artifact);
    const digest = digestOf(validated);
    const artifactId = artifactIdFor(kind, digest);
    return this.persistUnderId(artifactId, artifactTypeFor(kind), validated);
  }

  /**
   * Raw persist under an EXPLICIT id and type: the body is NOT re-validated and the id is NOT
   * derived from the body. This is the primitive the FALSIFIED fixture uses to attempt a re-put of
   * a modified candidate under the ORIGINAL id so that the backend's WORM check fires (frozen design
   * section 6: a candidate is never edited in place). The backend error is deliberately not caught.
   * `artifactType` must be one this package owns (so the returned ref carries a kind).
   */
  async persistUnderId(
    artifactId: string,
    artifactType: string,
    body: unknown,
  ): Promise<PersistedArtifactRef> {
    const kind = kindFromArtifactType(artifactType);
    if (kind === undefined) {
      throw new PatternProofError('PPE_SCHEMA_INVALID', `not a PPE artifact type: ${artifactType}`);
    }
    if (typeof artifactId !== 'string' || artifactId.trim().length === 0) {
      throw new PatternProofError('PPE_SCHEMA_INVALID', 'artifactId must be a non-empty string');
    }
    const digest = digestOf(body);
    const contentHash = contentHashOf(body);
    const { repository } = this;
    await repository.put({ artifact_id: artifactId, content_hash: contentHash, body });
    return buildRef(kind, artifactId, artifactType, digest);
  }

  /**
   * Resolves by reference, recomputes the content hash of the stored body and compares it to the
   * reference (fail closed: PPE_CONTENT_HASH_MISMATCH), then re-validates by kind and returns the
   * frozen artifact. A body that is stored but no longer valid is a PatternProofError as well.
   */
  async loadArtifact<K extends PatternProofArtifactKind>(
    ref: PersistedArtifactRef & { readonly kind: K },
  ): Promise<PatternProofArtifactByKind[K]> {
    const { repository } = this;
    let body: unknown;
    try {
      body = await repository.resolve<unknown>({
        artifact_id: ref.artifactId,
        artifact_type: ref.artifactType,
      });
    } catch (error) {
      throw new PatternProofError('PPE_ARTIFACT_NOT_FOUND', (error as Error).message, {
        details: { artifactId: ref.artifactId },
      });
    }
    const actual = contentHashOf(body);
    if (actual.value !== ref.contentHash.value || ref.contentHash.algorithm !== 'sha256') {
      throw new PatternProofError(
        'PPE_CONTENT_HASH_MISMATCH',
        `stored body hashes to sha256:${actual.value}, reference says ${ref.contentHash.algorithm}:${ref.contentHash.value}`,
        { details: { artifactId: ref.artifactId } },
      );
    }
    return validateArtifact(ref.kind, body);
  }

  /**
   * `ArtifactRepositoryPort` exposes no `exists`; this is `resolve` + catch -> false. It answers
   * presence only -- it does NOT verify content (use `loadArtifact` for that).
   */
  async exists(ref: Pick<PersistedArtifactRef, 'artifactId' | 'artifactType'>): Promise<boolean> {
    const { repository } = this;
    try {
      await repository.resolve<unknown>({ artifact_id: ref.artifactId, artifact_type: ref.artifactType });
      return true;
    } catch {
      return false;
    }
  }
}
