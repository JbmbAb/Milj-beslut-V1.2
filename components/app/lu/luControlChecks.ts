/**
 * DEMO M2a/M2b/M2c, W-M2d item 1 (LU product demonstrator) -- the LU v1 checks as knowledge states.
 *
 * Pure PRESENTATION of what the server states. Since W-M2d the UI derives no layer status, no
 * coverage and no counts of its own (M2b verifier finding 4: twelve rule differences between a client
 * derivation and the server's). Everything per check comes from GET
 * /api/localization/:projectId/current-assessment -- the same read-back for a fresh run and a reopen:
 *   - `governedLayerChecks[]`  (server/modules/localization/governedEvidenceDetails.ts
 *     presentedGovernedLayerChecks): layer, rule_id, status, reason, coverage_state, message_sv,
 *     coverage_limitation_sv, known_coverage_gaps -- the five map layers and the document check;
 *   - `evidenceDetails[]`      (per pinned evidence: dataset version, radius, result, cap, retrieved_at,
 *     binding assurance, ADMIT contract, coverage, technical error class);
 *   - `overallStatement.coverage.limited_coverage_layers` (the server's own "limited" list);
 *   - `propertyRoot`           (the property root's provenance and assurance);
 * plus GET /api/localization/:projectId/geometry for the control point. What is kept here is
 * presentation only: Swedish labels, the row order, chip colours, and the plain-Swedish limit of a
 * negative register result (SI-2). A field the server does not send reads "Saknas i underlaget".
 *
 * The six knowledge states (DIRECTIVE-72H §11) are kept apart, never collapsed into each other; they
 * map one to one from the server's `coverage_state`:
 *   CHECKED_HIT        -> HIT                kontrollerat – träff
 *   CHECKED_NO_HIT     -> NO_HIT             kontrollerat – ingen registrerad träff (never "clean
 *                                            ground", "no risk" or "no impact")
 *   NOT_CHECKED        -> NOT_CHECKED        inte kontrollerat
 *   SOURCE_UNAVAILABLE -> SOURCE_UNAVAILABLE källa otillgänglig
 *   INCOMPLETE_EVIDENCE-> UNCERTAIN          ofullständigt underlag
 *   TECHNICAL_ERROR    -> TECHNICAL_ERROR    tekniskt fel
 * anything else, a missing check or a contradictory entry -> UNCERTAIN, never green. LOADING and the
 * transport states (no assessment, a run without assessment, an unreadable read-back) stay the
 * client's own: they say what the UI could fetch, not what the data says.
 *
 * Invariants: silence is never absence; a technical failure is never "ofullständigt underlag" or
 * green; distance_meters is a SEARCH RADIUS, never a measured distance; a count at the cap is "minst N".
 */

import { LuClientError, type LuErrorDetailRow, type LuErrorPresentation } from './luErrorPresentation';
import { presentServerTextSv } from './luServerText';

export type LuCheckKey = 'property' | 'water' | 'ebh' | 'protected_area' | 'natura2000' | 'water_protection_area' | 'document';
/** A row key: one of the LU v1 checks, or `extra-<layer>` for a layer only the server reported. */
export type LuCheckRowKey = LuCheckKey | `extra-${string}`;

export type LuKnowledgeState =
  | 'HIT'
  | 'NO_HIT'
  | 'NOT_CHECKED'
  | 'SOURCE_UNAVAILABLE'
  | 'UNCERTAIN'
  | 'TECHNICAL_ERROR'
  | 'LOADING';

/**
 * Presentation only -- the machine-readable state (NO_HIT etc.) is unchanged. A negative REGISTER
 * result means "no registered object found in the searched area/source", never "clean ground", "no
 * risk" or "no impact" (owner's science-informed preservation requirement, 2026-10-02).
 */
export const LU_KNOWLEDGE_STATE_LABEL: Readonly<Record<LuKnowledgeState, string>> = {
  HIT: 'Kontrollerat – träff',
  NO_HIT: 'Kontrollerat – ingen registrerad träff',
  NOT_CHECKED: 'Inte kontrollerat',
  SOURCE_UNAVAILABLE: 'Källa otillgänglig',
  UNCERTAIN: 'Ofullständigt underlag',
  TECHNICAL_ERROR: 'Tekniskt fel',
  LOADING: 'Hämtar…',
};

/** The property row's HIT means "the property was found", not a risk signal. */
export const LU_PROPERTY_FOUND_LABEL = 'Hittad';

export interface LuCheckDefinition {
  readonly key: LuCheckKey;
  readonly label: string;
  /** Governed rule of this check (LURuleEngine LAYER_RULE_IDS / LU-DOC-BESLUT-001); null for the property row. */
  readonly ruleId: string | null;
  /** Plain-Swedish meaning of a hit, from the rule definition (existence within the search radius). */
  readonly hitMeaning: string | null;
}

/** The server's document check (governedLayerChecks.ts `layer: 'document'`), in the server's own words. */
export const LU_DOCUMENT_CHECK_LABEL = 'Dokument och tidigare beslut';

/** Row order and Swedish names (the same names the server's governedLayerLabelSv uses). */
export const LU_V1_CHECKS: readonly LuCheckDefinition[] = [
  { key: 'property', label: 'Fastighet och lokaliseringspunkt', ruleId: null, hitMeaning: null },
  { key: 'water', label: 'Brunnar', ruleId: 'LU-WATER-001', hitMeaning: 'Brunnar finns inom sökradien.' },
  {
    key: 'ebh',
    label: 'Potentiellt förorenade områden (EBH)',
    ruleId: 'LU-EBH-001',
    hitMeaning: 'Potentiellt förorenat område finns inom sökradien.',
  },
  { key: 'protected_area', label: 'Skyddad natur', ruleId: 'LU-PROTECTED-001', hitMeaning: 'Skyddad natur finns inom sökradien.' },
  { key: 'natura2000', label: 'Natura 2000', ruleId: 'LU-NATURA2000-001', hitMeaning: 'Natura 2000-område finns inom sökradien.' },
  {
    key: 'water_protection_area',
    label: 'Vattenskyddsområde',
    ruleId: 'LU-WATERPROTECTION-001',
    hitMeaning: 'Vattenskyddsområde finns inom sökradien.',
  },
  { key: 'document', label: LU_DOCUMENT_CHECK_LABEL, ruleId: 'LU-DOC-BESLUT-001', hitMeaning: null },
];

