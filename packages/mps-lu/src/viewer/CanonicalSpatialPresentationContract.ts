/**
 * CESIUM-CANONICAL-SPATIAL-PRESENTATION-3D-V1 — the ONE canonical presentation contract.
 *
 * Before this module the repository carried THREE disagreeing presentation shapes:
 *
 *   1. ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md      (declared, prose)
 *   2. server/services/geoPresentationContract.ts          (typed + validated, but wired ONLY to
 *                                                           the ungoverned GET /api/spatial/evidence)
 *   3. ViewerKernel's inline anonymous object literal      (the governed, authority-bearing output,
 *                                                           with no exported type and no validator)
 *
 * (2)'s validator rejects (3)'s output outright: it requires a non-null `geometry` and demands
 * `evidence_id`/`layer_version`/`provider`/`retrieved_at`, none of which (3) emitted. The owner
 * ruling is that (3) is the authority-bearing shape, so this module promotes (3) to a named,
 * exported, validated contract rather than inventing a fourth.
 *
 * TWO RULES GOVERN EVERY FIELD HERE.
 *
 * A. ADDITIVE ONLY. The Cesium viewer components are owned by a different active lane and must not
 *    be modified by this unit. They read these property names directly, so every key ViewerKernel
 *    already emitted is preserved verbatim. New keys are added beside them, never renamed. That is
 *    also why `dataset_version` exists alongside the older `version`: same value, and the alias is
 *    what lets the evidence panel stop rendering "—" without editing a viewer-lane file.
 *
 * B. NOTHING IS SYNTHESIZED. Every field added here is propagated from data the artifact already
 *    carries. `SpatialEvidenceArtifact` semantics are frozen and this unit does not change them:
 *    `payload.source_metadata` already holds provider/dataset/dataset_version/retrieved_at and
 *    `payload.layer_ref` already holds layer_version, so the previously-missing provenance was a
 *    propagation gap, not a missing capability. Unknown stays explicitly `null`. There is no
 *    fabricated geometry, no fabricated measured distance, and no invented precision.
 *
 * On `distance_meters`: it is the QUERY BUFFER, not a measured distance to the feature. ADR §2's
 * "183 m" example would require a measured distance the frozen v1 semantics do not carry. Per the
 * owner ruling that §2(a) is stale/amendable, presentation does NOT fabricate one — the field keeps
 * its true meaning and is named accordingly in `query_distance_meters`.
 */
import type { CanonicalGeometry } from '../domain/CanonicalGeometry.js';

export const CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION = 'canonical-spatial-presentation-v1';

/**
 * Derived from whether the feature actually carries geometry — never hardcoded. Under
 * EXISTENCE_WITHIN_DISTANCE the evidence answers "does a match exist" and carries no geometry;
 * saying so honestly is the point of this field.
 */
export type SpatialPresentationMode = 'GEOMETRIC_SPATIAL_OBSERVATION' | 'NON_GEOMETRIC_SPATIAL_OBSERVATION';

/** Cesium is presentation only; the sole status a projection of governed evidence may claim. */
export type SpatialPresentationGovernanceStatus = 'VERIFIED_OBSERVATION';

/**
 * Where a height came from. This is what keeps a visual fallback from being read as measurement:
 * a renderer may extrude on PRESENTATION_FALLBACK, but the provenance panel must show it as a
 * fallback, never as observed truth.
 */
export type SpatialHeightProvenance = 'MEASURED' | 'READ_MODEL' | 'PRESENTATION_FALLBACK';

/**
 * 3D-ready fields. EVERY field is nullable and `null` means UNKNOWN, not zero and not a default.
 * No current governed source populates these — the read model has no height columns today — so
 * they are present as a stable extension point that a later governed 3D derivation can fill
 * without replacing this contract. A consumer must treat null as "do not extrude", never as 0.
 */
