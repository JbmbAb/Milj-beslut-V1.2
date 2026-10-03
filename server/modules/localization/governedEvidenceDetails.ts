/**
 * U20-D (LU 72h; U20-U30 spec 1.5 K3/K5, 1.6 U20-D): evidence and property-root details for one
 * governed LocalizationAssessmentArtifact -- the same answer for the fresh run, the read-back
 * (resolveCurrentLuAssessmentSummary) and the PDF (exportCurrentLuAssessmentPdf).
 *
 * Everything is read from CAS, starting at the assessment's own pinned `evidence_refs` and
 * `property_ref`. No PostGIS, no live source, no re-execution. Machine-readable fields are kept as
 * stored; Swedish presentation text is added on top and never feeds back into anything.
 *
 * Failure model (never a silently missing field):
 *  - a pinned artifact whose content WAS read but does not match its own identity (hash/id/type) is
 *    an integrity verdict (EVIDENCE_TAMPERED / EVIDENCE_CORRUPTED, ROOT_PROVENANCE_TAMPERED): the
 *    read-back and the PDF fail closed with 424 (resolveGovernedAssessmentDetails reports it in
 *    `integrity`; the fresh run only reports it);
 *  - an artifact that could not be read is a technical error with a class (EVIDENCE_NOT_FOUND /
 *    EVIDENCE_READ_ERROR, ROOT_ARTIFACT_NOT_FOUND / ROOT_READ_ERROR) on that entry;
 *  - an evidence family this view does not interpret is listed as NOT_INTERPRETED (owner decision:
 *    SPATIAL_LAYER_UNAVAILABLE is not adopted, so nothing here depends on it).
 *
 * The governed layer checks are derived from the stored spatial evidence, the stored findings and
 * the pinned refs only (computeGovernedLayerChecks + computeGovernedDocumentCheck). A layer whose
 * governed query could not run is visible through its NOT_CHECKED finding (reason
 * NOT_CHECKED_FINDING, coverage_state SOURCE_UNAVAILABLE) -- the provider's raw error text is not
 * repeated in the checks.
 *
 * PRES-24: new machine-readable tokens introduced here -- `coverage_state`, `binding_assurance`,
 * `integrity`, `technical_error_class`, `assurance` (root) and their values. They add to the
 * existing vocabulary and replace none of it (owner decision 6 in the U20-U30 spec is open).
 */
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import {
  buildSpatialEvidenceContentHash,
  createProductLuPropertyContextArtifact,
  createPropertyLookupObservationArtifact,
  CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION,
  hasSpatialEvidenceQueryContract,
  PRODUCT_LU_CONTEXT_CONTRACT_VERSION,
  PROPERTY_LOOKUP_OBSERVATION_ARTIFACT_TYPE,
  validateProjectPropertyBindingArtifact,
  type AssessmentFinding,
  type LocalizationAssessmentArtifact,
  type LUPropertyContextArtifact,
  type ProjectPropertyBindingArtifact,
  type PropertyLookupObservationArtifact,
  type SpatialEvidenceArtifact,
} from '@miljobeslut/mps-lu';
import {
  isVerifiedDocumentFact,
  type VerifiedDocumentFactArtifact,
} from '../../../packages/mps-data-governance/src/DocumentFactArtifact';
import { isVerifiedDocumentFactContentHashValid } from '../../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import {
  computeGovernedDocumentCheck,
  computeGovernedLayerChecks,
  type GovernedDocumentCheck,
  type GovernedLayerCheck,
} from './governedLayerChecks';
import {
  assessGovernedCoverage,
  governedLayerLabelSv,
  governedOverallStatementSv,
  highestGovernedRiskLevel,
  riskLevelPhraseSv,
  type GovernedCheckCoverage,
  type GovernedRecordCoverageState,
  type GovernedStatementContext,
  type PinnedEvidenceReadability,
} from './governedCoverageStatement';
import { declaresSpatialResultContract, readSpatialEvidenceForm } from './governedSpatialEvidenceForm';
import { assertReadUnderItsOwnId, LuReadFaultError } from './readFaultClassification';
import { knownCoverageGapsFor, knownCoverageLimitationSv, type KnownCoverageGap } from './knownCoverageGaps';

/** The governed spatial layers of LU v1, in check order. The product query requests exactly these. */
export const LU_V1_GOVERNED_SPATIAL_LAYERS = [
  'water',
  'ebh',
  'protected_area',
  'natura2000',
  'water_protection_area',
] as const;

export const MISSING_IN_BASIS_SV = 'Saknas i underlaget';

/** U20CDF3 (low 2): exactly one of the governed LU v1 spatial layers (no case folding, no trimming). */
export function isGovernedSpatialLayer(dataset: string): boolean {
  return (LU_V1_GOVERNED_SPATIAL_LAYERS as readonly string[]).includes(dataset);
}

// ---------------------------------------------------------------------------------------------
// ADMIT v1 layer contracts (presentation only)
// ---------------------------------------------------------------------------------------------

export interface AdmitV1LayerContractFacts {
  readonly layer_id: string;
  readonly source_id: string;
  readonly source_version: string;
  readonly authority: string;
  /** The contract's source_version is a `legacy-adopted-*` delivery: adopted existing data. */
  readonly legacy_adopted: boolean;
  /**
   * What is known NOT to be covered for this dataset version -- the contract's own scope and any
   * known incompleteness -- composed from the single register in knownCoverageGaps.ts; null where
   * nothing is stated (never read as "complete").
   */
  readonly coverage_limitation_sv: string | null;
}

/**
 * Transcribed from the FROZEN docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md (ADMIT rows) and
 * ADMIT-V1-SET.md, keyed by the contract's source_sha256 -- the same value the spatial layer
 * registry binds as `version_hash` and every spatial evidence carries in `layer_ref.version_hash`.
 * Keyed by hash on purpose: evidence for any other dataset version gets NO contract text (shown as
 * "Saknas i underlaget"), never the text of a version it was not produced from. The coverage text is
 * not written here: it comes from knownCoverageGaps.ts (one place, with source and date).
 */
function contractFacts(
  sourceSha256: string,
  facts: Omit<AdmitV1LayerContractFacts, 'coverage_limitation_sv'>,
): readonly [string, AdmitV1LayerContractFacts] {
  return [sourceSha256, { ...facts, coverage_limitation_sv: knownCoverageLimitationSv(sourceSha256) }];
}

const ADMIT_V1_CONTRACT_FACTS_BY_SOURCE_SHA256: Readonly<Record<string, AdmitV1LayerContractFacts>> = Object.fromEntries([
  contractFacts('2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', {
    layer_id: 'lu.water_wells',
    source_id: 'SGU/brunnar/2026-06-19',
    source_version: '2026-06-19',
    authority: 'SGU',
    legacy_adopted: false,
  }),
  contractFacts('02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186', {
    layer_id: 'lu.ebh',
    source_id: 'LST/EBH_Potentiellt_fororenade_omraden/2026-07-23',
    source_version: '2026-07-23',
    authority: 'Länsstyrelsen',
    legacy_adopted: false,
  }),
  contractFacts('983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae', {
    layer_id: 'lu.protected_area',
    source_id: 'Naturvardsverket/SkyddadeOmraden/Naturreservat/legacy-adopted-2026-07-20',
    source_version: 'legacy-adopted-2026-07-20',
    authority: 'Naturvårdsverket',
    legacy_adopted: true,
  }),
  contractFacts('ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18', {
    layer_id: 'lu.water_protection',
    source_id: 'Naturvardsverket/Vatten/Vattenskyddsomrade/legacy-adopted-2026-07-20',
    source_version: 'legacy-adopted-2026-07-20',
    authority: 'Naturvårdsverket',
    legacy_adopted: true,
  }),
  contractFacts('a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02', {
    layer_id: 'lu.natura2000',
    // The contract's identifier, verbatim (its "Rikstackande" names the source file, it is no
    // coverage claim; see knownCoverageGaps.ts for what the governed table actually lacks).
    source_id: 'Naturvardsverket/Natura2000/2026-05-08/SPA_Rikstackande',
    source_version: '2026-05-08',
    authority: 'Naturvårdsverket',
    legacy_adopted: false,
  }),
]);

