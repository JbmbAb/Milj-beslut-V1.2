/**
 * W-U20CDF5 (U20CDF4 verification L2; owner decision 2026-10-02: assessment_contract_version is the epoch
 * marker). A V2+ (V3/V4) LocalizationAssessmentArtifact records every governed layer -- the product producer
 * queries all five and pins a negative answer too -- so a V3 test fixture that should read back as a VALID
 * current assessment pins one evidence per layer. These are content-addressed NEGATIVE spatial evidence
 * artifacts (V3 query contract), identity-checked by the read-back exactly like the provider's.
 *
 * Test helper only: builds artifacts in memory; reads and writes nothing.
 */
import { buildSpatialEvidenceContentHash, SPATIAL_STACK_V1 } from '@miljobeslut/mps-lu';

export const GOVERNED_LAYERS_U20CDF5 = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;

const DATASET_HASH = '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc';

export interface NegativeLayerEvidence {
  readonly artifact_id: string;
  readonly artifact_type: 'SPATIAL_EVIDENCE';
  readonly content_hash: ReturnType<typeof buildSpatialEvidenceContentHash>;
  readonly references: readonly { readonly artifact_id: string; readonly artifact_type: string }[];
  readonly payload: Record<string, unknown>;
}

/** One NEGATIVE (exists:false) evidence per governed layer for the given property ref. */
export function negativeLayerEvidence(
  propertyRef: { readonly artifact_id: string; readonly artifact_type: string },
  layers: readonly string[] = GOVERNED_LAYERS_U20CDF5,
): NegativeLayerEvidence[] {
  const location = { artifact_id: `localization-geometry-${propertyRef.artifact_id}`, artifact_type: 'localization_geometry' };
  return layers.map((dataset) => {
    const payload = {
      result_semantics: {
        kind: 'EXISTENCE_WITHIN_DISTANCE',
        query: { subject_ref: propertyRef, srid: 3006, distance_meters: 500 },
        result: { exists: false, match_count_observed: 0, max_features_per_layer: 50 },
      },
      property_ref: propertyRef,
      srid: 3006,
      operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
      geometry: null,
      layer_ref: { layer_id: dataset, version_hash: DATASET_HASH, layer_version: 'v1.0' },
      source_metadata: { provider: 'Provider', dataset, dataset_version: DATASET_HASH, retrieved_at: '2026-10-02T10:00:00.000Z' },
      query_contract: {
        query_contract_version: 'spatial-query-contract-v3',
        spatial_canonical_version: 'sv-canonical-3',
        relation: 'DWITHIN',
        subject: { kind: 'LOCALIZATION_GEOMETRY', property_context_ref: propertyRef, location_ref: location, crs: 'EPSG:3006' },
        parameters: { distance_meters: 500, max_features_per_layer: 50 },
        selection: { predicate_semantics: 'EXISTS' },
      },
    };
    const content_hash = buildSpatialEvidenceContentHash(payload as never);
    return {
      artifact_id: `evidence-${dataset}-${content_hash.value.slice(0, 16)}`,
      artifact_type: 'SPATIAL_EVIDENCE' as const,
      content_hash,
      references: [propertyRef],
      payload,
    };
  });
}

/** The refs of evidence artifacts, as an assessment's evidence_refs. */
export function evidenceRefsOf(evidence: readonly { readonly artifact_id: string; readonly artifact_type: string }[]) {
  return evidence.map((e) => ({ artifact_id: e.artifact_id, artifact_type: e.artifact_type }));
}
