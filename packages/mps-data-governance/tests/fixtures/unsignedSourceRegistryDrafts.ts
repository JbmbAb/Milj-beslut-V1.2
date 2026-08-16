import type { SourceRegistryArtifact } from '../../src/SourceRegistry';

/**
 * ⚠️ TEST FIXTURE — NOT AUTHORITY, NOT A SIGNING INTERMEDIATE.
 *
 * Unsigned SourceRegistryArtifact shapes for tests that need to mint their own signed registry
 * with a throwaway key. Nothing here is APPROVED, nothing carries an attestation, and nothing
 * may be installed as a registry.
 *
 * These tests previously read `source-registry/drafts/*.json` directly. That directory is the
 * owner's signing workspace and is deliberately gitignored pending a retention decision, so a
 * clean checkout had no such files and two committed proofs failed with ENOENT — a reproducibility
 * defect found by CLEAN_CHECKOUT_DEPENDENCY_RECON-01.
 *
 * The two roles must not be the same file:
 *
 *   source-registry/drafts/   owner / signing workspace, ignored, retention undecided
 *   tests/fixtures/           deterministic test material, tracked, owned by the tests
 *
 * A `.ts` module rather than JSON on purpose: `*.json` is ignored repo-wide, so a JSON fixture
 * would need a `.gitignore` exception and would reintroduce exactly the coupling this removes.
 *
 * Values mirror the real drafts closely enough that the proofs remain meaningful — the PUH entry
 * really is a PUH_RATTSPRAXIS_V1 API source and the SFS entry really is a SINGLE_ENDPOINT_V1
 * website source — but they are fixtures, and divergence from the production registry is
 * expected and harmless.
 */

/** Domstolsverket PUH / MMÖD — the two-stage API adapter shape. */
export const PUH_DRAFT_FIXTURE: SourceRegistryArtifact = {
  artifact_id: 'reg-dv-puh-mmod-001',
  artifact_type: 'SOURCE_REGISTRY_ENTRY',
  source_id: 'domstolsverket-puh-mmod',
  producer: { producer_id: 'DV', name: 'Domstolsverket', type: 'agency' },
  channel: {
    channel_type: 'API',
    endpoint_url:
      'https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar' +
      '?domstolkod=MMOD&publiceringstyper=dom_eller_beslut&publicerad_fran_och_med=2025-03-04',
    allowed_domains: ['rattspraxis.etjanst.domstol.se'],
  },
  adapter: 'PUH_RATTSPRAXIS_V1',
  artifact_types: ['decision'],
  collection_frequency: 'DAILY',
  change_detection: { strategy: 'CONTENT_HASH' },
  policy: {
    rate_limit_requests_per_second: 1,
    concurrency_limit: 1,
    politeness_delay_ms: 1000,
    max_object_size_bytes: 52428800,
    retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
  },
  geographic_scope: 'Sweden',
  lifecycle_state: 'REGISTERED',
} as SourceRegistryArtifact;

/** Regeringskansliet SFS 1998:808 — the single-endpoint website shape. */
export const SFS_DRAFT_FIXTURE: SourceRegistryArtifact = {
  artifact_id: 'reg-rk-sfs-1998-808-001',
  artifact_type: 'SOURCE_REGISTRY_ENTRY',
  source_id: 'regeringskansliet-sfs-1998-808',
  producer: { producer_id: 'RK', name: 'Regeringskansliet', type: 'agency' },
  channel: {
    channel_type: 'WEBSITE',
    endpoint_url: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
    allowed_domains: ['rkrattsbaser.gov.se'],
  },
  adapter: 'SINGLE_ENDPOINT_V1',
  artifact_types: ['LAW'],
  collection_frequency: 'DAILY',
  change_detection: { strategy: 'CONTENT_HASH' },
  policy: {
    rate_limit_requests_per_second: 1,
    concurrency_limit: 1,
    politeness_delay_ms: 1000,
    max_object_size_bytes: 10485760,
    retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
  },
  geographic_scope: 'Sweden',
  lifecycle_state: 'REGISTERED',
} as SourceRegistryArtifact;

/** A fresh copy per call — `approveSourceRegistryEntry` must never mutate a shared fixture. */
export function unsignedDraftFixture(which: 'puh' | 'sfs'): SourceRegistryArtifact {
  return structuredClone(which === 'puh' ? PUH_DRAFT_FIXTURE : SFS_DRAFT_FIXTURE);
}
