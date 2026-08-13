import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";
import type { SpatialResultSemantics } from "./SpatialResultSemantics";
import type { SpatialEngineFingerprint } from "./SpatialEngineFingerprint";

export interface SpatialEvidencePayload {
  /**
   * P4A-LU-S6 — what spatial truth this artifact claims to carry.
   *
   * MANDATORY. An artifact that does not declare its result semantics leaves the reader to
   * infer them, which is how a fabricated 2 mm envelope came to be read as a spatial result.
   *
   * @see ./SpatialResultSemantics.ts (OWNER FREEZE 2026-08-13)
   */
  readonly result_semantics: SpatialResultSemantics;
  readonly property_ref: ArtifactReference;
  readonly layer_ref: {
    readonly layer_id: string;
    /**
     * P4A-LU-S4 — authoritative dataset/layer content identity.
     *
     * This is the hash of the governed source/dataset artifact that materialized the PostGIS
     * layer. It is not a human version label, table name, or import date.
     */
    readonly version_hash: string;
    /** Human-readable label only; it is deliberately not an identity input. */
    readonly layer_version: string;
  };
  /** Coordinate reference system of `geometry`; SWEREF99 TM is 3006. */
  readonly srid: number;
  /** What was computed, and by which engine (TV-S1 SV-I03). */
  readonly operation: {
    readonly algorithm: string;
    readonly engine: string;
    /**
     * P4A-LU-S1/S3: exact versions of the full stack, never a wildcard or a partial set.
     * Typed as a total record so an incomplete fingerprint is a compile error.
     */
    readonly engine_fingerprint: SpatialEngineFingerprint;
  };
  /**
   * S6: `null` whenever the execution retrieved no geometry. Under
   * `EXISTENCE_WITHIN_DISTANCE` it is ALWAYS null, and that is enforced at identity time —
   * see `computeSpatialEvidenceHash`.
   */
  readonly geometry: CanonicalGeometry | null;
  /** `retrieved_at` is provenance and stays outside the identity domain (SV-I06). */
  readonly source_metadata: {
    readonly provider: string;
    readonly dataset: string;
    readonly dataset_version: string;
    readonly retrieved_at: string; // ISO8601
  };
  readonly query_context: {
    readonly query_id: string;
    readonly query_type: string;
    readonly parameters: Record<string, any>;
  };
}

export interface SpatialEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "SPATIAL_EVIDENCE";
  readonly payload: SpatialEvidencePayload;
}