export function admitV1ContractFacts(versionHash: string | null | undefined): AdmitV1LayerContractFacts | null {
  return (versionHash && ADMIT_V1_CONTRACT_FACTS_BY_SOURCE_SHA256[versionHash]) || null;
}

// ---------------------------------------------------------------------------------------------
// Governed layer checks (shared by the fresh run, the read-back and the PDF)
// ---------------------------------------------------------------------------------------------

/** DIRECTIVE-72H section 11 states, server-side; `status`/`reason` stay the machine truth underneath. */
export type GovernedCoverageState =
  | 'CHECKED_HIT'
  | 'CHECKED_NO_HIT'
  | 'NOT_CHECKED'
  | 'SOURCE_UNAVAILABLE'
  | 'INCOMPLETE_EVIDENCE'
  | 'TECHNICAL_ERROR';

export interface PresentedGovernedLayerCheck extends GovernedLayerCheck {
  readonly coverage_state: GovernedCoverageState;
  /** Swedish presentation (SI-2: a negative register result is "ingen registrerad träff", nothing more). */
  readonly message_sv: string;
  /** From the ADMIT v1 contract of the evidence's dataset version; "Saknas i underlaget" otherwise. */
  readonly coverage_limitation_sv: string;
  /**
   * U20CDF (owner directive 2026-10-02): the same limitation as machine-readable entries of the one
   * register (knownCoverageGaps.ts) for the evidence's dataset version; [] when none is stated.
   */
  readonly known_coverage_gaps: readonly KnownCoverageGap[];
}

const COVERAGE_STATE_BY_REASON: Readonly<Record<string, GovernedCoverageState>> = {
  NOT_CHECKED_FINDING: 'SOURCE_UNAVAILABLE',
  // U20CDF3 (low 4): an invalid combination in the record -- an integrity error, not a source outage.
  NOT_CHECKED_FINDING_WITH_EVIDENCE: 'TECHNICAL_ERROR',
  // U20CDF3 (low 3): a stored finding whose severity is outside the governed values.
  FINDING_WITH_UNKNOWN_SEVERITY: 'TECHNICAL_ERROR',
  // U20CDF3 (low 7b): more than one evidence for one layer.
  DUPLICATE_LAYER_EVIDENCE: 'TECHNICAL_ERROR',
  // U20CDF4 (owner decision 2): evidence that declares the result contract and breaks it.
  EVIDENCE_VIOLATES_RESULT_CONTRACT: 'TECHNICAL_ERROR',
  NO_EVIDENCE: 'NOT_CHECKED',
  UNRECOGNIZED_RESULT: 'INCOMPLETE_EVIDENCE',
  PINNED_EVIDENCE_UNREADABLE: 'TECHNICAL_ERROR',
  NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED: 'NOT_CHECKED',
  DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED: 'INCOMPLETE_EVIDENCE',
  PINNED_EVIDENCE_REFS_UNREADABLE: 'TECHNICAL_ERROR',
  MALFORMED_DOCUMENT_REFS: 'TECHNICAL_ERROR',
};

function coverageStateOf(check: GovernedLayerCheck): GovernedCoverageState {
  if (check.status === 'CHECKED_HIT' || check.status === 'CHECKED_NO_HIT') return check.status;
  // Any other NOT_CHECKED cause (e.g. a provider reason from an older producer) is still NOT_CHECKED.
  return (check.reason && COVERAGE_STATE_BY_REASON[check.reason]) || 'NOT_CHECKED';
}

interface SpatialEvidenceView {
  readonly provider: string | null;
  readonly versionHash: string | null;
  readonly distanceMeters: number | null;
  readonly matchCount: number | null;
  readonly maxFeatures: number | null;
}

function spatialEvidenceView(evidence: SpatialEvidenceArtifact | undefined): SpatialEvidenceView {
  const payload = evidence?.payload as Partial<SpatialEvidenceArtifact['payload']> | undefined;
  const semantics = payload?.result_semantics as
    | { query?: { distance_meters?: unknown }; result?: { match_count_observed?: unknown; max_features_per_layer?: unknown } }
    | undefined;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    provider: typeof payload?.source_metadata?.provider === 'string' ? payload.source_metadata.provider : null,
    versionHash: typeof payload?.layer_ref?.version_hash === 'string' ? payload.layer_ref.version_hash : null,
    distanceMeters: num(semantics?.query?.distance_meters),
    matchCount: num(semantics?.result?.match_count_observed),
    maxFeatures: num(semantics?.result?.max_features_per_layer),
  };
}

function sourceLabelSv(layer: string, view: SpatialEvidenceView): string {
  return view.provider ? `${governedLayerLabelSv(layer)} (${view.provider})` : governedLayerLabelSv(layer);
}

function radiusSv(view: SpatialEvidenceView): string {
  return view.distanceMeters !== null ? `inom ${view.distanceMeters} m` : 'inom sökradien (radien saknas i underlaget)';
}

