/**
 * SOURCE AUTHORITY boundary for the knowledge plane.
 *
 * AUTONOMY CREATES NO AUTHORITY. This module cannot approve a source. It only asks an injected
 * catalog — whose production implementation is backed by `loadVerifiedSourceRegistry` in
 * `mps-data-governance` (the same signed registry K2.1b binds corpus admission to) — whether a
 * stable `source_id` is CURRENTLY an authorized source, and hands back the verified binding.
 *
 * Deliberately storage- and package-agnostic: like `mps-legal-corpus`, this package imports nothing
 * from `mps-data-governance`. The concrete adapter lives on the server side of that boundary
 * (`server/modules/legal/knowledge/VerifiedRegistrySourceCatalogAdapter.ts`), exactly as
 * `SourceRegistryAdmissionAdapter` does for the admission gate.
 *
 * The stable anchor is (source_id, registry_source_content_hash). `registry_artifact_id` is a
 * volatile label re-issued on re-attestation (K2.1b finding: -001/-003 -> -002/-004 while the
 * content hash stayed byte-identical). The knowledge DOCUMENT identity (`kdoc`, DocumentIdentity.ts)
 * therefore binds the content hash and never the artifact id. NOTE, however, that the K2.1b
 * MATERIALIZATION identity (`legal-corpus-record-v2`, buildCanonicalLegalCorpusRecordKey) DOES bind
 * `registry_artifact_id` by its own design: a relabel keeps every document_id but re-keys every
 * canonical_record_key, i.e. forces re-materialization. K2.2 does not alter that kernel; it makes the
 * consequence explicit (`planIncrementalRebuild().relabeled`) instead of hiding it.
 *
 * ORIGIN NAMESPACES. A catalog's `origin` is recorded into every provenance chain and is compared
 * for equality by the snapshot/index layers, so it must say WHAT KIND of authority it is:
 *   - `signed-source-registry:<content digest>`  — only the server adapter over the verified, signed
 *     registry may produce this (content-addressed, never a path).
 *   - `static:<label>`                             — an in-memory catalog; NOT authority.
 * `createStaticAuthorizedSourceCatalog` refuses any other namespace, so a static catalog can never
 * carry the signed registry's origin string into provenance.
 */
export const SIGNED_REGISTRY_ORIGIN_PREFIX = 'signed-source-registry:' as const;
export const STATIC_CATALOG_ORIGIN_PREFIX = 'static:' as const;

export interface AuthorizedSourceBinding {
  readonly source_id: string;
  /** The currently active artifact id — a label, re-issued on re-attestation; not identity. */
  readonly registry_artifact_id: string;
  /** sha256(canonicalizeStrict(entry minus attestation)) — the stable, signed content anchor. */
  readonly registry_source_content_hash: string;
  readonly authority_name: string;
  readonly authority_type: 'court' | 'county_board' | 'municipality' | 'other';
  /** The artifact types the registry entry declares this source may yield (e.g. LAW, ORDINANCE). */
  readonly artifact_types: readonly string[];
  readonly adapter: string;
  readonly channel_type?: string;
}

export interface AuthorizedSourceCatalog {
  /**
   * Returns the ACTIVE verified binding for `sourceId`, or null when no currently-approved entry
   * exists. MUST throw — never return null or an empty list — when the catalog itself cannot be
   * loaded or verified; a swallowed failure here would turn "authority unavailable" into
   * "source not authorized", which is a different, weaker claim.
   */
  resolve(sourceId: string): Promise<AuthorizedSourceBinding | null>;
  list(): Promise<readonly AuthorizedSourceBinding[]>;
  /** Human-readable origin of this catalog, carried into provenance (e.g. a registry path or a fixture label). */
  readonly origin: string;
}