/** The five map layers (every check except the property row and the document check). */
const MAP_LAYER_KEYS: readonly LuCheckKey[] = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'];

/** Number of map layers the LU v1 run checks. */
export const LU_V1_LAYER_COUNT = MAP_LAYER_KEYS.length;

/**
 * W-M2d: the Swedish name of a governed check by the SERVER's layer id (presentation only). An id
 * this UI does not know is never shown raw in main text.
 */
export function governedCheckLabelSv(layer: string): string {
  return LU_V1_CHECKS.find((c) => c.key === layer && c.key !== 'property')?.label ?? 'annat underlag från servern';
}

export function checkDefinitionForRule(ruleId: string): LuCheckDefinition | null {
  return LU_V1_CHECKS.find((c) => c.ruleId === ruleId) ?? null;
}

/** A map layer's check (for a click on map evidence); null for anything else. */
export function checkDefinitionForLayer(layerId: string | null | undefined): LuCheckDefinition | null {
  if (!layerId) return null;
  return LU_V1_CHECKS.find((c) => c.key === layerId && MAP_LAYER_KEYS.includes(c.key)) ?? null;
}

/** The properties of one governed /viewer/evidence feature -- used only for the MAP (binding check). */
export interface LuViewerEvidenceProps {
  readonly layer_id?: unknown;
  readonly dataset?: unknown;
  readonly cas_artifact_id?: unknown;
  readonly [key: string]: unknown;
}

export interface LuFindingLike {
  readonly finding_id: string;
  readonly rule_id: string;
  readonly risk_level: string;
  readonly explanation?: string;
  readonly evidence_refs?: ReadonlyArray<{ artifact_id: string; artifact_type: string }>;
}

/**
 * Whether there is a governed assessment to show checks for.
 *   none          -- the server says there is no current assessment
 *   not_assessed  -- the latest run produced no assessment (fail-closed, denied, not admitted)
 *   error         -- it could not be read, or the sources disagree (kind INCOHERENT)
 */
export type LuAssessmentPresence =
  | { readonly status: 'none' }
  | { readonly status: 'not_assessed' }
  | { readonly status: 'loading' }
  | { readonly status: 'present' }
  | { readonly status: 'error'; readonly error: LuErrorPresentation };

export interface LuPropertyInput {
  readonly lookedUp: boolean;
  readonly lookupError?: LuErrorPresentation | null;
  readonly geometryLoading?: boolean;
  readonly geometryError?: LuErrorPresentation | null;
  readonly geometry?: {
    readonly artifact_id: string;
    readonly provenance: string;
    readonly wgs84LngLat: readonly [number, number];
    readonly provisioningStatus?: string | null;
  } | null;
  /**
   * DEMO M2c item 2: is the shown point the one the displayed assessment was made for (by
   * LocalizationGeometry artifact id)? 'none' when no assessment is shown.
   */
  readonly assessedPoint?: 'none' | 'bound' | 'changed' | 'unknown';
  /** The point id the displayed assessment states (technical section only). */
  readonly assessedGeometryId?: string | null;
  /** W-M2d item 1: the read-back's propertyRoot (server provenance + assurance), unparsed. */
  readonly propertyRoot?: unknown;
}

/** W-M2d item 1: what the read-back states per check, unparsed. */
export interface LuServerChecksInput {
  /** `governedLayerChecks`; null when the answer does not carry the field (or it is not an array). */
  readonly layerChecks: readonly unknown[] | null;
  /** `evidenceDetails`; null when absent. */
  readonly evidenceDetails: readonly unknown[] | null;
  /** `overallStatement.coverage.limited_coverage_layers` -- the server's own list. */
  readonly limitedCoverageLayers: readonly string[];
}

export interface LuCheckDetailRow {
  readonly label: string;
  readonly value: string;
}

/**
 * W-M2d item 3: one of the server's machine-readable `known_coverage_gaps` entries
 * (server/modules/localization/knownCoverageGaps.ts), shown next to the check's state.
 */
export interface LuKnownGapView {
  readonly id: string;
  /** CONTRACT_SCOPE | KNOWN_INCOMPLETE_DATA (or whatever the server sends). */
  readonly kind: string;
  /** Swedish line: kind label, date for a data gap, the server's own statement. */
  readonly text: string;
  readonly asOf: string | null;
  readonly basis: string | null;
  /** The server's `rechecked_against_current_table`; false = "ej omkontrollerad". */
  readonly rechecked: boolean;
  readonly sources: readonly string[];
}

export interface LuCheckView {
  readonly key: LuCheckRowKey;
  readonly label: string;
  readonly state: LuKnowledgeState;
  readonly stateLabel: string;
  readonly summary: string;
  /** NO_HIT only: what a negative register result does NOT show (shown under the row). */
  readonly registerNote: string | null;
  /** The server's coverage_limitation_sv for this check, when it states one. */
  readonly coverageNote: string | null;
  /** True when the SERVER marks this checked result as resting on a limited basis. */
  readonly coverageLimited: boolean;
  /** W-M2d item 3: the server's known coverage gaps for this check's dataset version, in its order. */
  readonly knownGaps: readonly LuKnownGapView[];
  /**
   * W-M2d item 3: the evidence's dataset version is not in the ADMIT v1 import contracts (server:
   * contract null / HASH_BOUND_CONTRACT_UNKNOWN) -- a checked result on it is never shown as plain green.
   */
  readonly datasetVersionUnknown: boolean;
  /** Rule that fires on this check, when there is one (for "Fynd i bedömningen"). */
  readonly ruleId: string | null;
  /** Rows for the evidence panel (result, count, radius, method, source, version, coverage, time ...). */
  readonly details: readonly LuCheckDetailRow[];
  /** Ids/hashes/codes for the collapsed "Teknisk information" section. */
  readonly technical: readonly LuCheckDetailRow[];
  /** Search radius in metres when the governed evidence states one (for the map ring). */
  readonly searchRadiusMeters: number | null;
  /** The governed evidence artifact id this check rests on, when there is one. */
  readonly evidenceArtifactId: string | null;
  /**
   * W-M2e item 3: property row only -- the server states a lower (or unknown) assurance of the property
   * root for the displayed assessment, so "Hittad" is qualified and never plainly shown.
   */
  readonly rootAssuranceQualified: boolean;
  /**
   * W-UI1 (D): property row only -- the server reports the property root as a READ error of unknown
   * persistence (ROOT_READ_ERROR): re-reading the assessment may help. Nothing is claimed about the root.
   */
  readonly rootReadRetryable: boolean;
}

