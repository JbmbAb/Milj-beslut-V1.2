import { ArtifactContract } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export interface RawSourcePayload {
  readonly filename: string;
  readonly original_path: string;
  readonly content_bytes_base64: string;
  readonly observed_at: string;
  readonly authority: string;

  /**
   * 🔴 LEGACY / SEMANTICALLY_UNSPECIFIED — do not populate in new producers.
   *
   * This field has never had a defined meaning. It is a bare string supplied by the caller of
   * `RawSourceIngestor.ingestFile(filePath, authority, policy)`, and every existing caller passes an
   * arbitrary literal ("Policy-v1", "Policy-v2", "MimersBrunn-v2.0.1"). No document under
   * `docs/` defines it.
   *
   * It is explicitly NOT any of the following, and must never be overloaded to mean one:
   *   - SourceRegistry acquisition policy (rate limit / concurrency / retry / object size)
   *   - SourceRegistry artifact identity
   *   - trusted provenance of any kind
   *
   * Optional so that a governed producer is not forced to invent a value. Existing literals
   * remain as legacy data until a separate convergence unit retires them.
   *
   * @deprecated Use `source_governance_artifact_id` for the governance binding.
   */
  readonly policy?: string;

  /**
   * The exact verified SourceRegistry artifact under whose authority this raw material was
   * acquired — e.g. `reg-dv-puh-mmod-002`.
   *
   * Per-object and historical, NOT "whichever registry entry is active today". Material
   * acquired under a superseded authority keeps naming that authority: the 144 objects
   * harvested before the PUH size reissue legitimately carry `reg-dv-puh-mmod-002` while later
   * objects carry `-003`. Rewriting them to the current entry would falsify which signed scope
   * actually authorised the acquisition.
   */
  readonly source_governance_artifact_id: string;

  /**
   * SHA-256 of the acquired BYTES, as recorded by governed quarantine at acquisition time.
   *
   * Distinct from `RawSourceArtifact.content_hash`, which hashes the canonical payload object.
   * The two answer different questions and must never be compared to one another:
   *
   *   source_content_hash            → proves the exact bytes that were acquired
   *   RawSourceArtifact.content_hash → proves the exact canonical LU representation
   */
  readonly source_content_hash: string;
}

export interface RawSourceArtifact extends ArtifactContract {
  readonly artifact_type: "RAW_SOURCE_ARTIFACT";
  readonly payload: RawSourcePayload;
}