function spatialCheckMessageSv(
  check: GovernedLayerCheck,
  state: GovernedCoverageState,
  view: SpatialEvidenceView,
  storedRiskLevel: string | null = null,
  /** U20CDF4 (U20CDF3 verification L4): the layer's repeated evidence is one and the same pinned ref. */
  sameEvidencePinnedRepeatedly = false,
): string {
  const source = sourceLabelSv(check.layer, view);
  if (check.reason === 'DUPLICATE_LAYER_EVIDENCE') {
    // U20CDF4 (L4): the same ref pinned twice is ONE evidence -- "mer än en evidens" would be false.
    const duplicate = sameEvidencePinnedRepeatedly
      ? `Integritetsfel: bedömningen pinnar samma evidens för ${governedLayerLabelSv(check.layer)} mer än en gång.`
      : `Integritetsfel: bedömningen innehåller mer än en evidens för ${governedLayerLabelSv(check.layer)}.`;
    return check.status === 'CHECKED_HIT'
      ? `Träff enligt bedömningens lagrade fynd för ${source}` +
          (storedRiskLevel ? ` (${riskLevelPhraseSv(storedRiskLevel)})` : '') +
          `. ${duplicate}`
      : `${duplicate} Ingen slutsats om lagret.`;
  }
  if (check.reason === 'EVIDENCE_VIOLATES_RESULT_CONTRACT') {
    // U20CDF4 (owner decision 2): a contract break, never "kunde inte tolkas" (that is for older evidence).
    const violation = `Integritetsfel: evidensen för ${governedLayerLabelSv(check.layer)} anger det styrda resultatkontraktet men bryter mot det.`;
    return check.status === 'CHECKED_HIT'
      ? `Träff enligt bedömningens lagrade fynd för ${source}` +
          (storedRiskLevel ? ` (${riskLevelPhraseSv(storedRiskLevel)})` : '') +
          `. ${violation}`
      : `${violation} Ingen slutsats om lagret.`;
  }
  if (check.reason === 'FINDING_WITH_UNKNOWN_SEVERITY') {
    return (
      `Integritetsfel: bedömningen innehåller ett fynd för ${governedLayerLabelSv(check.layer)} med en allvarlighetsgrad ` +
      'utanför det styrda formatet. Ingen slutsats om lagret.'
    );
  }
  if (check.reason === 'NOT_CHECKED_FINDING_WITH_EVIDENCE') {
    // U20CDF3 (low 4): the record says both "not checked" and holds evidence for the layer.
    return (
      `Integritetsfel: bedömningen innehåller både ett fynd om att ${governedLayerLabelSv(check.layer)} inte kunde ` +
      'kontrolleras och evidens för lagret. Ingen slutsats om lagret.'
    );
  }
  if (check.status === 'CHECKED_HIT' && check.reason === 'FINDING_WITHOUT_CONSISTENT_EVIDENCE') {
    // U20CDF2 (owner invariant): the stored finding shows the layer was processed -- completed, and
    // shown in full -- but the record does not hold the consistent evidence that would back it.
    return (
      `Träff enligt bedömningens lagrade fynd för ${source}` +
      (storedRiskLevel ? ` (${riskLevelPhraseSv(storedRiskLevel)})` : '') +
      '. Bedömningen innehåller ingen konsistent evidens för lagret som belägger träffen (evidensen saknas, ' +
      'är negativ, kan inte tolkas eller står bredvid ett fynd om att lagret inte kunde kontrolleras).'
    );
  }
  switch (state) {
    case 'CHECKED_NO_HIT':
      // SI-2 (owner wording): a register check, never "oförorenad", "inga risker" or "inga avvikelser".
      return `Ingen registrerad träff i ${source} ${radiusSv(view)} (registerkontroll, inte markundersökning).`;
    case 'CHECKED_HIT': {
      const capReached = view.matchCount !== null && view.maxFeatures !== null && view.matchCount >= view.maxFeatures;
      const count =
        view.matchCount === null
          ? 'antal träffar saknas i underlaget'
          : capReached
            ? `minst ${view.matchCount} objekt (taket på ${view.maxFeatures} träffar nåddes; fler kan finnas)`
            : `${view.matchCount} objekt`;
      return `Registrerad träff i ${source} ${radiusSv(view)}: ${count} (registerkontroll).`;
    }
    case 'SOURCE_UNAVAILABLE':
      return `Inte kontrollerat: källan för ${source} kunde inte läsas när bedömningen gjordes (tekniskt fel i den styrda frågan). Ingen slutsats om lagret.`;
    case 'INCOMPLETE_EVIDENCE':
      return `Ofullständigt underlag: resultatet i evidensen för ${source} kunde inte tolkas. Ingen slutsats om lagret.`;
    case 'TECHNICAL_ERROR':
      // U20CDF2 (G2): bound evidence that cannot be read is an integrity/technical error; a stored
      // finding of the layer is still named (it is shown in full among the findings).
      return (
        `Tekniskt fel: den pinnade evidensen för ${source} kunde inte läsas ur CAS och kan inte verifieras. ` +
        (storedRiskLevel
          ? `Bedömningens lagrade fynd för lagret (${riskLevelPhraseSv(storedRiskLevel)}) redovisas var för sig.`
          : 'Ingen slutsats om lagret.')
      );
    default:
      return `Inte kontrollerat: bedömningen innehåller ingen evidens för ${source}. Ingen slutsats om lagret.`;
  }
}

/** A stored finding as the layer checks read it: its rule, its level and (when recorded) what it cites. */
type StoredFindingLike = Pick<AssessmentFinding, 'rule_id' | 'risk_level'> & {
  readonly evidence_refs?: AssessmentFinding['evidence_refs'];
};

function presentCheck(
  check: GovernedLayerCheck,
  evidenceById: ReadonlyMap<string, SpatialEvidenceArtifact>,
  findings: readonly StoredFindingLike[],
  sameEvidencePinnedRepeatedly = false,
): PresentedGovernedLayerCheck {
  const state = coverageStateOf(check);
  const existing = (check as { message_sv?: unknown }).message_sv;
  if (typeof existing === 'string') {
    // The document check (K0) brings its own Swedish text; it has no ADMIT contract.
    return {
      ...check,
      coverage_state: state,
      message_sv: existing,
      coverage_limitation_sv: MISSING_IN_BASIS_SV,
      known_coverage_gaps: [],
    };
  }
  const evidence = check.evidence_artifact_id ? evidenceById.get(check.evidence_artifact_id) : undefined;
  const view = spatialEvidenceView(evidence);
  const storedRiskLevel = highestGovernedRiskLevel(findings.filter((f) => check.rule_id !== null && f?.rule_id === check.rule_id));
  return {
    ...check,
    coverage_state: state,
    message_sv: spatialCheckMessageSv(check, state, view, storedRiskLevel, sameEvidencePinnedRepeatedly),
    coverage_limitation_sv: admitV1ContractFacts(view.versionHash)?.coverage_limitation_sv ?? MISSING_IN_BASIS_SV,
    known_coverage_gaps: knownCoverageGapsFor(view.versionHash),
  };
}

/**
 * The governed layer checks of one assessment, from its stored inputs only. Called by the fresh run
 * (with the evidence and findings it just persisted) and by the read-back (with the same artifacts
 * read back from CAS), so both produce the same array.
 *
 * @param pinnedEvidenceRefs the assessment's own payload.evidence_refs (document check, K0).
 * @param spatialEvidenceUnreadable true when a pinned SPATIAL_EVIDENCE could not be read: a layer
 *        without readable evidence is then a technical error, never "no evidence".
 */
export function presentedGovernedLayerChecks(input: {
  readonly spatialEvidence: readonly SpatialEvidenceArtifact[];
  readonly findings: readonly StoredFindingLike[];
  readonly pinnedEvidenceRefs: unknown;
  readonly spatialEvidenceUnreadable?: boolean;
  /**
   * U20CDF: pinned refs that could not be read from CAS (read-back); a pinned document among them is
   * a technical error. U20CDF2 (G2): so is the layer of a stored risk finding that cites one of them.
   */
  readonly unreadableArtifactIds?: readonly string[];
}): PresentedGovernedLayerCheck[] {
  // U20CDF3 (U20CDF2 verification H4 / low 2): exactly the governed M layers -- never an extra row for
  // evidence of another dataset (an unknown or mis-cased one gave "6 av 7"). Such evidence makes the
  // record a typed integrity error instead (resolveGovernedAssessmentDetails -> pinnedEvidence ->
  // assessGovernedCoverage: RECORD_INTEGRITY_ERROR).
  const requestedLayers: string[] = [...LU_V1_GOVERNED_SPATIAL_LAYERS];
  const spatial = computeGovernedLayerChecks({
    requestedLayers,
    evidence: input.spatialEvidence,
    // A layer whose query failed is represented by its NOT_CHECKED finding, which is persisted in the
    // assessment; the provider's live failure list is not (and its raw error text never reaches here).
    unavailableLayers: [],
    findings: input.findings,
    unreadableArtifactIds: input.unreadableArtifactIds,
  }).map((check) =>
    input.spatialEvidenceUnreadable && check.reason === 'NO_EVIDENCE'
      ? { ...check, reason: 'PINNED_EVIDENCE_UNREADABLE' }
      : check,
  );
  const evidenceById = new Map(input.spatialEvidence.map((evidence) => [evidence.artifact_id, evidence] as const));
  // U20CDF4 (U20CDF3 verification L4): which layers hold the same pinned evidence more than once (one
  // ref pinned twice) rather than more than one evidence.
  const sameEvidenceRepeated = (layer: string): boolean => {
    const ids = input.spatialEvidence
      .filter((evidence) => evidence.payload?.source_metadata?.dataset === layer)
      .map((evidence) => evidence.artifact_id);
    return ids.length > 1 && new Set(ids).size === 1;
  };
  const documentCheck = computeGovernedDocumentCheck(input.pinnedEvidenceRefs, {
    unreadableArtifactIds: input.unreadableArtifactIds,
  });
  return [...spatial, documentCheck].map((check) =>
    presentCheck(check, evidenceById, input.findings, sameEvidenceRepeated(check.layer)),
  );
}

// ---------------------------------------------------------------------------------------------
// Evidence details
// ---------------------------------------------------------------------------------------------

export type EvidenceIntegrity =
  | 'CONTENT_HASH_VERIFIED'
  | 'STRUCTURAL_ONLY'
  | 'TAMPERED'
  | 'CORRUPTED'
  | 'NOT_INTERPRETED';