export interface SpatialPresentation3D {
  readonly ground_elevation_m: number | null;
  readonly min_height_m: number | null;
  readonly max_height_m: number | null;
  readonly building_height_m: number | null;
  readonly eave_height_m: number | null;
  readonly ridge_height_m: number | null;
  readonly roof_pitch_deg: number | null;
  readonly azimuth_deg: number | null;
  /** e.g. "RH2000". Null when no vertical datum is known. */
  readonly vertical_reference: string | null;
  readonly terrain_source: string | null;
  readonly terrain_version: string | null;
  /** Null when no height value is present at all. */
  readonly height_provenance: SpatialHeightProvenance | null;
}

/**
 * OPTIONAL pointer to a governed 3D derivation (glTF/GLB/3D Tiles). Deliberately a reference, never
 * inline geometry: a Blender-produced asset must attach to canonical spatial identity, and must
 * never become canonical spatial truth itself. `model_uri` is DATA — a consumer must treat it as an
 * untrusted reference and allowlist it before fetching. No such artifact exists yet; this type
 * exists so adding one later is not a contract replacement.
 */
export interface SpatialPresentation3DReference {
  readonly model_uri: string;
  readonly model_format: 'GLTF' | 'GLB' | '3DTILES';
  /** Content hash of the governed derivation artifact, when it is governed. */
  readonly content_hash: string | null;
  readonly source_artifact_id: string | null;
  readonly coordinate_reference: string;
  readonly anchor: readonly [number, number, number] | null;
  readonly orientation_deg: number | null;
  readonly scale: number | null;
  readonly lod: number | null;
}

/**
 * Presentation-only display hints. NON-AUTHORITATIVE by construction and segregated into their own
 * nested object so no consumer can mistake a colour or a label for governed evidence. Nothing here
 * participates in identity, and nothing here may redefine canonical semantics.
 */
export interface SpatialPresentationStyleHints {
  readonly color: string;
  readonly title: string;
  readonly description: string;
}

/**
 * The canonical per-feature properties. Field groups, in order: canonical identity, provenance,
 * spatial semantics, layer identity, viewer authority, presentation.
 */
export interface CanonicalSpatialPresentationProperties {
  // --- contract identity -------------------------------------------------------------------
  readonly presentation_contract_version: string;

  // --- canonical artifact identity (authority-bearing) -------------------------------------
  readonly cas_artifact_id: string;
  readonly cas_content_hash: string;
  /** Compatibility alias of `cas_artifact_id` for consumers written against the older shape. */
  readonly evidence_id: string;

  // --- provenance (propagated from payload.source_metadata; never invented) -----------------
  readonly provider: string | null;
  readonly dataset: string;
  /** Older key name, preserved so existing viewer code keeps working. */
  readonly version: string;
  /** Same value as `version`; the name the evidence panel actually reads. */
  readonly dataset_version: string;
  readonly retrieved_at: string | null;
  readonly engine: string;
  readonly algorithm: string;

  // --- spatial semantics (frozen meanings, propagated verbatim) -----------------------------
  readonly result_semantics_kind: string;
  readonly exists: boolean;
  /**
   * The QUERY BUFFER in metres, not a measured distance to this feature. Preserved under its
   * original key for compatibility; `query_distance_meters` carries the same value under a name
   * that cannot be misread as a measurement.
   */
  readonly distance_meters: number | null;
  readonly query_distance_meters: number | null;
  readonly match_count_observed: number | null;
  readonly max_features_per_layer: number | null;
  readonly subject_artifact_id: string;

  // --- layer identity ------------------------------------------------------------------------
  readonly layer_id: string;
  readonly layer_version_hash: string;
  readonly layer_version: string | null;

  // --- viewer authority ----------------------------------------------------------------------
  readonly governance_status: SpatialPresentationGovernanceStatus;
  readonly viewer_capability_id: string;
  readonly viewer_release_hash: string;
  readonly viewer_identity_ref: string;