export type SourceAuthorityOutcome =
  | { readonly kind: 'AUTHORIZED'; readonly binding: AuthorizedSourceBinding }
  /** Not a unit blocker: the source is skipped and reported as a candidate for a future owner decision. */
  | { readonly kind: 'SOURCE_AUTHORITY_REQUIRED'; readonly source_id: string; readonly detail: string }
  /** The source IS approved, but its signed scope hash differs from what the caller expected: review, not auto-rebind. */
  | { readonly kind: 'SOURCE_SCOPE_CHANGED'; readonly source_id: string; readonly detail: string }
  /** The catalog could not be loaded/verified at all. Fail closed: nothing is authorized. */
  | { readonly kind: 'AUTHORITY_UNAVAILABLE'; readonly detail: string };

// Mirrors K2.1b(2) `resolveActiveRegistryBinding` (server/modules/legal/materialization) as an OUTCOME
// instead of a throw, on purpose: this package cannot import server code, and the knowledge plane
// needs "skip and report" for unauthorized sources (SOURCE_AUTHORITY_REQUIRED), not an abort.
export async function classifySourceAuthority(
  catalog: AuthorizedSourceCatalog,
  sourceId: string,
  expectedSourceContentHash?: string,
): Promise<SourceAuthorityOutcome> {
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    return { kind: 'SOURCE_AUTHORITY_REQUIRED', source_id: String(sourceId), detail: 'empty source_id' };
  }
  let binding: AuthorizedSourceBinding | null;
  try {
    binding = await catalog.resolve(sourceId);
  } catch (err) {
    return {
      kind: 'AUTHORITY_UNAVAILABLE',
      detail: `authorized source catalog '${catalog.origin}' could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!binding) {
    return {
      kind: 'SOURCE_AUTHORITY_REQUIRED',
      source_id: sourceId,
      detail: `source_id '${sourceId}' is not a currently authorized entry in '${catalog.origin}'.`,
    };
  }
  if (
    expectedSourceContentHash !== undefined &&
    expectedSourceContentHash !== binding.registry_source_content_hash
  ) {
    return {
      kind: 'SOURCE_SCOPE_CHANGED',
      source_id: sourceId,
      detail:
        `source_id '${sourceId}' resolves to artifact '${binding.registry_artifact_id}', but its signed ` +
        `source_content_hash '${binding.registry_source_content_hash}' differs from the expected ` +
        `'${expectedSourceContentHash}'. A re-label is tolerated; a re-scope requires review.`,
    };
  }
  return { kind: 'AUTHORIZED', binding };
}

/**
 * In-memory catalog over already-resolved bindings.
 *
 * ⚠️ NOT AN AUTHORITY. This performs no verification. It exists for (a) tests, and (b) composition
 * roots that have ALREADY loaded and verified the registry through `loadVerifiedSourceRegistry`
 * and want a stable snapshot for one run. Its `origin` is recorded into every provenance chain it
 * touches so a snapshot built from a fixture can never be mistaken for the signed registry.
 */
export function createStaticAuthorizedSourceCatalog(
  bindings: readonly AuthorizedSourceBinding[],
  origin: string,
): AuthorizedSourceCatalog {
  if (!origin.startsWith(STATIC_CATALOG_ORIGIN_PREFIX)) {
    throw new Error(
      `REJECT_STATIC_ORIGIN: a static catalog's origin must start with '${STATIC_CATALOG_ORIGIN_PREFIX}' (got '${origin}'); ` +
        `it is not authority and may never carry the '${SIGNED_REGISTRY_ORIGIN_PREFIX}' namespace.`,
    );
  }
  const bySourceId = new Map<string, AuthorizedSourceBinding>();
  for (const binding of bindings) {
    if (bySourceId.has(binding.source_id)) {
      // Same rule as the registry loader (P2-SR-DUP-ID-01): ambiguity is refused, not resolved by position.
      throw new Error(
        `REJECT_AMBIGUOUS_SOURCE_ID: catalog '${origin}' carries two bindings for source_id '${binding.source_id}'.`,
      );
    }
    bySourceId.set(
      binding.source_id,
      Object.freeze({ ...binding, artifact_types: Object.freeze([...binding.artifact_types]) }),
    );
  }
  const frozen = Object.freeze([...bySourceId.values()]);
  return {
    origin,
    async resolve(sourceId) {
      return bySourceId.get(sourceId) ?? null;
    },
    async list() {
      return frozen;
    },
  };
}