export const MISSING = 'Saknas i underlaget';

/**
 * Per layer: the limit of a negative register check (SI-2). States only what kind of check it is and
 * what it does not show -- no new facts, no risk level, no hydrological or contamination conclusion.
 * The server's own row text says what was searched ("Ingen registrerad träff i ... inom 500 m").
 */
const NEGATIVE_REGISTER_LIMIT: Readonly<Record<string, string>> = {
  water: 'Det är en registerkontroll, inte en inventering i fält, och visar inte att oregistrerade brunnar eller påverkan saknas.',
  ebh: 'Det är en registerkontroll, inte en markundersökning, och visar inte markens skick eller att föroreningar eller påverkan saknas.',
  protected_area: 'Det är en registerkontroll, inte en naturinventering, och visar inte att naturvärden eller påverkan saknas.',
  natura2000: 'Det är en registerkontroll och visar inte att påverkan på Natura 2000-områden saknas.',
  water_protection_area:
    'Det är en registerkontroll, inte en undersökning av grundvatten eller vattentäkter, och visar inte att påverkan saknas.',
};
const NEGATIVE_UNKNOWN_LAYER_LIMIT = 'Servern redovisar inget registrerat objekt. Det visar inte att objekt eller påverkan saknas.';

/** Suffix on the HIT/NO_HIT chip of a check the server marks as limited (state itself unchanged). */
export const LU_LIMITED_COVERAGE_SUFFIX = ' · begränsad täckning';
/** W-M2d item 3: suffix when the server states a KNOWN gap in the data itself (not only the contract's scope). */
export const LU_KNOWN_GAP_SUFFIX = ' · känd lucka i underlaget';
/** W-M2d item 3: suffix when the evidence's dataset version is outside the import contracts. */
export const LU_UNKNOWN_VERSION_SUFFIX = ' · okänd datasetversion';
export const LU_UNKNOWN_VERSION_NOTE =
  'Datasetversionen finns inte i importkontrakten (ADMIT v1): källa, källversion och täckning kan inte anges (Saknas i underlaget).';

/** Swedish label per server gap kind (knownCoverageGaps.ts); an unknown kind is still shown. */
const GAP_KIND_LABEL_SV: Readonly<Record<string, string>> = {
  CONTRACT_SCOPE: 'Avgränsning enligt importkontraktet',
  KNOWN_INCOMPLETE_DATA: 'Känd lucka i underlaget',
};

/** W-M2e item 2 (inventory): the gap kinds with a label of their own. */
export const LU_KNOWN_GAP_KIND_TEXTS: readonly string[] = Object.freeze(Object.keys(GAP_KIND_LABEL_SV));

/**
 * W-M2e item 2 (inventory): the evidence binding assurance with a text of its own here -- the dataset
 * version is outside the ADMIT v1 contracts (chip suffix + LU_UNKNOWN_VERSION_NOTE). Every other
 * assurance is the server's own binding_note_sv, shown as the server writes it.
 */
export const LU_UNKNOWN_VERSION_ASSURANCE = 'HASH_BOUND_CONTRACT_UNKNOWN';
export const LU_BINDING_ASSURANCE_TEXTS: readonly string[] = Object.freeze([LU_UNKNOWN_VERSION_ASSURANCE]);

function knownGapViews(raw: unknown): LuKnownGapView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index): LuKnownGapView[] => {
    const gap = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!gap) return [];
    const kind = str(gap.kind) ?? 'OKÄND';
    const asOf = str(gap.as_of);
    const statement = presentServerTextSv(str(gap.text_sv) ?? MISSING);
    const label = (Object.prototype.hasOwnProperty.call(GAP_KIND_LABEL_SV, kind) ? GAP_KIND_LABEL_SV[kind] : undefined) ?? 'Annan känd begränsning';
    return [
      {
        id: str(gap.gap_id) ?? `gap-${index}`,
        kind,
        // A data gap carries its date in the line itself; a contract scope is the contract's statement.
        text: `${label}${kind === 'KNOWN_INCOMPLETE_DATA' && asOf ? ` (${asOf})` : ''}: ${statement}.`,
        asOf,
        basis: str(gap.basis_sv) === null ? null : presentServerTextSv(str(gap.basis_sv)!),
        rechecked: gap.rechecked_against_current_table === true,
        sources: Array.isArray(gap.sources) ? gap.sources.filter((s): s is string => typeof s === 'string') : [],
      },
    ];
  });
}

const STATE_BY_COVERAGE: Readonly<Record<string, LuKnowledgeState>> = {
  CHECKED_HIT: 'HIT',
  CHECKED_NO_HIT: 'NO_HIT',
  NOT_CHECKED: 'NOT_CHECKED',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  INCOMPLETE_EVIDENCE: 'UNCERTAIN',
  TECHNICAL_ERROR: 'TECHNICAL_ERROR',
};

