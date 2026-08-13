import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

/**
 * 🜃 Spatial result semantics (P4A-LU-S6)
 *
 * OWNER FREEZE 2026-08-13 — SPATIAL RESULT SEMANTICS v1.
 *
 * A SpatialEvidenceArtifact SHALL declare what spatial truth it carries. The defect this
 * closes was not a serialization bug: the provider executes `SELECT 1 AS hit`, which returns
 * existence and nothing else, while the artifact implied it carried a result geometry. The
 * fabricated ±0.001 m envelope was the symptom of that contract mismatch, not its cause.
 *
 *   SQL execution      → returns existence only
 *   artifact contract  → implied spatial result geometry
 *
 * FROZEN PRINCIPLE:
 *
 *   SpatialEvidence identity SHALL bind the declared result semantics.
 *
 * so that, even when every other input coincides:
 *
 *   EXISTENCE_WITHIN_DISTANCE ≠ FEATURE_GEOMETRY ≠ DISTANCE_WITNESS ≠ SEARCH_BUFFER
 *
 * A later need for real geometry becomes a NEW artifact semantics with a new identity, never a
 * silent reinterpretation of evidence already produced.
 *
 * NOT YET WIRED. This file is the contract form only. `SpatialEvidencePayload` is deliberately
 * left untouched in this work unit — making the field required is a migration that touches every
 * producer and fixture at once, and the frozen order puts it after this decision, not with it.
 *
 * @see docs/architecture/P4A-LU-E1-SPATIAL-EVIDENCE-SEMANTICS-2026-08-13.md
 * @see docs/architecture/P4A-LU-GATE-CONTRACT-2026-08-11.md
 */

/**
 * Versioned vocabulary of spatial truths an artifact may claim.
 *
 * All four are named because identity must be able to tell them apart. Only the admitted set
 * below may be produced — naming a kind is not admitting it.
 */
export type SpatialResultSemanticsKind =
  | "EXISTENCE_WITHIN_DISTANCE"
  | "FEATURE_GEOMETRY"
  | "DISTANCE_WITNESS"
  | "SEARCH_BUFFER";

/**
 * v1 admits existence only — it is the single semantics the current LU question actually asks
 * ("finns skyddat område / vatten / EBH inom X meter?") and the only one the executed SQL can
 * truthfully support.
 *
 * Same discipline as `DOCUMENT_FACT_VERIFICATION_POLICY_V1`: the vocabulary may grow without the
 * artifact model changing, and a kind becomes producible only when there is an implementation
 * that can honestly populate it.
 */
export interface SpatialResultSemanticsPolicy {
  readonly policy_version: string;
  readonly admitted_kinds: readonly SpatialResultSemanticsKind[];
}

export const SPATIAL_RESULT_SEMANTICS_POLICY_V1: SpatialResultSemanticsPolicy = {
  policy_version: "spatial-result-semantics/v1",
  admitted_kinds: ["EXISTENCE_WITHIN_DISTANCE"],
};

/**
 * The question that was executed.
 *
 * `distance_meters` is the EFFECTIVE executed distance. Today requested == executed because an
 * over-budget request fails closed rather than being clipped (B1a), but the field is defined as
 * effective so that a future clipping implementation cannot quietly diverge from identity.
 */
export interface ExistenceWithinDistanceQuery {
  readonly subject_ref: ArtifactReference;
  readonly srid: number;
  readonly distance_meters: number;
}

/**
 * The answer that was obtained.
 *
 * `max_features_per_layer` lives here, not in a budget block, because it is executed as
 * `LIMIT` and therefore changes the result set. B1b — a result-shaping parameter left outside
 * identity lets two differently-executed runs share an identity. Binding the semantics binds it.
 */
export interface ExistenceWithinDistanceResult {
  readonly exists: boolean;
  readonly match_count_observed: number;
  readonly max_features_per_layer: number;
}

/**
 * Optional corroboration. Absent unless the provider actually computed it — a witness field
 * populated by inference would reintroduce exactly the fabrication S6 exists to remove.
 */
export interface ExistenceWithinDistanceWitness {
  readonly nearest_distance_meters?: number;
  readonly matched_feature_ref?: ArtifactReference;
  readonly layer_feature_id?: string;
}

export interface ExistenceWithinDistanceSemantics {
  readonly kind: "EXISTENCE_WITHIN_DISTANCE";
  readonly query: ExistenceWithinDistanceQuery;
  readonly result: ExistenceWithinDistanceResult;
  readonly witness?: ExistenceWithinDistanceWitness;
}

/** v1 union. Widens only when a kind is admitted by policy AND implementable. */
export type SpatialResultSemantics = ExistenceWithinDistanceSemantics;

/**
 * Under EXISTENCE_WITHIN_DISTANCE the artifact SHALL carry no geometry.
 *
 * This is the truthfulness invariant in one line: the executed query retrieved no geometry, so
 * any non-null geometry on such an artifact is fabricated by definition.
 */
export function assertGeometryMatchesSemantics(
  semantics: SpatialResultSemantics,
  geometry: unknown,
): void {
  if (semantics.kind === "EXISTENCE_WITHIN_DISTANCE" && geometry != null) {
    throw new Error(
      "REJECT_SPATIAL_SEMANTICS: EXISTENCE_WITHIN_DISTANCE carries no geometry; the executed " +
        "query retrieves none, so a non-null geometry here is fabricated.",
    );
  }
}

export function isAdmittedSemanticsKind(
  kind: SpatialResultSemanticsKind,
  policy: SpatialResultSemanticsPolicy = SPATIAL_RESULT_SEMANTICS_POLICY_V1,
): boolean {
  return policy.admitted_kinds.includes(kind);
}