export type EvidenceTechnicalErrorClass =
  | 'EVIDENCE_NOT_FOUND'
  | 'EVIDENCE_READ_ERROR'
  | 'EVIDENCE_TAMPERED'
  | 'EVIDENCE_CORRUPTED';

/**
 * Binding strength (U20-U30 spec 1.2):
 *  - HASH_BOUND_LEDGER_METADATA: the evidence is hash-bound into the assessment; its dataset version
 *    is the registry content hash (= ADMIT v1 source_sha256), which was matched against the import
 *    ledger when the query ran. The table content itself was not verified and no import batch is
 *    recorded in the evidence -- a metadata binding.
 *  - HASH_BOUND_LEGACY_ADOPTED: as above, and the contract marks the source as a legacy-adopted
 *    delivery (existing data adopted, the weakest class).
 *  - HASH_BOUND_CONTRACT_UNKNOWN: as above, but the dataset version is not in the ADMIT v1 contracts.
 *  - HASH_BOUND: a document fact verified against its own content hash.
 *  - STRUCTURAL_ONLY: document evidence checked structurally here; its full verification is verify's.
 *  - NONE: the evidence could not be read, failed verification, or is not interpreted here.
 */
export type EvidenceBindingAssurance =
  | 'HASH_BOUND_LEDGER_METADATA'
  | 'HASH_BOUND_LEGACY_ADOPTED'
  | 'HASH_BOUND_CONTRACT_UNKNOWN'
  | 'HASH_BOUND'
  | 'STRUCTURAL_ONLY'
  | 'NONE';

export interface GovernedEvidenceDetail {
  readonly evidence_artifact_id: string;
  readonly artifact_type: string;
  readonly resolution: 'RESOLVED' | 'NOT_FOUND' | 'READ_ERROR';
  readonly integrity: EvidenceIntegrity | null;
  readonly technical_error_class: EvidenceTechnicalErrorClass | null;
  readonly content_hash: string | null;
  readonly layer: string | null;
  readonly provider: string | null;
  /** The governed dataset identity (registry content hash) the evidence is bound to. */
  readonly dataset_version_hash: string | null;
  /** Human label as requested (e.g. "v1.0"); not an identity. */
  readonly layer_version_label: string | null;
  /** Never recorded in current evidence (spec 1.1): always null, shown as "Saknas i underlaget". */
  readonly import_batch_id: null;
  /** Provenance timestamp outside the identity domain; null when absent. */
  readonly retrieved_at: string | null;
  readonly query: {
    readonly relation: string | null;
    readonly subject_kind: string | null;
    readonly location_ref: { readonly artifact_id: string; readonly artifact_type: string } | null;
    readonly property_context_ref: { readonly artifact_id: string; readonly artifact_type: string } | null;
    readonly distance_meters: number | null;
  } | null;
  readonly result: {
    readonly semantics_kind: string | null;
    readonly exists: boolean | null;
    readonly match_count_observed: number | null;
    readonly max_features_per_layer: number | null;
    readonly cap_reached: boolean | null;
  } | null;
  readonly binding_assurance: EvidenceBindingAssurance;
  readonly contract: AdmitV1LayerContractFacts | null;
  readonly coverage_limitation_sv: string;
  /** U20CDF: machine-readable entries behind coverage_limitation_sv (kind, date, basis, not rechecked, sources). */
  readonly known_coverage_gaps: readonly KnownCoverageGap[];
  /** Findings of the assessment that cite this evidence (Finding -> Evidence drilldown). */
  readonly cited_by_finding_ids: readonly string[];
  readonly message_sv: string;
  readonly binding_note_sv: string;
}

const NOT_FOUND = (artifactId: string) => `Artifact not found: ${artifactId}`;

type ReadOutcome =
  | { readonly kind: 'read'; readonly artifact: unknown }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'corrupted' }
  | { readonly kind: 'error' };

/** Same determined/technical split as the M1a currentness provider (frozen repository contract). */
async function readArtifact(repo: ArtifactRepositoryPort, ref: { artifact_id: string; artifact_type: string }): Promise<ReadOutcome> {
  try {
    return { kind: 'read', artifact: await repo.resolve<unknown>(ref) };
  } catch (error) {
    if (error instanceof Error && error.message === NOT_FOUND(ref.artifact_id)) return { kind: 'not_found' };
    if (error instanceof Error && error.name === 'CASIntegrityError') return { kind: 'corrupted' };
    return { kind: 'error' };
  }
}

/** The evidence families an assessment's evidence_refs has ever named (in their one spelling). */
const EVIDENCE_REF_TYPES: readonly string[] = ['SPATIAL_EVIDENCE', 'DOCUMENT_EVIDENCE', 'VERIFIED_DOCUMENT_FACT'];

/**
 * U20CDF4 (U20CDF3 verification L6.2; owner decision 2): an evidence_refs entry that is not a
 * well-formed ref -- not an object, no non-empty string id or type, or a known evidence type in another
 * spelling ('spatial_evidence', ' SPATIAL_EVIDENCE'). Refs are built from artifacts by every producer,
 * so this breaks the ref contract. A well-formed ref of another family is not malformed (it is listed
 * as NOT_INTERPRETED).
 */
function isMalformedEvidenceRef(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
  const { artifact_id: id, artifact_type: type } = entry as { artifact_id?: unknown; artifact_type?: unknown };
  if (typeof id !== 'string' || id.length === 0 || typeof type !== 'string' || type.length === 0) return true;
  const normalized = type.trim().toUpperCase();
  return EVIDENCE_REF_TYPES.includes(normalized) && type !== normalized;
}

function asRef(value: unknown): { artifact_id: string; artifact_type: string } | null {
  if (!value || typeof value !== 'object') return null;
  const { artifact_id: id, artifact_type: type } = value as { artifact_id?: unknown; artifact_type?: unknown };
  return typeof id === 'string' && id && typeof type === 'string' && type ? { artifact_id: id, artifact_type: type } : null;
}

function emptyDetail(ref: { artifact_id: string; artifact_type: string }, citedBy: readonly string[]) {
  return {
    evidence_artifact_id: ref.artifact_id,
    artifact_type: ref.artifact_type,
    content_hash: null,
    layer: null,
    provider: null,
    dataset_version_hash: null,
    layer_version_label: null,
    import_batch_id: null,
    retrieved_at: null,
    query: null,
    result: null,
    contract: null,
    coverage_limitation_sv: MISSING_IN_BASIS_SV,
    known_coverage_gaps: [] as readonly KnownCoverageGap[],
    cited_by_finding_ids: citedBy,
  } as const;
}

function unreadableDetail(
  ref: { artifact_id: string; artifact_type: string },
  citedBy: readonly string[],
  outcome: 'not_found' | 'error' | 'corrupted',
): GovernedEvidenceDetail {
  const technicalClass: EvidenceTechnicalErrorClass =
    outcome === 'not_found' ? 'EVIDENCE_NOT_FOUND' : outcome === 'corrupted' ? 'EVIDENCE_CORRUPTED' : 'EVIDENCE_READ_ERROR';
  return {
    ...emptyDetail(ref, citedBy),
    resolution: outcome === 'not_found' ? 'NOT_FOUND' : outcome === 'corrupted' ? 'RESOLVED' : 'READ_ERROR',
    integrity: outcome === 'corrupted' ? 'CORRUPTED' : null,
    technical_error_class: technicalClass,
    binding_assurance: 'NONE',
    // W-UI1 (C, owner decision 5): plain Swedish for the user; the class stays in technical_error_class.
    message_sv:
      outcome === 'corrupted'
        ? 'Tekniskt fel: evidensens lagrade innehåll stämmer inte med sin innehållskontroll.'
        : outcome === 'not_found'
          ? 'Tekniskt fel: evidensen hittades inte i arkivet.'
          : 'Tekniskt fel: evidensen kunde inte läsas ur arkivet (läsfel).',
    binding_note_sv: 'Ingen bindning kan redovisas: evidensen kunde inte läsas.',
  };
}