/** W-M2e item 2 (inventory): the per-check coverage states with a knowledge state (and label) of their own. */
export const LU_CHECK_COVERAGE_STATES: readonly string[] = Object.freeze(Object.keys(STATE_BY_COVERAGE));

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function shortHash(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

export function formatRadius(meters: number | null): string {
  return meters === null ? MISSING : `${meters} m (sökradie – inte ett uppmätt avstånd)`;
}

export function formatMatchCount(count: unknown, cap: unknown): string | null {
  const n = num(count);
  if (n === null) return null;
  const c = num(cap);
  if (c !== null && c > 0 && n >= c) return `minst ${n} objekt (räkningen stannar vid ${c})`;
  return `${n} objekt`;
}

function formatTimestamp(value: unknown): string {
  const s = str(value);
  if (!s) return MISSING;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('sv-SE');
}

/**
 * A failure the model must show: a governance refusal reads "ofullständigt underlag", anything else
 * "tekniskt fel". Exported (DEMO M2c item 3) so the map heads the same failure with the same word.
 */
export function knowledgeStateForError(error: LuErrorPresentation): LuKnowledgeState {
  return error.kind === 'REFUSED' ? 'UNCERTAIN' : 'TECHNICAL_ERROR';
}

function errorTechnical(error: LuErrorPresentation): LuCheckDetailRow[] {
  return error.technical.map((row: LuErrorDetailRow) => ({ label: row.label, value: row.value }));
}

function baseView(
  key: LuCheckRowKey,
  label: string,
  ruleId: string | null,
  state: LuKnowledgeState,
  summary: string,
  extra: Partial<Omit<LuCheckView, 'key' | 'label' | 'state' | 'summary'>> = {},
): LuCheckView {
  return {
    key,
    label,
    state,
    stateLabel: LU_KNOWLEDGE_STATE_LABEL[state],
    summary,
    registerNote: null,
    coverageNote: null,
    coverageLimited: false,
    knownGaps: [],
    datasetVersionUnknown: false,
    ruleId,
    details: [],
    technical: [],
    searchRadiusMeters: null,
    evidenceArtifactId: null,
    rootAssuranceQualified: false,
    rootReadRetryable: false,
    ...extra,
  };
}

const NOT_CHECKED_RESULT = { label: 'Resultat', value: 'Ej kontrollerad' };
const NO_RESULT = { label: 'Resultat', value: 'Inget resultat kan visas' };

/** A row for a check while there is no displayed assessment to read it from (transport state). */
function transportRow(def: LuCheckDefinition, assessment: Exclude<LuAssessmentPresence, { status: 'present' }>): LuCheckView {
  switch (assessment.status) {
    case 'loading':
      return baseView(def.key, def.label, def.ruleId, 'LOADING', 'Hämtar sparad bedömning…');
    case 'error':
      return baseView(def.key, def.label, def.ruleId, knowledgeStateForError(assessment.error), assessment.error.messageSv, {
        details: [NO_RESULT],
        technical: errorTechnical(assessment.error),
      });
    case 'none':
      return baseView(def.key, def.label, def.ruleId, 'NOT_CHECKED', 'Det finns ingen sparad bedömning för kontrollpunkten ännu.', {
        details: [NOT_CHECKED_RESULT],
      });
    case 'not_assessed':
      // W-M2e item 3: "the latest run" is this tab's (the session memory), never another tab's or user's.
      return baseView(def.key, def.label, def.ruleId, 'NOT_CHECKED', 'Den senaste körningen i den här fliken gav ingen bedömning – kontrollen är inte gjord.', {
        details: [NOT_CHECKED_RESULT],
      });
  }
}

/** Presentation of an evidence detail's integrity field -- consistency, never authenticity. */
const INTEGRITY_SV: Readonly<Record<string, string>> = {
  CONTENT_HASH_VERIFIED: 'Innehållet stämmer med evidensens innehållshash',
  STRUCTURAL_ONLY: 'Endast strukturellt kontrollerad (typ, id och innehållshash finns)',
  TAMPERED: 'Klarade inte integritetskontrollen',
  CORRUPTED: 'Klarade inte integritetskontrollen',
  NOT_INTERPRETED: 'Tolkas inte i denna vy',
};

/** W-M2e item 2 (inventory): the evidence integrity values with a text of their own. */
export const LU_EVIDENCE_INTEGRITY_TEXTS: readonly string[] = Object.freeze(Object.keys(INTEGRITY_SV));

function integritySv(value: unknown): string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INTEGRITY_SV, value) ? INTEGRITY_SV[value]! : MISSING;
}