  // --- coordinate provenance -----------------------------------------------------------------
  /** Source SRID of the ORIGINAL geometry. Present only when geometry is non-null. */
  readonly source_srid?: number;
  /** GeoJSON transport is always WGS84 per RFC 7946. */
  readonly presentation_srid: number;

  // --- presentation ---------------------------------------------------------------------------
  readonly presentation_mode: SpatialPresentationMode;
  readonly style: SpatialPresentationStyleHints;
  readonly three_d: SpatialPresentation3D;
  readonly three_d_model?: SpatialPresentation3DReference;
}

export interface CanonicalSpatialPresentationFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly geometry: CanonicalGeometry | null;
  readonly properties: CanonicalSpatialPresentationProperties;
}

export interface CanonicalSpatialPresentationCollection {
  readonly type: 'FeatureCollection';
  readonly presentation_contract_version: string;
  readonly features: readonly CanonicalSpatialPresentationFeature[];
}

/** WGS84. RFC 7946 GeoJSON coordinates are always in this CRS; there is no `crs` member. */
export const PRESENTATION_SRID = 4326;

/** All-unknown 3D block. Used wherever no governed height source exists — i.e. everywhere today. */
export function unknownPresentation3D(): SpatialPresentation3D {
  return {
    ground_elevation_m: null,
    min_height_m: null,
    max_height_m: null,
    building_height_m: null,
    eave_height_m: null,
    ridge_height_m: null,
    roof_pitch_deg: null,
    azimuth_deg: null,
    vertical_reference: null,
    terrain_source: null,
    terrain_version: null,
    height_provenance: null,
  };
}

const STYLE_BY_LAYER_ID: Readonly<Record<string, SpatialPresentationStyleHints>> = {
  water: {
    color: '#3b82f6',
    title: 'WATER Evidens',
    description: 'Vattenrelaterad miljöevidens identifierad.',
  },
  ebh: {
    color: '#ef4444',
    title: 'EBH Evidens',
    description: 'Potentiellt förorenat område eller EBH-indikator.',
  },
  protected_area: {
    color: '#10b981',
    title: 'PROTECTED_AREA Evidens',
    description: 'Skyddat naturområde, Natura 2000 eller liknande områdesskydd.',
  },
};

/**
 * Display hints only. Unlike the older ungoverned contract this does NOT constrain which layer ids
 * are admissible — layer admissibility is the canonical layer registry's job, not the style table's.
 * An unknown layer gets a neutral style instead of being rejected at presentation time.
 */
export function presentationStyleForLayerId(layerId: string): SpatialPresentationStyleHints {
  return (
    STYLE_BY_LAYER_ID[layerId] ?? {
      color: '#64748b',
      title: `${layerId.toUpperCase()} Evidens`,
      description: 'Verifierad spatial observation från LU-presentation.',
    }
  );
}

export function presentationModeForGeometry(geometry: CanonicalGeometry | null): SpatialPresentationMode {
  return geometry === null ? 'NON_GEOMETRIC_SPATIAL_OBSERVATION' : 'GEOMETRIC_SPATIAL_OBSERVATION';
}

/**
 * Validates a projected feature. Returns [] when valid.
 *
 * The decisive difference from the superseded ungoverned validator: a null `geometry` is VALID
 * here. Requiring geometry is what made that validator reject the governed path's own output, and
 * under EXISTENCE_WITHIN_DISTANCE null is the honest answer. What this validator does insist on is
 * that identity, provenance and viewer authority are present and non-empty — the fields that make a
 * feature traceable back to a governed artifact.
 */