function tamperedDetail(ref: { artifact_id: string; artifact_type: string }, citedBy: readonly string[]): GovernedEvidenceDetail {
  return {
    ...emptyDetail(ref, citedBy),
    resolution: 'RESOLVED',
    integrity: 'TAMPERED',
    technical_error_class: 'EVIDENCE_TAMPERED',
    binding_assurance: 'NONE',
    message_sv: 'Integritetsfel: den lagrade evidensen stämmer inte med sin egen identitet (innehåll, id eller typ).',
    binding_note_sv: 'Ingen bindning kan redovisas: evidensen klarade inte integritetskontrollen.',
  };
}

const SPATIAL_BINDING_NOTE_SV =
  'Evidensen är hashbunden i bedömningen. Datasetversionen är registrets innehållshash och jämfördes mot ' +
  'importledgern när frågan kördes (metadatabindning): tabellinnehållet verifierades inte och importbatch ' +
  'registreras inte i evidensen.';

function spatialDetail(
  ref: { artifact_id: string; artifact_type: string },
  artifact: SpatialEvidenceArtifact,
  citedBy: readonly string[],
): GovernedEvidenceDetail {
  const payload = artifact.payload;
  const view = spatialEvidenceView(artifact);
  const semantics = payload.result_semantics as {
    kind?: unknown;
    result?: { exists?: unknown };
  };
  const exists = typeof semantics?.result?.exists === 'boolean' ? semantics.result.exists : null;
  const contract = admitV1ContractFacts(view.versionHash);
  const queryContract = hasSpatialEvidenceQueryContract(payload) ? payload.query_contract : null;
  const subject = queryContract?.subject as
    | { kind?: unknown; location_ref?: unknown; property_context_ref?: unknown }
    | undefined;
  const layer = typeof payload.source_metadata?.dataset === 'string' ? payload.source_metadata.dataset : null;
  const capReached = view.matchCount !== null && view.maxFeatures !== null ? view.matchCount >= view.maxFeatures : null;
  const bindingAssurance: EvidenceBindingAssurance = !contract
    ? 'HASH_BOUND_CONTRACT_UNKNOWN'
    : contract.legacy_adopted
      ? 'HASH_BOUND_LEGACY_ADOPTED'
      : 'HASH_BOUND_LEDGER_METADATA';
  // U20CDF2 (G3): the evidence's own result is read through the same normal form as the fresh-run
  // gate and the layer checks -- e.g. exists:true with match count 0 is not shown as a hit.
  const form = readSpatialEvidenceForm(artifact);
  // U20CDF3 (low 2): evidence of a dataset outside the governed layers is not a register result of any
  // check -- it is not presented as a hit or a no-hit (the record is an integrity error).
  const outsideGovernedLayers = layer === null || !isGovernedSpatialLayer(layer);
  const pseudoCheck: GovernedLayerCheck = {
    layer: layer ?? 'okänt lager',
    rule_id: null,
    status: !form.valid ? 'NOT_CHECKED' : form.exists ? 'CHECKED_HIT' : 'CHECKED_NO_HIT',
    evidence_artifact_id: ref.artifact_id,
    // U20CDF4 (owner decision 2): the same split as the layer row -- a declared contract that is broken
    // is an integrity error; older evidence without one cannot be interpreted.
    reason: form.valid ? null : declaresSpatialResultContract(artifact) ? 'EVIDENCE_VIOLATES_RESULT_CONTRACT' : 'UNRECOGNIZED_RESULT',
  };
  return {
    evidence_artifact_id: ref.artifact_id,
    artifact_type: ref.artifact_type,
    resolution: 'RESOLVED',
    integrity: 'CONTENT_HASH_VERIFIED',
    technical_error_class: null,
    content_hash: artifact.content_hash?.value ?? null,
    layer,
    provider: view.provider,
    dataset_version_hash: view.versionHash,
    layer_version_label: typeof payload.layer_ref?.layer_version === 'string' ? payload.layer_ref.layer_version : null,
    import_batch_id: null,
    retrieved_at: typeof payload.source_metadata?.retrieved_at === 'string' ? payload.source_metadata.retrieved_at : null,
    query: {
      relation: typeof queryContract?.relation === 'string' ? queryContract.relation : null,
      subject_kind: typeof subject?.kind === 'string' ? subject.kind : null,
      location_ref: asRef(subject?.location_ref),
      property_context_ref: asRef(subject?.property_context_ref),
      distance_meters: view.distanceMeters,
    },
    result: {
      semantics_kind: typeof semantics?.kind === 'string' ? semantics.kind : null,
      exists,
      match_count_observed: view.matchCount,
      max_features_per_layer: view.maxFeatures,
      cap_reached: capReached,
    },
    binding_assurance: bindingAssurance,
    contract,
    coverage_limitation_sv: contract?.coverage_limitation_sv ?? MISSING_IN_BASIS_SV,
    known_coverage_gaps: knownCoverageGapsFor(view.versionHash),
    cited_by_finding_ids: citedBy,
    message_sv: outsideGovernedLayers
      ? 'Integritetsfel: evidensen gäller ett lager utanför de styrda kontrollerna och tolkas inte som ett kontrollresultat.'
      : spatialCheckMessageSv(pseudoCheck, coverageStateOf(pseudoCheck), view),
    binding_note_sv:
      bindingAssurance === 'HASH_BOUND_LEGACY_ADOPTED'
        ? `${SPATIAL_BINDING_NOTE_SV} Källan är enligt ADMIT v1-kontraktet en legacy-adopterad leverans (${contract!.source_version}): befintliga data som adopterats, den svagaste bindningsklassen.`
        : bindingAssurance === 'HASH_BOUND_CONTRACT_UNKNOWN'
          ? `${SPATIAL_BINDING_NOTE_SV} Datasetversionen finns inte i ADMIT v1-kontrakten.`
          : SPATIAL_BINDING_NOTE_SV,
  };
}

function isSpatialEvidenceIntact(ref: { artifact_id: string }, artifact: unknown): artifact is SpatialEvidenceArtifact {
  const candidate = artifact as SpatialEvidenceArtifact | null;
  if (!candidate || candidate.artifact_type !== 'SPATIAL_EVIDENCE' || candidate.artifact_id !== ref.artifact_id) return false;
  try {
    // Same "never trust a present hash" check as verify (H15): recompute from the payload.
    return buildSpatialEvidenceContentHash(candidate.payload).value === candidate.content_hash?.value;
  } catch {
    return false;
  }
}

/**
 * U20CDF4 (coordinator clarification 3 of the owner decisions 2026-10-03 (4): historical pre-contract
 * data is HISTORICAL_COVERAGE_UNKNOWN, never corruption). SPATIAL_EVIDENCE existed from 2026-08-04
 * WITHOUT result_semantics; b2f7ea9b (2026-08-13) introduced the field, and today's identity function
 * requires it, so such evidence cannot get an identity -- it used to be called EVIDENCE_TAMPERED (424).
 * It is pre-contract only in a legacy V1 assessment (no assessment_contract_version: V2 arrived
 * 2026-08-23, after the contract); its own id and type must still match the ref.
 */
function isPreContractSpatialEvidence(ref: { artifact_id: string }, artifact: unknown, legacyAssessment: boolean): boolean {
  if (!legacyAssessment) return false;
  const candidate = artifact as { artifact_id?: unknown; artifact_type?: unknown; payload?: unknown } | null;
  if (!candidate || candidate.artifact_type !== 'SPATIAL_EVIDENCE' || candidate.artifact_id !== ref.artifact_id) return false;
  const payload = candidate.payload;
  return Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload) && (payload as { result_semantics?: unknown }).result_semantics === undefined;
}