/** Details + technical rows of one server evidence detail (GovernedEvidenceDetail). */
function evidenceRows(detail: Record<string, unknown> | null, label: string): {
  details: LuCheckDetailRow[];
  technical: LuCheckDetailRow[];
  radius: number | null;
} {
  if (!detail) return { details: [], technical: [], radius: null };
  const result = obj(detail.result);
  const query = obj(detail.query);
  const contract = obj(detail.contract);
  const radius = query ? num(query.distance_meters) : null;
  const technicalClass = str(detail.technical_error_class);
  const exists = result ? result.exists : undefined;
  const cap = result ? num(result.max_features_per_layer) : null;
  const capReached = result ? result.cap_reached : undefined;
  const count = result ? num(result.match_count_observed) : null;
  const details: LuCheckDetailRow[] = technicalClass
    ? [{ label: 'Resultat', value: 'Evidensen kunde inte läsas – inget resultat kan visas' }]
    : [
        {
          label: 'Evidenstyp',
          value:
            result && str(result.semantics_kind) === 'EXISTENCE_WITHIN_DISTANCE'
              ? 'Registeruppgift / datasetobservation'
              : result && str(result.semantics_kind)
                ? 'Okänd evidenstyp'
                : MISSING,
        },
        { label: 'Resultat', value: exists === true ? 'Träff' : exists === false ? 'Ingen registrerad träff' : MISSING },
        { label: 'Antal', value: formatMatchCount(count, cap) ?? MISSING },
        {
          label: 'Räknetak',
          value:
            capReached === true && cap !== null
              ? `Nått (${cap}) – fler registrerade objekt kan finnas`
              : capReached === false && cap !== null && count !== null
                ? `Inte nått (${count} av högst ${cap})`
                : MISSING,
        },
        { label: 'Sökradie', value: formatRadius(radius) },
        {
          label: 'Metod',
          value:
            result && str(result.semantics_kind) === 'EXISTENCE_WITHIN_DISTANCE'
              ? 'Förekomst inom sökradie – anger om objekt finns inom radien, inte var eller hur nära'
              : MISSING,
        },
        { label: 'Källa', value: contract && str(contract.authority) ? `${contract.authority} – ${label}` : MISSING },
        {
          label: 'Källversion',
          value: !contract
            ? MISSING
            : contract.legacy_adopted === true
              ? `${MISSING} (befintliga data som adopterats)`
              : (str(contract.source_version) ?? MISSING),
        },
        { label: 'Täckning', value: presentServerTextSv(str(detail.coverage_limitation_sv) ?? MISSING) },
        { label: 'Hämtad', value: formatTimestamp(detail.retrieved_at) },
        { label: 'Upplösning/avgränsning', value: MISSING },
        { label: 'Importbatch', value: MISSING },
        { label: 'Integritet', value: integritySv(detail.integrity) },
        { label: 'Bindning', value: presentServerTextSv(str(detail.binding_note_sv) ?? MISSING) },
      ];
  const cited = Array.isArray(detail.cited_by_finding_ids) ? detail.cited_by_finding_ids.filter((id) => typeof id === 'string') : [];
  const technical: LuCheckDetailRow[] = [
    { label: 'Underlags-id', value: str(detail.evidence_artifact_id) ?? MISSING },
    { label: 'Innehållshash', value: str(detail.content_hash) ?? MISSING },
    { label: 'Dataset', value: str(detail.layer) ?? MISSING },
    { label: 'Frågad i', value: str(detail.provider) ?? MISSING },
    { label: 'Datasetversion', value: str(detail.dataset_version_hash) ?? MISSING },
    {
      label: 'Importkontrakt',
      value: contract
        ? `${str(contract.layer_id) ?? MISSING} · ${str(contract.source_id) ?? MISSING}`
        : 'Datasetversionen finns inte i importkontrakten (ADMIT v1).',
    },
    { label: 'Bindningsklass', value: str(detail.binding_assurance) ?? MISSING },
    ...(str(detail.integrity) ? [{ label: 'Integritetskod', value: String(detail.integrity) }] : []),
    ...(technicalClass ? [{ label: 'Felklass', value: technicalClass }] : []),
    ...(technicalClass && str(detail.message_sv) ? [{ label: 'Serverns text', value: String(detail.message_sv) }] : []),
    ...(cited.length > 0 ? [{ label: 'Fynd som bygger på underlaget', value: cited.join(', ') }] : []),
  ];
  return { details, technical, radius };
}

/** One check exactly as the server states it (a PresentedGovernedLayerCheck). */
function serverRow(
  key: LuCheckRowKey,
  label: string,
  knownLayer: string | null,
  entry: Record<string, unknown>,
  evidenceById: ReadonlyMap<string, Record<string, unknown>>,
  limitedLayers: ReadonlySet<string>,
): LuCheckView {
  const layer = str(entry.layer);
  const status = str(entry.status);
  const coverageState = str(entry.coverage_state);
  // W-M2e item 2: own entries only -- a state named "constructor" is unknown, never a mapped one.
  const mapped =
    coverageState && Object.prototype.hasOwnProperty.call(STATE_BY_COVERAGE, coverageState) ? STATE_BY_COVERAGE[coverageState] : undefined;
  const evidenceId = str(entry.evidence_artifact_id);
  const detail = evidenceId ? (evidenceById.get(evidenceId) ?? null) : null;
  // W-M2e item 3 (M2d verification finding 5): a "no hit" resting on evidence the server itself reports
  // as unreadable or failing integrity is a contradiction (owner invariant: unreadable pinned evidence is
  // never "ingen träff"/green). The server does not send it today; fail-safe only, and only towards
  // UNCERTAIN -- a HIT is never hidden (a stored risk finding must stay visible).
  const evidenceUnsound =
    detail !== null && (str(detail.technical_error_class) !== null || detail.integrity === 'TAMPERED' || detail.integrity === 'CORRUPTED');
  // A checked state the machine status contradicts is never shown as checked (fail safe, never green).
  const contradictory =
    (mapped === 'HIT' && status !== 'CHECKED_HIT') || (mapped === 'NO_HIT' && (status !== 'CHECKED_NO_HIT' || evidenceUnsound));
  const state: LuKnowledgeState = !mapped || contradictory ? 'UNCERTAIN' : mapped;
  const summary = !mapped
    ? coverageState
      ? 'Servern redovisar ett okänt kontrolltillstånd.'
      : `${MISSING}: kontrolltillståndet saknas i svaret.`
    : contradictory
      ? 'Kontrollposten från servern är motsägelsefull och visas därför inte som kontrollerad.'
      : str(entry.message_sv) !== null
        ? // W-UI1 (C): the server's row text without internal terms; the codes stay technical.
          presentServerTextSv(str(entry.message_sv)!)
        : `${MISSING}: servern skickade ingen beskrivning av kontrollen.`;
  const knownGaps = knownGapViews(entry.known_coverage_gaps);
  const checked = state === 'HIT' || state === 'NO_HIT';
  const limited = checked && (knownGaps.length > 0 || (layer !== null && limitedLayers.has(layer)));
  const knownDataGap = checked && knownGaps.some((gap) => gap.kind === 'KNOWN_INCOMPLETE_DATA');
  const coverageText = str(entry.coverage_limitation_sv) === null ? null : presentServerTextSv(str(entry.coverage_limitation_sv)!);
  // W-M2d item 3: the server says the dataset version is outside the import contracts.
  const versionUnknown =
    checked &&
    detail !== null &&
    str(detail.artifact_type) === 'SPATIAL_EVIDENCE' &&
    !str(detail.technical_error_class) &&
    (detail.contract === null || detail.binding_assurance === LU_UNKNOWN_VERSION_ASSURANCE);
  const rows = evidenceRows(detail, label);
  const details = [
    ...(rows.details.length > 0
      ? rows.details
      : [state === 'NOT_CHECKED' || state === 'SOURCE_UNAVAILABLE' ? NOT_CHECKED_RESULT : checked ? { label: 'Resultat', value: LU_KNOWLEDGE_STATE_LABEL[state] } : NO_RESULT]),
    ...knownGaps.map((gap, index) => ({
      label: `Känd lucka ${index + 1}`,
      value: `${gap.text}${gap.basis ? ` Grund: ${gap.basis}.` : ''}${gap.rechecked ? '' : ' Ej omkontrollerad mot nuvarande tabell.'}`,
    })),
  ];
  const technical: LuCheckDetailRow[] = [
    { label: 'Lager', value: layer ?? 'saknas' },
    ...(str(entry.rule_id) ? [{ label: 'Regel', value: String(entry.rule_id) }] : []),
    { label: 'Statuskod', value: status ?? 'saknas' },
    { label: 'Tillståndskod', value: coverageState ?? 'saknas' },
    ...(str(entry.reason) ? [{ label: 'Orsakskod', value: String(entry.reason) }] : []),
    ...(evidenceId && !detail ? [{ label: 'Underlags-id', value: evidenceId }] : []),
    ...rows.technical,
    ...knownGaps.flatMap((gap, index) => [
      { label: `Känd lucka ${index + 1} – id`, value: `${gap.id} (${gap.kind})` },
      { label: `Känd lucka ${index + 1} – källor`, value: gap.sources.length > 0 ? gap.sources.join('; ') : MISSING },
    ]),
  ];
  const suffix = `${limited ? LU_LIMITED_COVERAGE_SUFFIX : ''}${knownDataGap ? LU_KNOWN_GAP_SUFFIX : ''}${versionUnknown ? LU_UNKNOWN_VERSION_SUFFIX : ''}`;
  return baseView(key, label, str(entry.rule_id), state, summary, {
    stateLabel: `${LU_KNOWLEDGE_STATE_LABEL[state]}${suffix}`,
    registerNote:
      state === 'NO_HIT' && layer !== 'document'
        ? (knownLayer ? NEGATIVE_REGISTER_LIMIT[knownLayer] : undefined) ?? NEGATIVE_UNKNOWN_LAYER_LIMIT
        : null,
    coverageNote: versionUnknown ? LU_UNKNOWN_VERSION_NOTE : coverageText && coverageText !== MISSING ? coverageText : null,
    coverageLimited: limited,
    knownGaps,
    datasetVersionUnknown: versionUnknown,
    details,
    technical,
    searchRadiusMeters: rows.radius,
    evidenceArtifactId: evidenceId,
  });
}

