/**
 * W-M2d (LU UI integration unit) -- test fixture: a GET /api/localization/:projectId/current-assessment
 * read-back built by the SERVER's own presentation functions, so the UI tests render exactly the
 * states and Swedish texts the server sends (governedEvidenceDetails.ts, governedCoverageStatement.ts,
 * knownCoverageGaps.ts, presentedGovernedFindings.ts) -- never a hand-written copy that could drift
 * from the server. The UI must not derive any of this itself (server = single source).
 *
 * Pure: no CAS, no database, no network. The evidence objects carry only the payload fields the
 * server's layer checks read (dataset, layer_ref.version_hash, result_semantics); the evidence
 * details are assembled in the server's `GovernedEvidenceDetail` shape (type-checked against it)
 * from the server's own contract and coverage-gap registers.
 */
import {
  admitV1ContractFacts,
  governedOverallStatement,
  MISSING_IN_BASIS_SV,
  presentedGovernedLayerChecks,
  ROOT_UNBOUND_SV,
  type GovernedEvidenceDetail,
  type PresentedGovernedLayerCheck,
} from '../../server/modules/localization/governedEvidenceDetails';
import { computeGovernedDocumentCheck } from '../../server/modules/localization/governedLayerChecks';
import { knownCoverageGapsFor } from '../../server/modules/localization/knownCoverageGaps';
import { presentGovernedFindings } from '../../server/modules/localization/presentedGovernedFindings';

export const LU_LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
export type LuLayer = (typeof LU_LAYERS)[number];

export const RULE_BY_LAYER: Readonly<Record<LuLayer, string>> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};

/** Each layer's real dataset version (= ADMIT v1 source_sha256 = SpatialLayerRegistry version_hash). */
export const LAYER_VERSION: Readonly<Record<LuLayer, string>> = {
  water: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
  ebh: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  protected_area: '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae',
  natura2000: 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02',
  water_protection_area: 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18',
};

export const RETRIEVED_AT = '2026-10-01T10:00:00.000Z';

export type LayerSpec =
  /** A registered hit; a current run always stores a risk finding citing the evidence with it. */
  | { readonly kind: 'hit'; readonly count?: number; readonly risk?: 'HIGH' | 'MEDIUM' | 'LOW'; readonly version?: string }
  | { readonly kind: 'no_hit'; readonly version?: string }
  /** The governed query could not run: a NOT_CHECKED finding, no evidence. */
  | { readonly kind: 'unavailable' }
  /** The record says nothing about the layer (an older producer). */
  | { readonly kind: 'absent' }
  /** The evidence is pinned but cannot be read back from CAS. */
  | { readonly kind: 'unreadable'; readonly risk?: 'HIGH' | 'MEDIUM' | 'LOW'; readonly readError?: boolean };

export const evidenceIdOf = (layer: string) => `evidence-${layer}-test`;
export const findingIdOf = (layer: string) => `finding-${layer}-${evidenceIdOf(layer)}`;

function spatialEvidence(layer: string, exists: boolean, count: number, version: string) {
  return {
    artifact_id: evidenceIdOf(layer),
    artifact_type: 'SPATIAL_EVIDENCE' as const,
    content_hash: { algorithm: 'sha256' as const, value: `hash-${layer}` },
    payload: {
      source_metadata: { provider: 'PostGIS', dataset: layer, dataset_version: version, retrieved_at: RETRIEVED_AT },
      layer_ref: { layer_id: layer, version_hash: version, layer_version: 'v1.0' },
      result_semantics: {
        kind: 'EXISTENCE_WITHIN_DISTANCE',
        query: { distance_meters: 500 },
        result: { exists, match_count_observed: count, max_features_per_layer: 50 },
      },
    },
  };
}

export interface ReadBackOptions {
  readonly id: string;
  /** Per layer; a layer not named is a checked no-hit. */
  readonly layers?: Partial<Record<LuLayer, LayerSpec>>;
  /** 'none' (default): no document evidence pinned; 'pinned': DE + VF pinned (CHECKED_HIT). */
  readonly documents?: 'none' | 'pinned' | 'unreadable';
  /** The governed machine risk level (default: the highest stored finding level, else LOW). */
  readonly riskLevel?: string;
  /** The assessment's own bound point (default: VERIFIED at loc-geom-1). */
  readonly localizationGeometry?: Record<string, unknown> | null;
}

const LEVEL_ORDER = ['HIGH', 'MEDIUM', 'LOW'];

