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

export interface ISpatialProvider {
  query(request: SpatialQueryRequest): Promise<SpatialEvidenceArtifact[]>;
}