/**
 * W-M2e item 3 (M2d verification finding 6): the property root's assurance as the SERVER states it for
 * the displayed assessment (propertyRoot; governedEvidenceDetails.ts resolvePropertyRoot). Every root
 * the server sends today carries "Rotens datasetbindning saknas (lägre säkerhet)": a RESOLVED root is
 * UNBOUND_METADATA, a NOT_RECORDED root has no recorded provenance, a TECHNICAL_ERROR/TAMPERED root
 * could not be read or verified. The property chip says so next to "Hittad"; a status or assurance
 * this UI does not know reads "okänd säkerhet" -- never stronger than the server's own statement.
 */
const ROOT_LOWER_ASSURANCE = { suffix: ' · lägre säkerhet i fastighetsunderlaget', noteSv: 'Fastighetsunderlaget har lägre säkerhet (rotens datasetbindning saknas).' };
const PROPERTY_ROOT_QUALIFIER: Readonly<Record<string, { readonly suffix: string; readonly noteSv: string }>> = {
  'RESOLVED/UNBOUND_METADATA': ROOT_LOWER_ASSURANCE,
  NOT_RECORDED: ROOT_LOWER_ASSURANCE,
  TECHNICAL_ERROR: {
    suffix: ' · fastighetsunderlagets ursprung kunde inte läsas',
    noteSv: 'Fastighetsrotens ursprung kunde inte läsas för den här bedömningen; fastigheten hittades vid uppslaget.',
  },
  // W-UI1 (D; U20CDF5-R3 verification C.5): a READ error of unknown persistence -- transient, may pass on a
  // re-read; it says nothing about the root itself.
  'TECHNICAL_ERROR/ROOT_READ_ERROR': {
    suffix: ' · fastighetsunderlagets proveniens kunde inte läsas just nu',
    noteSv:
      'Fastighetsrotens proveniens kunde inte läsas just nu (tekniskt fel); försök igen. Läsfelet säger inget om fastighetsunderlagets ' +
      'riktighet; fastigheten hittades vid uppslaget.',
  },
  // W-UI1 (D): the exact "never stored" signal of a root link -- a proven absence, not a read error.
  'TECHNICAL_ERROR/ROOT_ARTIFACT_NOT_FOUND': {
    suffix: ' · fastighetsunderlagets ursprung finns inte i arkivet',
    noteSv: 'Fastighetsrotens ursprung finns inte i arkivet för den här bedömningen; fastigheten hittades vid uppslaget.',
  },
  TAMPERED: {
    suffix: ' · fastighetsunderlagets ursprung klarade inte kontrollen',
    noteSv: 'Fastighetsrotens ursprung klarade inte integritetskontrollen.',
  },
};
const ROOT_UNKNOWN_ASSURANCE = {
  suffix: ' · okänd säkerhet i fastighetsunderlaget',
  noteSv: 'Servern anger en säkerhet för fastighetsunderlaget som inte kan visas här – se teknisk information.',
};

/** W-M2e item 2/3 (inventory): the property-root statuses and assurances with a text of their own. */
export const LU_PROPERTY_ROOT_TEXTS: readonly string[] = Object.freeze([
  'RESOLVED',
  'UNBOUND_METADATA',
  'NOT_RECORDED',
  'TECHNICAL_ERROR',
  'TAMPERED',
  // W-UI1 (D): the root's technical error classes with a mark of their own.
  'ROOT_READ_ERROR',
  'ROOT_ARTIFACT_NOT_FOUND',
]);

