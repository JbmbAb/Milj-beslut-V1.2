import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";

/**
 * Bounded spatial read budget (fail-closed).
 * Retrieval governance decides *what* may be read; this decides *how much*.
 */
export interface SpatialQueryBudget {
  readonly max_layers: number;
  readonly max_features_per_layer: number;
  readonly max_distance_meters: number;
  readonly timeout_ms: number;
  readonly max_bytes?: number;
}

export const DEFAULT_SPATIAL_QUERY_BUDGET: SpatialQueryBudget = Object.freeze({
  max_layers: 8,
  max_features_per_layer: 50,
  max_distance_meters: 2000,
  timeout_ms: 5_000,
  max_bytes: 2_000_000,
});

/**
 * Frozen LU → Spatial Provider request (TV-S / Magic Moment).
 */
export interface SpatialQueryRequest {
  readonly property_ref: ArtifactReference;
  readonly layers: readonly {
    readonly name: string;
    readonly version_hash: string;
  }[];
  readonly buffer_distance_meters?: number;
  readonly budget?: SpatialQueryBudget;
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. When provided, the query point is the referenced
   * LocalizationGeometryArtifact's coordinates instead of the property centroid -- the provider
   * re-resolves and re-validates it from CAS (structure, SRID, and that its
   * `property_context_ref` matches `property_ref`) and REJECTs rather than silently falling back
   * on any mismatch. Omitted only by callers with no explicit localization point yet (e.g.
   * non-LU/GisRiskModule callers), in which case behavior is unchanged: the property centroid.
   */
  readonly location_ref?: ArtifactReference;
}

export const SPATIAL_QUERY_CONTRACT_V2 = "spatial-query-contract-v2" as const;
export const SPATIAL_QUERY_CONTRACT_V3 = "spatial-query-contract-v3" as const;
export const SPATIAL_CANONICAL_VERSION_V3 = "sv-canonical-3" as const;

export type SpatialQuerySubjectV2 =
  | {
      readonly kind: "LOCALIZATION_GEOMETRY";
      readonly property_context_ref: ArtifactReference;
      readonly location_ref: ArtifactReference;
      readonly crs: "EPSG:3006";
    }
  | {
      readonly kind: "PROPERTY_CONTEXT_CENTROID";
      readonly property_context_ref: ArtifactReference;
      readonly crs: "EPSG:3006";
    };

/**
 * Closed, outcome-relevant query semantics for canonical V2 spatial evidence.
 * Operational queue/lease lineage deliberately does not belong here.
 */
export interface SpatialQueryContractV2 {
  readonly query_contract_version: typeof SPATIAL_QUERY_CONTRACT_V2;
  readonly relation: "DWITHIN";
  readonly subject: SpatialQuerySubjectV2;
  readonly parameters: {
    readonly distance_meters: number;
    readonly max_features_per_layer: number;
  };
  readonly selection: {
    readonly predicate_semantics: "EXISTS";
  };
}

/**
 * V3 keeps V2's spatial semantics while making the canonical numeric domain explicit.
 * The canonical version travels with the contract so mismatched version combinations fail
 * before a V3 artifact can receive an identity.
 */
export interface SpatialQueryContractV3 extends Omit<SpatialQueryContractV2, "query_contract_version"> {
  readonly query_contract_version: typeof SPATIAL_QUERY_CONTRACT_V3;
  readonly spatial_canonical_version: typeof SPATIAL_CANONICAL_VERSION_V3;
}

/** V3 admits whole metres only. Zero is a valid exact-intersection ST_DWithin query. */
export function assertSpatialQueryContractV3NumericParameters(parameters: unknown): asserts parameters is {
  readonly distance_meters: number;
  readonly max_features_per_layer: number;
} {
  if (
    !parameters ||
    typeof parameters !== "object" ||
    !Number.isSafeInteger((parameters as { distance_meters?: unknown }).distance_meters) ||
    ((parameters as { distance_meters: number }).distance_meters < 0) ||
    !Number.isSafeInteger((parameters as { max_features_per_layer?: unknown }).max_features_per_layer) ||
    ((parameters as { max_features_per_layer: number }).max_features_per_layer < 1)
  ) {
    throw new Error("REJECT_SPATIAL_QUERY_CONTRACT_V3_NUMERIC_PARAMETERS");
  }
}

/**
 * SEM-1/OD-03 (W2) -- a layer whose evidence could not be technically obtained.
 *
 * Deliberately separate from `SpatialEvidenceArtifact`/`SpatialResultSemantics` (both frozen
 * v1 contracts, untouched by this unit): this is not a spatial result and carries no
 * `result_semantics`, no `exists`, and no identity hash. It exists only to let the caller (and
 * ultimately the rule engine) distinguish "this layer's query technically failed" from "this
 * layer was checked and found nothing" without inventing a fabricated evidence artifact for a
 * query that never actually completed.
 *
 * U30-R2 (LU 72h, owner 2026-10-02: governed artifacts carry a stable machine code and a
 * deterministic, neutral explanation; raw provider text stays internal):
 *  - `reason` is the stable machine code of the cause class. The PostGIS provider reports
 *    `SOURCE_UNAVAILABLE` -- the governed query of the layer could not be executed -- the same
 *    vocabulary the read model uses for a governed NOT_CHECKED finding (coverage_state). It is the
 *    only cause class a NOT_CHECKED layer finding has today: identity/admission failures deny the
 *    whole run instead.
 *  - `diagnostic` is the provider's raw technical text (error class + message, possibly SQL). It
 *    is internal diagnostics for logging only: the rule engine never reads it, it is never part
 *    of a finding, an assessment, replay identity, an HTTP response or a PDF.
 * Neither value changes a byte of the NOT_CHECKED finding: the finding is a function of the layer
 * alone (LURuleEngine), so deterministic re-execution can reproduce it from the attested
 * execution without the cause ever having been pinned.
 */
export interface SpatialLayerUnavailable {
  readonly dataset: string;
  readonly reason: string;
  readonly diagnostic?: string;
}

/**
 * SEM-1/OD-03 (W2) -- `query()`'s versioned outcome contract.
 *
 * V1 (`SpatialEvidenceArtifact[]`, still the type this interface used to declare) had no way to
 * report a partial result: any single layer's technical query failure had to either be silently
 * absorbed into a fabricated result or made to fail the entire batch, discarding every other
 * layer's real evidence. V2 makes that split explicit and mandatory for every caller.
 *
 * `evidence` never contains an entry for a layer listed in `unavailable_layers`, and vice versa
 * -- a layer is in exactly one of the two.
 *
 * This governs only how MANY layers a single `query()` call can report on; it says nothing new
 * about what any individual `SpatialEvidenceArtifact` means (that stays `SpatialResultSemantics`
 * v1, untouched).
 */
export interface SpatialQueryOutcomeV2 {
  readonly evidence: readonly SpatialEvidenceArtifact[];
  readonly unavailable_layers: readonly SpatialLayerUnavailable[];
}

export interface ISpatialProvider {
  query(request: SpatialQueryRequest): Promise<SpatialQueryOutcomeV2>;
}