/**
 * U20CDF4: the read model of pre-contract evidence -- ONLY its dataset (to place it on its layer, where
 * it reads "Ofullständigt underlag", never checked). Its other content cannot be verified, so nothing
 * else of it (provider, result, query) is taken over or echoed.
 */
function preContractLayerView(ref: { artifact_id: string; artifact_type: string }, dataset: string | null): SpatialEvidenceArtifact {
  return { artifact_id: ref.artifact_id, artifact_type: ref.artifact_type, payload: { source_metadata: { dataset } } } as unknown as SpatialEvidenceArtifact;
}

function preContractDetail(
  ref: { artifact_id: string; artifact_type: string },
  dataset: string | null,
  citedBy: readonly string[],
): GovernedEvidenceDetail {
  return {
    ...emptyDetail(ref, citedBy),
    resolution: 'RESOLVED',
    integrity: 'NOT_INTERPRETED',
    technical_error_class: null,
    layer: dataset !== null && isGovernedSpatialLayer(dataset) ? dataset : null,
    binding_assurance: 'NONE',
    message_sv:
      'Äldre evidens från före resultatkontraktet: den saknar resultatsemantik, så dess innehåll kan inte verifieras mot dagens ' +
      'identitetskontrakt och tolkas inte som ett kontrollresultat.',
    binding_note_sv: 'Ingen bindning kan redovisas: evidensen är äldre än det kontrakt som dess identitet i dag beräknas efter.',
  };
}

function documentDetail(
  ref: { artifact_id: string; artifact_type: string },
  artifact: unknown,
  citedBy: readonly string[],
): GovernedEvidenceDetail {
  const candidate = artifact as { artifact_id?: unknown; artifact_type?: unknown; content_hash?: { value?: unknown } } | null;
  const contentHash = typeof candidate?.content_hash?.value === 'string' ? candidate.content_hash.value : null;
  if (ref.artifact_type === 'VERIFIED_DOCUMENT_FACT') {
    const fact = artifact as VerifiedDocumentFactArtifact;
    if (!isVerifiedDocumentFact(fact) || fact.artifact_id !== ref.artifact_id || !isVerifiedDocumentFactContentHashValid(fact)) {
      return tamperedDetail(ref, citedBy);
    }
    return {
      ...emptyDetail(ref, citedBy),
      resolution: 'RESOLVED',
      integrity: 'CONTENT_HASH_VERIFIED',
      technical_error_class: null,
      content_hash: contentHash,
      binding_assurance: 'HASH_BOUND',
      message_sv: 'Verifierat dokumentfaktum (mänskligt verifierat), knutet till bedömningen.',
      binding_note_sv: 'Faktumet är hashbundet och verifierat mot sitt eget innehåll.',
    };
  }
  // DOCUMENT_EVIDENCE: structural here (same rule as verify for V1); full verification belongs to verify.
  if (candidate?.artifact_type !== 'DOCUMENT_EVIDENCE' || candidate.artifact_id !== ref.artifact_id || !contentHash) {
    return tamperedDetail(ref, citedBy);
  }
  return {
    ...emptyDetail(ref, citedBy),
    resolution: 'RESOLVED',
    integrity: 'STRUCTURAL_ONLY',
    technical_error_class: null,
    content_hash: contentHash,
    binding_assurance: 'STRUCTURAL_ONLY',
    message_sv: 'Dokumentevidens knuten till bedömningen.',
    // W-UI1 (C; coordinator 2026-10-03): verify checks consistency only -- never "fullständig", never authenticity.
    binding_note_sv:
      'Dokumentevidensen kontrolleras här bara strukturellt (typ, id och innehållskontroll finns). ' +
      'Reproducerbarhetskontrollen prövar konsistensen mot de pinnade artefakterna, inte äktheten.',
  };
}

function notInterpretedDetail(
  ref: { artifact_id: string; artifact_type: string },
  artifact: unknown,
  citedBy: readonly string[],
): GovernedEvidenceDetail {
  const contentHash = (artifact as { content_hash?: { value?: unknown } } | null)?.content_hash?.value;
  return {
    ...emptyDetail(ref, citedBy),
    resolution: 'RESOLVED',
    integrity: 'NOT_INTERPRETED',
    technical_error_class: null,
    content_hash: typeof contentHash === 'string' ? contentHash : null,
    binding_assurance: 'NONE',
    // W-UI1 (C): the type code stays in artifact_type (technical); the sentence names no code.
    message_sv: 'En evidenstyp som denna vy inte tolkar redovisas inte här.',
    binding_note_sv: 'Ingen bindning redovisas för en evidenstyp som inte tolkas här.',
  };
}

// ---------------------------------------------------------------------------------------------
// Property root (K5)
// ---------------------------------------------------------------------------------------------

export interface PropertyRootDetails {
  readonly status: 'RESOLVED' | 'NOT_RECORDED' | 'TECHNICAL_ERROR' | 'TAMPERED';
  readonly technical_error_class: string | null;
  readonly property_context_artifact_id: string | null;
  readonly property_designation: string | null;
  readonly property_identity: string | null;
  readonly project_property_binding_artifact_id: string | null;
  readonly observation_artifact_id: string | null;
  readonly observation_contract_version: string | null;
  readonly resolver_id: string | null;
  readonly source_dataset: string | null;
  readonly source_key: string | null;
  readonly source_updated_at: string | null;
  /** No import batch / dataset content hash exists in the current root artifacts (spec 1.3). */
  readonly dataset_binding: null;
  readonly assurance: 'UNBOUND_METADATA' | 'UNKNOWN';
  readonly message_sv: string;
}

export const ROOT_UNBOUND_SV = 'Rotens datasetbindning saknas (lägre säkerhet).';

function rootDetails(partial: Partial<PropertyRootDetails> & Pick<PropertyRootDetails, 'status' | 'message_sv'>): PropertyRootDetails {
  return {
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
    ...partial,
  };
}

function sameIdentity(stored: { artifact_id?: unknown; content_hash?: { value?: unknown } }, rebuilt: { artifact_id: string; content_hash: { value: string } }): boolean {
  return stored.artifact_id === rebuilt.artifact_id && stored.content_hash?.value === rebuilt.content_hash.value;
}

/**
 * W-U20CDF5-R3 (U20CDF5-R2 verification R2-3; the L4 class): every root artifact carries a payload object. One without
 * it is a damaged (truncated) object -- an integrity verdict, never "an older contract" or "a contract version this
 * view does not interpret".
 */