export function assertCanonicalPresentationFeature(feature: unknown): string[] {
  const errors: string[] = [];
  if (!feature || typeof feature !== 'object') {
    return ['feature must be an object'];
  }

  const candidate = feature as Partial<CanonicalSpatialPresentationFeature>;
  if (candidate.type !== 'Feature') errors.push('type must be Feature');

  // NOTE: geometry may legitimately be null. Only an undefined/missing key is an error, because
  // that is indistinguishable from a projection that forgot to set it.
  if (!('geometry' in candidate)) errors.push('geometry key is required (null is permitted)');

  const properties = candidate.properties as unknown as Record<string, unknown> | undefined | null;
  if (!properties || typeof properties !== 'object') {
    errors.push('properties are required');
    return errors;
  }

  for (const field of [
    'presentation_contract_version',
    'cas_artifact_id',
    'cas_content_hash',
    'evidence_id',
    'dataset',
    'version',
    'dataset_version',
    'engine',
    'algorithm',
    'result_semantics_kind',
    'subject_artifact_id',
    'layer_id',
    'layer_version_hash',
    'governance_status',
    'viewer_capability_id',
    'viewer_release_hash',
    'viewer_identity_ref',
  ]) {
    if (typeof properties[field] !== 'string' || !String(properties[field]).trim()) {
      errors.push(`properties.${field} is required`);
    }
  }

  if (properties.governance_status !== 'VERIFIED_OBSERVATION') {
    errors.push('properties.governance_status must be VERIFIED_OBSERVATION');
  }
  if (properties.presentation_contract_version !== CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION) {
    errors.push(
      `properties.presentation_contract_version must be ${CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION}`,
    );
  }
  if (properties.presentation_srid !== PRESENTATION_SRID) {
    errors.push(`properties.presentation_srid must be ${PRESENTATION_SRID}`);
  }

  const mode = properties.presentation_mode;
  const expectedMode = presentationModeForGeometry((candidate.geometry ?? null) as CanonicalGeometry | null);
  if (mode !== expectedMode) {
    errors.push(`properties.presentation_mode must be ${expectedMode} for this geometry`);
  }

  // source_srid is coordinate provenance and is meaningful ONLY when geometry exists. Asserting it
  // on a null geometry would be claiming a projection that never happened.
  if (candidate.geometry === null && 'source_srid' in properties) {
    errors.push('properties.source_srid must be absent when geometry is null');
  }
  if (candidate.geometry != null && typeof properties.source_srid !== 'number') {
    errors.push('properties.source_srid is required when geometry is present');
  }

  const style = properties.style as Record<string, unknown> | undefined;
  if (!style || typeof style !== 'object') {
    errors.push('properties.style is required');
  } else {
    for (const field of ['color', 'title', 'description']) {
      if (typeof style[field] !== 'string' || !String(style[field]).trim()) {
        errors.push(`properties.style.${field} is required`);
      }
    }
  }

  if (!properties.three_d || typeof properties.three_d !== 'object') {
    errors.push('properties.three_d is required (all-null when unknown)');
  } else {
    const threeD = properties.three_d as Record<string, unknown>;
    const hasHeight = [
      'ground_elevation_m',
      'min_height_m',
      'max_height_m',
      'building_height_m',
      'eave_height_m',
      'ridge_height_m',
    ].some((k) => typeof threeD[k] === 'number');
    // A height with no stated provenance is exactly how a visual fallback gets read as measurement.
    if (hasHeight && threeD.height_provenance == null) {
      errors.push('properties.three_d.height_provenance is required when any height is present');
    }
  }

  return errors;
}

export function assertCanonicalPresentationCollection(collection: unknown): string[] {
  if (!collection || typeof collection !== 'object') return ['collection must be an object'];
  const candidate = collection as Partial<CanonicalSpatialPresentationCollection>;
  const errors: string[] = [];
  if (candidate.type !== 'FeatureCollection') errors.push('type must be FeatureCollection');
  if (candidate.presentation_contract_version !== CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION) {
    errors.push(`presentation_contract_version must be ${CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION}`);
  }
  if (!Array.isArray(candidate.features)) {
    errors.push('features must be an array');
    return errors;
  }
  candidate.features.forEach((feature, index) => {
    for (const error of assertCanonicalPresentationFeature(feature)) {
      errors.push(`features[${index}]: ${error}`);
    }
  });
  return errors;
}
