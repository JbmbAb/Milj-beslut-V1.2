import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import {
  SIGNED_REGISTRY_ORIGIN_PREFIX,
  type AuthorizedSourceBinding,
  type AuthorizedSourceCatalog,
} from '@miljobeslut/mps-knowledge-corpus';

import {
  loadVerifiedSourceRegistry,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from '../../../../packages/mps-data-governance/src/SourceRegistry';

/**
 * K2.2 — the concrete source authority behind the knowledge plane's `AuthorizedSourceCatalog`.
 *
 * Same role, same reason and the same boundary as `SourceRegistryAdmissionAdapter` (K2.1b) one
 * directory over: `mps-knowledge-corpus` is storage-agnostic and imports nothing from
 * `mps-data-governance`, so the ONE place that loads and cryptographically verifies the signed
 * registry for it is this thin server-side adapter. No decision logic lives here; the corpus
 * package owns the outcome classification (`classifySourceAuthority`).
 *
 * AUTONOMY CREATES NO AUTHORITY. This adapter cannot approve a source, cannot invent an entry,
 * and has no fallback: a registry that fails to load or verify throws (fail closed) instead of
 * degrading into "no sources authorized". An EMPTY registry is refused too (`REJECT_EMPTY_REGISTRY`):
 * the loader never consults the trusted keyring for an empty file, so an empty catalog would be
 * indistinguishable from an unverified one and would silently report every governed source as
 * unauthorized under a signed-registry label.
 *
 * ORIGIN IS CONTENT-ADDRESSED, NEVER A PATH. The catalog's `origin` is
 * `signed-source-registry:<sha256 over the verified (source_id, source_content_hash) pairs>` — the
 * SIGNED content only. K2.1b registry design (SourceApproval.ts): `artifact_id` and `lifecycle_state`
 * are NOT covered by the governor signature; they are labels. So a relabel (or an unsigned edit of
 * the label) does not change the catalog identity, while a re-scoped or re-approved source does;
 * the same registry content loaded from two checkouts yields the same origin. The unsigned label
 * is still carried into bindings as `registry_artifact_id` because the K2.1b materialization
 * identity binds it — an inherited property reported, not altered. The file path is metadata.
 *
 * SNAPSHOT SEMANTICS. The registry is loaded and verified ONCE, at creation, and the resulting
 * catalog answers every `resolve()` of one corpus-expansion run from that verified snapshot: one
 * consistent registry state per run, `IS_AUTHORIZED_NOW` at load time, never `WAS_VALID_AT(T)`.
 */
export type VerifiedRegistryLoadOptions = NonNullable<Parameters<typeof loadVerifiedSourceRegistry>[0]>;

export interface VerifiedRegistrySourceCatalog extends AuthorizedSourceCatalog {
  /** Resolved path of the verified registry this snapshot was loaded from (metadata, not identity). */
  readonly registry_path: string;
  /** sha256 over the verified, SIGNED (source_id, source_content_hash) pairs — the content behind `origin`. */
  readonly registry_digest: string;
  /** ISO-8601 time the snapshot was loaded and verified. */
  readonly loaded_at: string;
}

export function bindingFromVerifiedSource(source: VerifiedSourceDefinition): AuthorizedSourceBinding {
  return Object.freeze({
    source_id: source.sourceId,
    registry_artifact_id: source.registryArtifactId,
    registry_source_content_hash: source.sourceContentHash,
    authority_name: source.authority.name,
    authority_type: source.authority.type,
    artifact_types: Object.freeze([...source.artifactTypes]),
    adapter: source.adapter,
    ...(source.channelType !== undefined ? { channel_type: source.channelType } : {}),
  });
}

/** Content digest of a verified registry: what the catalog origin is bound to. */
export function verifiedRegistryDigest(registry: Pick<VerifiedSourceRegistry, 'sources'>): string {
  const triples = registry.sources
    .map((s) => [s.sourceId, s.sourceContentHash] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash('sha256').update(canonicalizeStrict(triples), 'utf8').digest('hex');
}

export async function createVerifiedRegistrySourceCatalog(
  options: VerifiedRegistryLoadOptions & { readonly now?: () => Date } = {},
): Promise<VerifiedRegistrySourceCatalog> {
  const { now, ...load } = options;
  // Deliberately not wrapped in try/catch: `loadVerifiedSourceRegistry` fails the whole load
  // atomically when any entry fails signature/lifecycle verification, and that throw IS the
  // fail-closed signal. Only APPROVED entries are ever materialized by it.
  const registry = await loadVerifiedSourceRegistry(load);
  if (registry.sources.length === 0) {
    throw new Error(
      `REJECT_EMPTY_REGISTRY: the registry at '${registry.registryPath}' verified to zero APPROVED entries; an empty ` +
        'catalog authorizes nothing and cannot be distinguished from an unverified one, so it is refused.',
    );
  }
  const bySourceId = new Map<string, AuthorizedSourceBinding>();
  for (const source of registry.sources) {
    if (bySourceId.has(source.sourceId)) {
      // The loader already refuses duplicate source ids (P2-SR-DUP-ID-01); keep the invariant
      // local so this adapter can never resolve an ambiguous id by position.
      throw new Error(
        `REJECT_AMBIGUOUS_SOURCE_ID: verified registry '${registry.registryPath}' yielded two entries for source_id '${source.sourceId}'.`,
      );
    }
    bySourceId.set(source.sourceId, bindingFromVerifiedSource(source));
  }
  const bindings = Object.freeze([...bySourceId.values()]);
  const digest = verifiedRegistryDigest(registry);
  const loadedAt = (now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    origin: `${SIGNED_REGISTRY_ORIGIN_PREFIX}${digest}`,
    registry_path: registry.registryPath,
    registry_digest: digest,
    loaded_at: loadedAt,
    async resolve(sourceId: string) {
      return bySourceId.get(sourceId) ?? null;
    },
    async list() {
      return bindings;
    },
  });
}
