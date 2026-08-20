import type { Timestamp } from "../../mps-core/src/types";

/**
 * 🜃 P2 — Governed download pipeline contracts.
 *
 * The pipeline implements the EXISTING `HarvestExecutor` port. It introduces no source
 * authority of its own: approval, URL scope and rate policy all come from
 * `VerifiedSourceRegistry`, which already refuses anything that is not APPROVED. A second
 * authority model here would be the P1 bypass this programme has spent considerable effort
 * closing.
 *
 * Landing zone is quarantine, never canonical CAS. Nothing in this module can reach CAS — not
 * by convention, but because it is given no CAS port at all.
 *
 * @see ./HarvestOrchestratorContracts.ts (HarvestExecutor)
 * @see ./SourceRegistry.ts (verifySourceRegistryArtifact — APPROVED gate)
 * @see ../../mimers-brunn-core/src/governance/QuarantineStorage.ts
 */

/**
 * The only way this pipeline can reach a network.
 *
 * Injected rather than calling `fetch` directly so that (a) tests exercise the real control
 * flow without network access, and (b) the class has no ambient capability to reach anything
 * the caller did not hand it.
 */
export interface DownloadTransport {
  get(
    url: string,
    options: { readonly timeout_ms: number; readonly max_bytes?: number },
  ): Promise<DownloadResponse>;
}

export interface DownloadResponse {
  readonly status: number;
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/** One object requested from a source. Named by the caller; validated against the source. */
export interface DownloadTarget {
  readonly url: string;
  readonly file_name: string;
  /**
   * P3-PUH-METADATA-CARRIAGE-01 — verbatim metadata the adapter observed on the source's own
   * response, carried through to quarantine.
   *
   * Provenance transport, NOT classification. Every value must be exactly what the source
   * returned: no normalization into a downstream vocabulary, no parsing of file names, no
   * inference. Interpretation is a separate, owner-frozen mapping.
   *
   * This exists because the information was previously destroyed at acquisition. A PUH
   * publication carries the fields that determine what a document IS, but `DownloadTarget` had
   * nowhere to put them, so they were dropped before the executor saw them — leaving 514
   * harvested judgments that cannot be classified without re-harvesting.
   *
   * Copied verbatim to quarantine and the persisted manifest body for replayable provenance.
   * It remains excluded from manifest *identity*: raw object hashes, not mutable listing
   * observations, establish the acquired byte identity.
   */
  readonly source_metadata?: Readonly<Record<string, string>>;
}

/**
 * One landed object.
 *
 * `quarantine_id` — never an `artifact_id`. Quarantined bytes are not artifacts and must not
 * be referable as if they were.
 */
export interface DownloadedObject {
  readonly quarantine_id: string;
  readonly source_id: string;
  readonly url: string;
  readonly file_name: string;
  readonly content_hash: string;
  readonly byte_length: number;
  /** Adapter-observed listing provenance for this object. Never used as authority or byte identity. */
  readonly source_metadata?: Readonly<Record<string, string>>;
  /** True when the identical bytes were already quarantined — idempotency, not an error. */
  readonly deduplicated: boolean;
  readonly attempts: number;
}

/**
 * Provenance record for one download run.
 *
 * `generated_at` is provenance and is EXCLUDED from the manifest hash, following the same rule
 * as SV-I06 elsewhere in this codebase: an identical re-run must be recognisable as the same
 * download, otherwise idempotency is unobservable and replay can never match.
 */
export interface DownloadManifest {
  readonly manifest_version: 1;
  readonly execution_id: string;
  readonly source_id: string;
  /** Binds the exact registry entry that authorised this run. */
  readonly source_content_hash: string;
  readonly registry_artifact_id: string;
  readonly objects: readonly DownloadedObject[];
  /**
   * Present only on a verified no-change run.
   *
   * This is what makes "ran, nothing new" distinguishable from "never ran": a manifest exists
   * either way, and this field says which it was. Without it the two are the same absence.
   */
  readonly no_changes?: NoChangesEvidence;
  readonly generated_at: Timestamp;
}

/**
 * P2-EMPTY-PLAN-01 — evidence that an empty result was OBSERVED, not merely produced.
 *
 * A daily legal harvest has ordinary days with nothing new. But an empty array is also what a
 * broken resolver returns, so emptiness alone cannot mean success. The difference is whether
 * the source was actually consulted and answered.
 *
 * The executor cannot check this for itself — it never sees the listing — so the resolver
 * asserts it. The assertion is attributable and checked for internal consistency, which is
 * weaker than verification but is the honest shape: only the component that made the requests
 * can testify that they succeeded.
 */
export interface NoChangesEvidence {
  /** Listing pages fetched and parsed successfully. Zero would mean nothing was consulted. */
  readonly pages_examined: number;
  /** Items the listing returned across those pages. May be > 0 with no downloadable objects. */
  readonly items_observed: number;
  /** Targets produced. MUST be 0 — otherwise this is not a no-change run. */
  readonly targets_produced: number;
  /** The first listing URL consulted, so the claim can be traced to a scope. */
  readonly listing_url: string;
}

/**
 * What a resolver returns.
 *
 * `TARGETS` with an empty array remains a rejection: a resolver that produced nothing without
 * saying it verified nothing is indistinguishable from a broken one.
 */
export type ResolvedDownloadPlan =
  | { readonly kind: "TARGETS"; readonly targets: readonly DownloadTarget[] }
  | { readonly kind: "NO_CHANGES"; readonly evidence: NoChangesEvidence };

export interface DownloadTargetResolver {
  /**
   * Resolves an orchestrator request into the concrete objects to fetch.
   *
   * Separate from the executor because deciding WHAT to fetch is adapter-specific (a WFS
   * capabilities crawl differs from a dataset-portal listing), while HOW to fetch it under
   * policy is not. Mixing them would push adapter logic into the governed path.
   */
  resolve(input: {
    readonly source_id: string;
    readonly execution_id: string;
  }): Promise<ResolvedDownloadPlan>;
}

export class GovernedDownloadError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = "GovernedDownloadError";
  }
}