function propertyRootQualifier(root: Record<string, unknown> | null): { readonly suffix: string; readonly noteSv: string } | null {
  if (!root) return null;
  const status = str(root.status);
  const technicalClass = str(root.technical_error_class);
  const classKey = status === 'TECHNICAL_ERROR' && technicalClass ? `TECHNICAL_ERROR/${technicalClass}` : null;
  if (classKey && Object.prototype.hasOwnProperty.call(PROPERTY_ROOT_QUALIFIER, classKey)) return PROPERTY_ROOT_QUALIFIER[classKey]!;
  const key = status === 'RESOLVED' ? `RESOLVED/${str(root.assurance) ?? ''}` : (status ?? '');
  return Object.prototype.hasOwnProperty.call(PROPERTY_ROOT_QUALIFIER, key) ? PROPERTY_ROOT_QUALIFIER[key]! : ROOT_UNKNOWN_ASSURANCE;
}

/** W-UI1 (D): the server reports the root's READ error (ROOT_READ_ERROR) -- re-reading may help. */
function isRootReadError(root: Record<string, unknown> | null): boolean {
  return root !== null && str(root.status) === 'TECHNICAL_ERROR' && str(root.technical_error_class) === 'ROOT_READ_ERROR';
}

function propertyCheck(def: LuCheckDefinition, input: LuPropertyInput): LuCheckView {
  const qualifier = propertyRootQualifier(obj(input.propertyRoot));
  const make = (state: LuKnowledgeState, summary: string, details: LuCheckDetailRow[] = [], technical: LuCheckDetailRow[] = []): LuCheckView => {
    const found = state === 'HIT';
    return {
      ...baseView(def.key, def.label, null, state, found && qualifier ? `${summary} ${qualifier.noteSv}` : summary, { details, technical }),
      stateLabel: found ? `${LU_PROPERTY_FOUND_LABEL}${qualifier ? qualifier.suffix : ''}` : LU_KNOWLEDGE_STATE_LABEL[state],
      rootAssuranceQualified: found && qualifier !== null,
      rootReadRetryable: found && isRootReadError(obj(input.propertyRoot)),
    };
  };
  if (input.lookupError) {
    const e = input.lookupError;
    const state: LuKnowledgeState = e.kind === 'NOT_FOUND' || e.kind === 'REFUSED' ? 'NOT_CHECKED' : 'TECHNICAL_ERROR';
    return make(state, e.messageSv, [], errorTechnical(e));
  }
  if (!input.lookedUp) return make('NOT_CHECKED', 'Fastigheten har inte slagits upp ännu.');
  if (input.geometryError) {
    const e = input.geometryError;
    const state: LuKnowledgeState = e.kind === 'NOT_FOUND' ? 'NOT_CHECKED' : knowledgeStateForError(e);
    return make(state, e.messageSv, [], errorTechnical(e));
  }
  if (!input.geometry) {
    return input.geometryLoading ? make('LOADING', 'Hämtar lokaliseringspunkt…') : make('NOT_CHECKED', 'Ingen lokaliseringspunkt finns ännu.');
  }
  const derived = input.geometry.provenance === 'derived_from_property_boundary';
  const pointText = derived ? 'beräknad mittpunkt av fastigheten (ej inmätt)' : 'angiven av användaren';
  const [lng, lat] = input.geometry.wgs84LngLat;
  // W-M2d item 1: the property root's provenance and (lower) assurance, as the server states it.
  const root = obj(input.propertyRoot);
  const details: LuCheckDetailRow[] = [
    { label: 'Resultat', value: 'Fastigheten hittades' },
    { label: 'Kontrollpunkt', value: pointText },
    { label: 'Koordinater (WGS84)', value: `${lat.toFixed(6)}, ${lng.toFixed(6)}` },
    ...(root ? [{ label: 'Fastighetsunderlag', value: presentServerTextSv(str(root.message_sv) ?? MISSING) }] : []),
  ];
  const binding = input.assessedPoint ?? 'none';
  const technical: LuCheckDetailRow[] = [
    { label: 'Lokaliserings-id', value: input.geometry.artifact_id },
    { label: 'Ursprungskod', value: input.geometry.provenance },
    ...(binding === 'none' ? [] : [{ label: 'Bedömningens lokaliserings-id', value: input.assessedGeometryId ?? 'anges inte i svaret' }]),
    ...(root ? [{ label: 'Fastighetsrotens status', value: str(root.status) ?? MISSING }, { label: 'Rotens säkerhet', value: str(root.assurance) ?? MISSING }] : []),
    ...(root && str(root.technical_error_class) ? [{ label: 'Rotens felklass', value: String(root.technical_error_class) }] : []),
  ];
  if (input.geometry.provisioningStatus === 'FAILED') {
    return make('TECHNICAL_ERROR', 'Lokaliseringspunkten är sparad men analysen kunde inte förberedas.', details, technical);
  }
  // DEMO M2c item 2: the row only says the checks start from THIS point when the shown assessment
  // was made for it.
  if (binding === 'changed') {
    return make('HIT', 'Fastigheten hittades. Den visade bedömningen gjordes för en annan kontrollpunkt än den som visas här.', details, technical);
  }
  if (binding === 'unknown') {
    return make(
      'HIT',
      'Fastigheten hittades. Det går inte att bekräfta att den visade bedömningen gjordes för den här kontrollpunkten.',
      details,
      technical,
    );
  }
  return make('HIT', `Fastigheten hittades. Kontrollerna utgår från en ${pointText.replace('angiven', 'punkt angiven')}.`, details, technical);
}

/**
 * W-M2d item 1: the checks as the server states them. Rows in this UI's fixed order (property, the
 * five map layers, the document check), then any layer only the server reported, then entries the
 * UI cannot read. A check the answer lacks reads "Saknas i underlaget" -- nothing is filled in.
 */