/** A server-shaped current-assessment read-back (fields as localization.routes.ts sends them). */
export function governedReadBack(options: ReadBackOptions) {
  const evidence: ReturnType<typeof spatialEvidence>[] = [];
  const findings: Array<{
    finding_id: string;
    rule_id: string;
    rule_version: string;
    risk_level: string;
    explanation: string;
    evidence_refs: Array<{ artifact_id: string; artifact_type: string }>;
  }> = [];
  const refs: Array<{ artifact_id: string; artifact_type: string }> = [];
  const unreadable: string[] = [];
  let anyNotFound = false;
  let anyReadError = false;

  for (const layer of LU_LAYERS) {
    const spec: LayerSpec = options.layers?.[layer] ?? { kind: 'no_hit' };
    const ref = { artifact_id: evidenceIdOf(layer), artifact_type: 'SPATIAL_EVIDENCE' };
    switch (spec.kind) {
      case 'hit': {
        const count = spec.count ?? 1;
        evidence.push(spatialEvidence(layer, true, count, spec.version ?? LAYER_VERSION[layer]));
        refs.push(ref);
        findings.push({
          finding_id: findingIdOf(layer),
          rule_id: RULE_BY_LAYER[layer],
          rule_version: '2.0',
          risk_level: spec.risk ?? 'MEDIUM',
          explanation: `engine text ${layer}`,
          evidence_refs: [ref],
        });
        break;
      }
      case 'no_hit':
        evidence.push(spatialEvidence(layer, false, 0, spec.version ?? LAYER_VERSION[layer]));
        refs.push(ref);
        break;
      case 'unavailable':
        findings.push({
          finding_id: `finding-notchecked-${layer}`,
          rule_id: RULE_BY_LAYER[layer],
          rule_version: '2.0',
          risk_level: 'NOT_CHECKED',
          explanation: 'stored provider text that is never shown',
          evidence_refs: [],
        });
        break;
      case 'unreadable':
        refs.push(ref);
        unreadable.push(ref.artifact_id);
        if (spec.readError) anyReadError = true;
        else anyNotFound = true;
        if (spec.risk) {
          findings.push({
            finding_id: findingIdOf(layer),
            rule_id: RULE_BY_LAYER[layer],
            rule_version: '2.0',
            risk_level: spec.risk,
            explanation: `engine text ${layer}`,
            evidence_refs: [ref],
          });
        }
        break;
      case 'absent':
        break;
    }
  }
  if (options.documents === 'pinned' || options.documents === 'unreadable') {
    refs.push({ artifact_id: 'doc-evidence-1', artifact_type: 'DOCUMENT_EVIDENCE' });
    refs.push({ artifact_id: 'doc-fact-1', artifact_type: 'VERIFIED_DOCUMENT_FACT' });
    if (options.documents === 'unreadable') {
      unreadable.push('doc-evidence-1', 'doc-fact-1');
      anyNotFound = true;
    }
  }

  const governedLayerChecks: PresentedGovernedLayerCheck[] = presentedGovernedLayerChecks({
    spatialEvidence: evidence as never,
    findings: findings as never,
    pinnedEvidenceRefs: refs,
    spatialEvidenceUnreadable: unreadable.some((id) => id.startsWith('evidence-')),
    unreadableArtifactIds: unreadable,
  });
  const pinnedEvidence = {
    pinned_total: refs.length,
    unreadable_artifact_ids: [...unreadable].sort(),
    technical_error_class: anyNotFound ? ('EVIDENCE_NOT_FOUND' as const) : anyReadError ? ('EVIDENCE_READ_ERROR' as const) : null,
    retryable: anyNotFound ? false : anyReadError ? true : null,
  };
  const riskLevel = options.riskLevel ?? LEVEL_ORDER.find((level) => findings.some((f) => f.risk_level === level)) ?? 'LOW';
  const overallStatement = governedOverallStatement(riskLevel, governedLayerChecks, { findings, pinnedEvidence });

  const checkByEvidence = new Map(governedLayerChecks.map((c) => [c.evidence_artifact_id, c] as const));
  const evidenceDetails: GovernedEvidenceDetail[] = refs.map((ref) => {
    const citedBy = findings.filter((f) => f.evidence_refs.some((r) => r.artifact_id === ref.artifact_id)).map((f) => f.finding_id);
    const item = evidence.find((e) => e.artifact_id === ref.artifact_id);
    if (!item || unreadable.includes(ref.artifact_id)) {
      const readError = !anyNotFound && anyReadError;
      return {
        evidence_artifact_id: ref.artifact_id,
        artifact_type: ref.artifact_type,
        resolution: readError ? 'READ_ERROR' : 'NOT_FOUND',
        integrity: null,
        technical_error_class: readError ? 'EVIDENCE_READ_ERROR' : 'EVIDENCE_NOT_FOUND',
        content_hash: null,
        layer: null,
        provider: null,
        dataset_version_hash: null,
        layer_version_label: null,
        import_batch_id: null,
        retrieved_at: null,
        query: null,
        result: null,
        binding_assurance: 'NONE',
        contract: null,
        coverage_limitation_sv: MISSING_IN_BASIS_SV,
        known_coverage_gaps: [],
        cited_by_finding_ids: citedBy,
        message_sv: `Tekniskt fel: evidensen kunde inte läsas ur CAS (${readError ? 'EVIDENCE_READ_ERROR' : 'EVIDENCE_NOT_FOUND'}).`,
        binding_note_sv: 'Ingen bindning kan redovisas: evidensen kunde inte läsas.',
      } satisfies GovernedEvidenceDetail;
    }
    const version = item.payload.layer_ref.version_hash;
    const contract = admitV1ContractFacts(version);
    const result = item.payload.result_semantics.result;
    return {
      evidence_artifact_id: ref.artifact_id,
      artifact_type: ref.artifact_type,
      resolution: 'RESOLVED',
      integrity: 'CONTENT_HASH_VERIFIED',
      technical_error_class: null,
      content_hash: item.content_hash.value,
      layer: item.payload.source_metadata.dataset,
      provider: 'PostGIS',
      dataset_version_hash: version,
      layer_version_label: 'v1.0',
      import_batch_id: null,
      retrieved_at: RETRIEVED_AT,
      query: {
        relation: 'EXISTS_WITHIN_DISTANCE',
        subject_kind: 'LOCALIZATION_POINT',
        location_ref: { artifact_id: 'loc-geom-1', artifact_type: 'LOCALIZATION_GEOMETRY' },
        property_context_ref: null,
        distance_meters: 500,
      },
      result: {
        semantics_kind: 'EXISTENCE_WITHIN_DISTANCE',
        exists: result.exists,
        match_count_observed: result.match_count_observed,
        max_features_per_layer: result.max_features_per_layer,
        cap_reached: result.match_count_observed >= result.max_features_per_layer,
      },
      binding_assurance: !contract ? 'HASH_BOUND_CONTRACT_UNKNOWN' : contract.legacy_adopted ? 'HASH_BOUND_LEGACY_ADOPTED' : 'HASH_BOUND_LEDGER_METADATA',
      contract,
      coverage_limitation_sv: contract?.coverage_limitation_sv ?? MISSING_IN_BASIS_SV,
      known_coverage_gaps: knownCoverageGapsFor(version),
      cited_by_finding_ids: citedBy,
      message_sv: checkByEvidence.get(ref.artifact_id)?.message_sv ?? MISSING_IN_BASIS_SV,
      binding_note_sv: 'Evidensen är hashbunden i bedömningen (fixture).',
    } satisfies GovernedEvidenceDetail;
  });

  return {
    ok: true,
    assessmentArtifactId: options.id,
    findings: presentGovernedFindings(findings as never),
    ruleRefs: [],
    evidenceRefs: refs,
    systemSummary: 's',
    localizationGeometry:
      options.localizationGeometry === undefined ? boundPoint('loc-geom-1', [17.74, 59.87]) : options.localizationGeometry,
    documentCheck: computeGovernedDocumentCheck(refs, { unreadableArtifactIds: unreadable }),
    governedLayerChecks,
    evidenceDetails,
    propertyRoot: {
      status: 'NOT_RECORDED',
      technical_error_class: null,
      property_context_artifact_id: null,
      property_designation: null,
      property_identity: null,
      project_property_binding_artifact_id: null,
      observation_artifact_id: null,
      observation_contract_version: null,
      resolver_id: null,
      source_dataset: null,
      source_key: null,
      source_updated_at: null,
      dataset_binding: null,
      assurance: 'UNKNOWN',
      message_sv: `${ROOT_UNBOUND_SV} Bedömningen saknar fastighetsreferens.`,
    },
    overallStatement,
  };
}

/** The read-back's localizationGeometry for an assessment bound to a VERIFIED point. */
export function boundPoint(artifactId: string, lngLat: readonly [number, number]) {
  return {
    artifact_id: artifactId,
    provenance: 'derived_from_property_boundary',
    provenance_label_sv: 'Härledd från fastighetens centrumpunkt (ingen lokaliseringspunkt har angetts för projektet)',
    bound_geometry_status: 'VERIFIED',
    geometry_type: 'POINT',
    coordinates_wgs84: lngLat,
    coordinates_sweref99tm: [6640000, 660000],
    srid: 3006,
  };
}