function hasPayloadObject(artifact: unknown): boolean {
  const payload = (artifact as { payload?: unknown } | null)?.payload;
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

/**
 * W-U20CDF5-R2 (U20CDF5 verification G, probe Gc; the CATCH3 class): a property-root artifact read under `ref` must
 * BE that artifact -- the shared assertReadUnderItsOwnId (id and type). Another, self-consistent object under a
 * misdirected index entry (a legacy context is not rebuilt, so nothing else catches it) is an integrity verdict,
 * never its property designation.
 */
function isReadUnderItsOwnRef(artifact: unknown, ref: { artifact_id: string; artifact_type: string }): boolean {
  try {
    assertReadUnderItsOwnId('property-root', artifact, ref.artifact_id, ref.artifact_type);
    return true;
  } catch (error) {
    if (error instanceof LuReadFaultError) return false;
    throw error;
  }
}

async function resolvePropertyRoot(
  repo: ArtifactRepositoryPort,
  propertyRef: unknown,
): Promise<PropertyRootDetails> {
  const ref = asRef(propertyRef);
  if (!ref) {
    return rootDetails({ status: 'NOT_RECORDED', message_sv: `${ROOT_UNBOUND_SV} Bedömningen saknar fastighetsreferens.` });
  }
  const technical = (cls: string) =>
    rootDetails({
      status: 'TECHNICAL_ERROR',
      technical_error_class: cls,
      property_context_artifact_id: ref.artifact_id,
      message_sv: `${ROOT_UNBOUND_SV} Fastighetsrotens proveniens kunde inte läsas (${cls}).`,
    });
  const tampered = () =>
    rootDetails({
      status: 'TAMPERED',
      technical_error_class: 'ROOT_PROVENANCE_TAMPERED',
      property_context_artifact_id: ref.artifact_id,
      message_sv: 'Integritetsfel: fastighetsrotens artefakter stämmer inte med sin egen identitet.',
    });

  const contextRead = await readArtifact(repo, ref);
  if (contextRead.kind === 'not_found') return technical('ROOT_ARTIFACT_NOT_FOUND');
  if (contextRead.kind === 'corrupted') return tampered();
  if (contextRead.kind === 'error') return technical('ROOT_READ_ERROR');
  if (!isReadUnderItsOwnRef(contextRead.artifact, ref)) return tampered();
  if (!hasPayloadObject(contextRead.artifact)) return tampered();
  const context = contextRead.artifact as LUPropertyContextArtifact;
  const bindingRef = asRef(context?.payload?.project_property_binding_ref);
  if (
    !bindingRef ||
    typeof context.payload.property_identity !== 'string' ||
    // Only the product context contract can be rebuilt and identity-checked here.
    context.payload.context_contract_version !== PRODUCT_LU_CONTEXT_CONTRACT_VERSION
  ) {
    return rootDetails({
      status: 'NOT_RECORDED',
      property_context_artifact_id: ref.artifact_id,
      property_designation: typeof context?.payload?.property_ref === 'string' ? context.payload.property_ref : null,
      message_sv: `${ROOT_UNBOUND_SV} Fastighetskontexten följer ett äldre kontrakt utan registrerad proveniens för uppslaget.`,
    });
  }
  try {
    const rebuilt = createProductLuPropertyContextArtifact({
      property_identity: context.payload.property_identity,
      property_ref: context.payload.property_ref,
      official_name: context.payload.official_name,
      geometry_ref: context.payload.geometry_ref,
      municipality: context.payload.municipality,
      coordinates: context.payload.coordinates,
      project_property_binding_ref: bindingRef,
    });
    if (!sameIdentity(context, rebuilt)) return tampered();
  } catch {
    return tampered();
  }

  const bindingRead = await readArtifact(repo, bindingRef);
  if (bindingRead.kind === 'not_found') return technical('ROOT_ARTIFACT_NOT_FOUND');
  if (bindingRead.kind === 'corrupted') return tampered();
  if (bindingRead.kind === 'error') return technical('ROOT_READ_ERROR');
  if (!isReadUnderItsOwnRef(bindingRead.artifact, bindingRef)) return tampered();
  let binding: ProjectPropertyBindingArtifact;
  try {
    binding = validateProjectPropertyBindingArtifact(bindingRead.artifact as ProjectPropertyBindingArtifact);
  } catch {
    return tampered();
  }
  const observationRef = (binding.payload.source_refs ?? []).map(asRef).find((r) => r?.artifact_type === PROPERTY_LOOKUP_OBSERVATION_ARTIFACT_TYPE);
  const base = {
    property_context_artifact_id: ref.artifact_id,
    property_designation: binding.payload.property_designation,
    property_identity: binding.payload.property_identity,
    project_property_binding_artifact_id: binding.artifact_id,
  };
  if (!observationRef) {
    return rootDetails({
      ...base,
      status: 'NOT_RECORDED',
      message_sv: `${ROOT_UNBOUND_SV} Fastighetsbindningen pekar inte på något registrerat fastighetsuppslag.`,
    });
  }
  const observationRead = await readArtifact(repo, observationRef);
  if (observationRead.kind === 'not_found') return { ...technical('ROOT_ARTIFACT_NOT_FOUND'), ...base, observation_artifact_id: observationRef.artifact_id };
  if (observationRead.kind === 'corrupted') return tampered();
  if (observationRead.kind === 'error') return { ...technical('ROOT_READ_ERROR'), ...base, observation_artifact_id: observationRef.artifact_id };
  if (!isReadUnderItsOwnRef(observationRead.artifact, observationRef)) return tampered();
  if (!hasPayloadObject(observationRead.artifact)) return tampered();
  const observation = observationRead.artifact as PropertyLookupObservationArtifact;
  if (observation?.payload?.resolver_version !== CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION) {
    // A newer/older observation contract (e.g. U20-B's v2) is not interpreted by this version.
    return rootDetails({
      ...base,
      status: 'NOT_RECORDED',
      observation_artifact_id: observationRef.artifact_id,
      message_sv: `${ROOT_UNBOUND_SV} Fastighetsuppslagets kontraktsversion tolkas inte i denna vy.`,
    });
  }
  try {
    const rebuilt = createPropertyLookupObservationArtifact({
      property_identity: observation.payload.property_identity,
      property_designation: observation.payload.property_designation,
      source_key: observation.payload.source_key,
      source_dataset: observation.payload.source_dataset,
      source_updated_at: observation.payload.source_updated_at,
      municipality: observation.payload.municipality,
      geometry_ref: observation.payload.geometry_ref,
    });
    if (!sameIdentity(observation, rebuilt) || observation.artifact_id !== observationRef.artifact_id) return tampered();
  } catch {
    return tampered();
  }
  const payload = observation.payload;
  return rootDetails({
    ...base,
    status: 'RESOLVED',
    observation_artifact_id: observation.artifact_id,
    observation_contract_version: payload.resolver_version,
    resolver_id: payload.resolver_id,
    source_dataset: payload.source_dataset,
    source_key: payload.source_key,
    source_updated_at: payload.source_updated_at,
    assurance: 'UNBOUND_METADATA',
    message_sv:
      `${ROOT_UNBOUND_SV} Fastighetsroten bygger på ett uppslag i ${payload.source_dataset} ` +
      `(nyckel ${payload.source_key}, källan uppdaterad ${payload.source_updated_at}). Importbatch och ` +
      'innehållshash för källdatasetet registreras inte, och uppslagets entydighet registreras inte i ' +
      `denna kontraktsversion (${payload.resolver_version}).`,
  });
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export interface GovernedOverallStatement {
  /** governedVerdictFromFindings over the stored findings: the same machine value as the fresh run. */
  readonly risk_level: string;
  /** U20CDF2 (G1): whether this record's coverage can be established (see assessGovernedCoverage). */
  readonly coverage_state: GovernedRecordCoverageState;
  readonly coverage_basis: readonly string[];
  /** The N-of-M count; null unless coverage_state is DETERMINED. */
  readonly coverage: GovernedCheckCoverage | null;
  /** U20CDF2 (G2): present iff coverage_state is PINNED_EVIDENCE_UNREADABLE -- what could not be read, class, retryable. */
  readonly pinned_evidence?: PinnedEvidenceReadability;
  readonly statement_sv: string;
}

export interface GovernedAssessmentDetails {
  readonly evidenceDetails: readonly GovernedEvidenceDetail[];
  readonly governedLayerChecks: readonly PresentedGovernedLayerCheck[];
  /**
   * K0's machine-readable document check for the read-back -- the same pinned refs, plus (U20CDF F3)
   * what this read could not resolve from CAS. Equal to the `document` row of governedLayerChecks
   * without its presentation fields.
   */
  readonly documentCheck: GovernedDocumentCheck;
  /**
   * U20CDF2 (G2): what this read could not read among the pinned evidence refs, with its class
   * (EVIDENCE_NOT_FOUND = lasting loss, not retryable; EVIDENCE_READ_ERROR = retryable).
   */
  readonly pinnedEvidence: PinnedEvidenceReadability;
  readonly propertyRoot: PropertyRootDetails;
  /** Fail-closed signal for the read-back and the PDF: content that was read failed its own identity. */
  readonly integrity:
    | { readonly ok: true }
    | { readonly ok: false; readonly failureClass: 'EVIDENCE_TAMPERED' | 'EVIDENCE_CORRUPTED' | 'ROOT_PROVENANCE_TAMPERED'; readonly artifactId: string };
}

export async function resolveGovernedAssessmentDetails(input: {
  readonly assessment: Pick<LocalizationAssessmentArtifact, 'payload'>;
  readonly artifactRepository: ArtifactRepositoryPort;
}): Promise<GovernedAssessmentDetails> {
  const payload = input.assessment.payload as Partial<LocalizationAssessmentArtifact['payload']> | undefined;
  const findings: readonly AssessmentFinding[] = Array.isArray(payload?.findings) ? payload!.findings : [];
  const rawRefs: unknown = payload?.evidence_refs;
  // U20CDF4: only a legacy (V1) assessment can pin evidence from before the result contract.
  const legacyAssessment = (payload as { assessment_contract_version?: unknown } | undefined)?.assessment_contract_version === undefined;
  // U20CDF4 (U20CDF3 verification L6.2): a malformed entry used to be dropped here silently (or, in a
  // wrong spelling, read as an unknown family). It is not read -- it names no evidence that can be
  // trusted -- and the record reports it (MALFORMED_RECORD_ENTRY), never "unreadable" or "historical".
  const malformedRefIndexes = Array.isArray(rawRefs)
    ? rawRefs.flatMap((entry, index) => (isMalformedEvidenceRef(entry) ? [index] : []))
    : [];
  const refs = Array.isArray(rawRefs)
    ? rawRefs
        .filter((entry) => !isMalformedEvidenceRef(entry))
        .map(asRef)
        .filter((r): r is NonNullable<typeof r> => r !== null)
    : [];

  // U20CDF4 (L6.3): a stored finding that is not an object, or whose refs are not a list, is skipped
  // here (it used to throw: a generic 500); the record reports it as MALFORMED_RECORD_ENTRY.
  const citedBy = (artifactId: string) =>
    findings
      .filter(
        (finding) =>
          Boolean(finding) &&
          typeof finding === 'object' &&
          Array.isArray(finding.evidence_refs) &&
          finding.evidence_refs.some((r) => r?.artifact_id === artifactId),
      )
      .map((finding) => finding.finding_id)
      .filter((id): id is string => typeof id === 'string')
      .sort();

  const evidenceDetails: GovernedEvidenceDetail[] = [];
  const spatialEvidence: SpatialEvidenceArtifact[] = [];
  const unreadableArtifactIds: string[] = [];
  // U20CDF3 (low 2): intact spatial evidence whose dataset is not one of the governed layers.
  const outsideGovernedLayerIds: string[] = [];
  // U20CDF2 (G2): the class of what could not be read (a corrupted read fails the read-back closed).
  let anyNotFound = false;
  let anyReadError = false;
  let spatialEvidenceUnreadable = false;
  let integrityFailure: GovernedAssessmentDetails['integrity'] = { ok: true };

  for (const ref of refs) {
    const read = await readArtifact(input.artifactRepository, ref);
    const cited = citedBy(ref.artifact_id);
    if (read.kind !== 'read') {
      evidenceDetails.push(unreadableDetail(ref, cited, read.kind));
      unreadableArtifactIds.push(ref.artifact_id);
      if (read.kind === 'not_found') anyNotFound = true;
      if (read.kind === 'error') anyReadError = true;
      if (ref.artifact_type === 'SPATIAL_EVIDENCE') spatialEvidenceUnreadable = true;
      if (read.kind === 'corrupted' && integrityFailure.ok) {
        integrityFailure = { ok: false, failureClass: 'EVIDENCE_CORRUPTED', artifactId: ref.artifact_id };
      }
      continue;
    }
    let detail: GovernedEvidenceDetail;
    if (ref.artifact_type === 'SPATIAL_EVIDENCE') {
      if (isSpatialEvidenceIntact(ref, read.artifact)) {
        spatialEvidence.push(read.artifact);
        detail = spatialDetail(ref, read.artifact, cited);
        const dataset = read.artifact.payload?.source_metadata?.dataset;
        if (typeof dataset !== 'string' || !isGovernedSpatialLayer(dataset)) outsideGovernedLayerIds.push(ref.artifact_id);
      } else if (isPreContractSpatialEvidence(ref, read.artifact, legacyAssessment)) {
        // U20CDF4 (coordinator clarification 3): historical, never "tampered" -- see preContractDetail.
        const rawDataset = (read.artifact as { payload: { source_metadata?: { dataset?: unknown } } }).payload.source_metadata?.dataset;
        const dataset = typeof rawDataset === 'string' && rawDataset.length > 0 ? rawDataset : null;
        spatialEvidence.push(preContractLayerView(ref, dataset));
        detail = preContractDetail(ref, dataset, cited);
        if (dataset === null || !isGovernedSpatialLayer(dataset)) outsideGovernedLayerIds.push(ref.artifact_id);
      } else {
        detail = tamperedDetail(ref, cited);
      }
    } else if (ref.artifact_type === 'DOCUMENT_EVIDENCE' || ref.artifact_type === 'VERIFIED_DOCUMENT_FACT') {
      detail = documentDetail(ref, read.artifact, cited);
    } else {
      detail = notInterpretedDetail(ref, read.artifact, cited);
    }
    if (detail.integrity === 'TAMPERED' && integrityFailure.ok) {
      integrityFailure = { ok: false, failureClass: 'EVIDENCE_TAMPERED', artifactId: ref.artifact_id };
    }
    evidenceDetails.push(detail);
  }

  const propertyRoot = await resolvePropertyRoot(input.artifactRepository, payload?.property_ref);
  if (propertyRoot.status === 'TAMPERED' && integrityFailure.ok) {
    integrityFailure = { ok: false, failureClass: 'ROOT_PROVENANCE_TAMPERED', artifactId: propertyRoot.property_context_artifact_id ?? '' };
  }

  return {
    evidenceDetails,
    governedLayerChecks: presentedGovernedLayerChecks({
      spatialEvidence,
      findings,
      pinnedEvidenceRefs: rawRefs,
      spatialEvidenceUnreadable,
      unreadableArtifactIds,
    }),
    documentCheck: computeGovernedDocumentCheck(rawRefs, { unreadableArtifactIds }),
    pinnedEvidence: {
      pinned_total: refs.length,
      unreadable_artifact_ids: [...unreadableArtifactIds].sort(),
      // One lasting loss (not found) makes the record not retryable; only read errors may pass on retry.
      technical_error_class: anyNotFound ? 'EVIDENCE_NOT_FOUND' : anyReadError ? 'EVIDENCE_READ_ERROR' : null,
      retryable: anyNotFound ? false : anyReadError ? true : null,
      ...(outsideGovernedLayerIds.length > 0
        ? { outside_governed_layers_artifact_ids: [...outsideGovernedLayerIds].sort() }
        : {}),
      ...(malformedRefIndexes.length > 0 ? { malformed_evidence_ref_indexes: malformedRefIndexes } : {}),
      // W-U20CDF5 (M1): what LU-DOC-BESLUT-001 reads is pinned -- from the refs alone, no artifact read.
      ...(computeGovernedDocumentCheck(rawRefs).status === 'CHECKED_HIT' ? { document_rule_inputs_pinned: true } : {}),
    },
    propertyRoot,
    integrity: integrityFailure,
  };
}

/** The coverage-qualified overall statement (owner decision OD-K0-1) for a stored assessment. */
export function governedOverallStatement(
  riskLevel: string,
  checks: readonly GovernedLayerCheck[],
  context: GovernedStatementContext,
): GovernedOverallStatement {
  const assessed = assessGovernedCoverage(checks, context);
  return {
    risk_level: riskLevel,
    coverage_state: assessed.coverage_state,
    coverage_basis: assessed.coverage_basis,
    coverage: assessed.coverage,
    ...(assessed.pinned_evidence ? { pinned_evidence: assessed.pinned_evidence } : {}),
    statement_sv: governedOverallStatementSv(riskLevel, checks, context),
  };
}