export function presentLuControlChecks(input: {
  readonly property: LuPropertyInput;
  readonly assessment: LuAssessmentPresence;
  readonly server: LuServerChecksInput | null;
}): LuCheckView[] {
  const rows: LuCheckView[] = [];
  const checkDefs = LU_V1_CHECKS.filter((def) => def.key !== 'property');
  const propertyDef = LU_V1_CHECKS[0]!;
  rows.push(propertyCheck(propertyDef, input.property));

  if (input.assessment.status !== 'present') {
    const transport = input.assessment;
    for (const def of checkDefs) rows.push(transportRow(def, transport));
    return rows;
  }

  const layerChecks = input.server?.layerChecks ?? null;
  if (!layerChecks) {
    for (const def of checkDefs) {
      rows.push(
        baseView(def.key, def.label, def.ruleId, 'UNCERTAIN', `${MISSING}: svaret innehåller inga lagerkontroller för bedömningen.`, {
          details: [NO_RESULT],
        }),
      );
    }
    return rows;
  }

  const evidenceById = new Map<string, Record<string, unknown>>();
  for (const raw of input.server?.evidenceDetails ?? []) {
    const detail = obj(raw);
    const id = detail ? str(detail.evidence_artifact_id) : null;
    if (detail && id && !evidenceById.has(id)) evidenceById.set(id, detail);
  }
  const limitedLayers = new Set(input.server?.limitedCoverageLayers ?? []);
  const known = new Set<string>(checkDefs.map((def) => def.key));
  const used = new Set<number>();

  for (const def of checkDefs) {
    const index = layerChecks.findIndex((raw) => str(obj(raw)?.layer) === def.key);
    if (index < 0) {
      rows.push(
        baseView(def.key, def.label, def.ruleId, 'UNCERTAIN', `${MISSING}: svaret innehåller ingen kontroll för ${def.key === 'document' ? 'dokument' : 'detta lager'}.`, {
          details: [NO_RESULT],
        }),
      );
      continue;
    }
    used.add(index);
    rows.push(serverRow(def.key, def.label, def.key, obj(layerChecks[index])!, evidenceById, limitedLayers));
  }

  const usedKeys = new Set<string>();
  layerChecks.forEach((raw, index) => {
    if (used.has(index)) return;
    const entry = obj(raw);
    const layer = entry ? str(entry.layer) : null;
    const baseKey = !layer ? `extra-okand-${index}` : known.has(layer) ? `extra-${layer}-${index}` : `extra-${layer}`;
    const key = (usedKeys.has(baseKey) ? `${baseKey}-${index}` : baseKey) as LuCheckRowKey;
    usedKeys.add(key);
    if (!entry || !layer) {
      rows.push(
        baseView(key, 'Okänd kontrollpost', null, 'UNCERTAIN', 'Kontrollposten från servern kunde inte tolkas.', {
          details: [NO_RESULT],
          technical: [{ label: 'Post', value: JSON.stringify(raw) ?? String(raw) }],
        }),
      );
      return;
    }
    if (known.has(layer)) {
      // The same check twice: neither is shown as the check's result.
      rows.push(
        baseView(key, governedCheckLabelSv(layer), str(entry.rule_id), 'UNCERTAIN', 'Kontrollen förekommer flera gånger i svaret; denna post visas inte som resultat.', {
          details: [NO_RESULT],
          technical: [{ label: 'Lager', value: layer }],
        }),
      );
      return;
    }
    // DEMO M2c item 3: an unknown layer's raw id stays in the technical section ("Lager").
    rows.push(serverRow(key, 'Annat underlag från servern', null, entry, evidenceById, limitedLayers));
  });
  return rows;
}

/** Accepts a field only when it is an array; anything else is "not in the answer". */
export function parseServerArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** The server's own "completed with limited coverage" list from an overallStatement, or []. */
export function limitedCoverageLayersOf(overallStatement: unknown): readonly string[] {
  const coverage = obj(obj(overallStatement)?.coverage);
  const layers = coverage?.limited_coverage_layers;
  return Array.isArray(layers) ? layers.filter((l): l is string => typeof l === 'string') : [];
}

/** Parses a /viewer/evidence response defensively (map only); anything not a FeatureCollection is an error. */
export function parseViewerEvidence(payload: unknown): LuViewerEvidenceProps[] {
  const fc = payload as { type?: unknown; features?: unknown } | null;
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new LuClientError('Kontrollresultaten för kartan kunde inte hämtas. Svaret var inte ett giltigt kontrollresultat.');
  }
  return fc.features.map((f) => ((f as { properties?: unknown })?.properties ?? {}) as LuViewerEvidenceProps);
}

/**
 * DEMO M2b item 2 (map only since W-M2d): do these viewer-evidence features belong to the DISPLAYED
 * assessment? ViewerKernel projects exactly the assessment's SPATIAL_EVIDENCE refs, one feature per
 * ref, so the feature ids must equal the assessment's spatial evidence ids.
 */
export function checkEvidenceBinding(
  features: readonly LuViewerEvidenceProps[],
  spatialEvidenceRefs: readonly string[] | null,
): { readonly ok: true } | { readonly ok: false; readonly messageSv: string; readonly technical: readonly LuCheckDetailRow[] } {
  if (!spatialEvidenceRefs) {
    return {
      ok: false,
      messageSv: 'Det går inte att kontrollera att kartans kontrollresultat hör till den visade bedömningen, så de visas inte på kartan.',
      technical: [],
    };
  }
  const featureIds = features.map((f) => str(f.cas_artifact_id));
  const refs = new Set(spatialEvidenceRefs);
  const ids = new Set(featureIds.filter((id): id is string => id !== null));
  const missing = [...refs].filter((id) => !ids.has(id));
  const foreign = featureIds.filter((id) => id === null || !refs.has(id)).map((id) => id ?? '(utan id)');
  if (missing.length === 0 && foreign.length === 0) return { ok: true };
  return {
    ok: false,
    messageSv: 'Kartans kontrollresultat hör inte till den visade bedömningen och visas därför inte på kartan.',
    technical: [
      ...(missing.length ? [{ label: 'Saknas i kontrollresultaten', value: missing.join(', ') }] : []),
      ...(foreign.length ? [{ label: 'Hör inte till bedömningen', value: foreign.join(', ') }] : []),
    ],
  };
}
