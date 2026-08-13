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
  readonly generated_at: Timestamp;
}

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
  }): Promise<readonly DownloadTarget[]>;
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
