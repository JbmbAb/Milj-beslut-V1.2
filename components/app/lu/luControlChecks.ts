/**
 * DEMO M2a/M2b (LU product demonstrator) -- the six checks of the LU v1 set as knowledge states.
 *
 * Pure presentation model. Everything here is derived from data the governed API already returns:
 *   - GET /api/localization/:projectId/viewer/evidence  (per layer: exists, match_count_observed,
 *     max_features_per_layer, distance_meters = SEARCH RADIUS, algorithm, result_semantics_kind,
 *     engine, version / layer_version_hash, governance_status, cas ids)
 *   - GET /api/localization/:projectId/current-assessment  (findings: rule_id, risk_level incl.
 *     NOT_CHECKED, explanation, evidence_refs)
 *   - GET /api/localization/:projectId/geometry  (provenance, provisioning status)
 *   - only for rows OUTSIDE the six checks: the run's executionMotor.governed_layer_checks, shown as
 *     the server states them (no client derivation)
 * plus the static rule/layer definitions (LURuleEngine LAYER_RULE_IDS).
 *
 * The six knowledge states (DIRECTIVE-72H §11) are kept apart, never collapsed into each other:
 *   HIT                kontrollerat – träff
 *   NO_HIT             kontrollerat – ingen registrerad träff (a negative REGISTER result: never
 *                      "clean ground", "no risk" or "no impact"; each such row carries registerNote)
 *   NOT_CHECKED        inte kontrollerat (no control result exists)
 *   SOURCE_UNAVAILABLE källan kunde inte frågas vid bedömningen (governed NOT_CHECKED finding)
 *   UNCERTAIN          ofullständigt underlag (unverified/uninterpretable evidence, governance refusal)
 *   TECHNICAL_ERROR    tekniskt fel (fetch/read failure, missing viewer capability, integrity
 *                      failure, sources that disagree on which assessment is shown)
 * plus LOADING while a request is in flight.
 *
 * Invariants:
 *   - Silence is never absence. No evidence for a layer => "Inte kontrollerat", never "ingen träff".
 *   - A technical failure is never "ofullständigt underlag", never "inte kontrollerat", never green.
 *   - distance_meters is the SEARCH RADIUS of an existence-within-distance query. It is never shown
 *     as a measured distance ("avstånd").
 *   - A count equal to the per-layer cap is shown as "minst N" (the query stops counting there).
 *   - Nothing is invented: a field the viewer projection does not carry is said to be missing there.
 */

import { LuClientError, type LuErrorDetailRow, type LuErrorPresentation } from './luErrorPresentation';

export type LuCheckKey = 'property' | 'water' | 'ebh' | 'protected_area' | 'natura2000' | 'water_protection_area';
/** A row key: one of the six LU v1 checks, or `extra-<layer>` for a layer only the server reported. */
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
  /** Governed rule that fires on this layer (LURuleEngine LAYER_RULE_IDS); null for the property check. */
  readonly ruleId: string | null;
  /** Plain-Swedish meaning of a hit, derived from the rule definition (existence within the search radius). */
  readonly hitMeaning: string | null;
}

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
];

/** Number of map layers the LU v1 run checks (every check except the property row). */
export const LU_V1_LAYER_COUNT = LU_V1_CHECKS.filter((c) => c.key !== 'property').length;

export function checkDefinitionForRule(ruleId: string): LuCheckDefinition | null {
  return LU_V1_CHECKS.find((c) => c.ruleId === ruleId) ?? null;
}

export function checkDefinitionForLayer(layerId: string | null | undefined): LuCheckDefinition | null {
  if (!layerId) return null;
  return LU_V1_CHECKS.find((c) => c.key === layerId && c.key !== 'property') ?? null;
}

/** The properties of one governed /viewer/evidence feature (all optional: never trusted blindly). */
export interface LuViewerEvidenceProps {
  readonly layer_id?: unknown;
  readonly dataset?: unknown;
  readonly exists?: unknown;
  readonly match_count_observed?: unknown;
  readonly max_features_per_layer?: unknown;
  readonly distance_meters?: unknown;
  readonly algorithm?: unknown;
  readonly result_semantics_kind?: unknown;
  readonly engine?: unknown;
  readonly version?: unknown;
  readonly layer_version_hash?: unknown;
  readonly governance_status?: unknown;
  readonly cas_artifact_id?: unknown;
  readonly cas_content_hash?: unknown;
  readonly retrieved_at?: unknown;
  readonly queried_at?: unknown;
  readonly subject_artifact_id?: unknown;
}

export interface LuFindingLike {
  readonly finding_id: string;
  readonly rule_id: string;
  readonly risk_level: string;
  readonly explanation?: string;
  readonly evidence_refs?: ReadonlyArray<{ artifact_id: string; artifact_type: string }>;
}

export type LuEvidenceLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly features: readonly LuViewerEvidenceProps[] }
  | { readonly status: 'error'; readonly error: LuErrorPresentation };

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
}

export interface LuCheckDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface LuCheckView {
  readonly key: LuCheckRowKey;
  readonly label: string;
  readonly state: LuKnowledgeState;
  readonly stateLabel: string;
  readonly summary: string;
  /** NO_HIT only: what a negative register result does and does not say (shown under the row). */
  readonly registerNote: string | null;
  /** Server-stated rows only: the server's own Swedish explanation (e.g. documentCheck.message_sv). */
  readonly serverNote: string | null;
  /** Rule that fires on this layer, when there is one (for "Fynd i bedömningen"). */
  readonly ruleId: string | null;
  /** Rows for the evidence panel (result, count, radius, method, dataset version, status, retrieved_at). */
  readonly details: readonly LuCheckDetailRow[];
  /** Ids/hashes/codes for the collapsed "Teknisk information" section. */
  readonly technical: readonly LuCheckDetailRow[];
  /** Search radius in metres when the governed evidence states one (for the map ring). */
  readonly searchRadiusMeters: number | null;
  /** The governed spatial evidence artifact id for this check, when there is one. */
  readonly evidenceArtifactId: string | null;
}

const MISSING = 'Saknas i underlaget';
/** retrieved_at is in the CAS evidence but the viewer projection (ViewerKernel) does not carry it. */
const NOT_IN_VIEWER_PROJECTION = 'Skickas inte med i kontrollresultatet';

/**
 * Per layer: the limit of a negative register check. States only what kind of check it is and
 * what it does not show -- no new facts, no risk level, no hydrological or contamination conclusion.
 */
const NEGATIVE_REGISTER_LIMIT: Readonly<Record<Exclude<LuCheckKey, 'property'>, string>> = {
  water: 'Det är en registerkontroll, inte en inventering i fält, och visar inte att oregistrerade brunnar eller påverkan saknas.',
  ebh: 'Det är en registerkontroll, inte en markundersökning, och visar inte markens skick eller att föroreningar eller påverkan saknas.',
  protected_area:
    'Det är en registerkontroll av utpekade skyddade områden, inte en naturinventering, och visar inte att naturvärden eller påverkan saknas.',
  natura2000: 'Det är en registerkontroll av utpekade Natura 2000-områden och visar inte att påverkan på sådana områden saknas.',
  water_protection_area:
    'Det är en registerkontroll av beslutade vattenskyddsområden, inte en undersökning av grundvatten eller vattentäkter, och visar inte att påverkan saknas.',
};

function negativeRegisterNote(def: LuCheckDefinition, radius: number | null, dataset: string | null): string {
  const where = radius === null ? 'inom sökradien' : `inom ${radius} m`;
  const source = `i lagret ${def.label}${dataset ? ` (dataset ${dataset})` : ''}`;
  const limit = def.key === 'property' ? '' : ` ${NEGATIVE_REGISTER_LIMIT[def.key]}`;
  return `Register: inget registrerat objekt ${where} ${source}.${limit}`;
}

/** Today every governed layer is an existence-within-distance query over a register dataset. */
function describeEvidenceType(props: LuViewerEvidenceProps): string {
  return str(props.result_semantics_kind) === 'EXISTENCE_WITHIN_DISTANCE' ? 'Registeruppgift / datasetobservation' : 'Okänd evidenstyp';
}

function describeCountCap(count: unknown, cap: unknown): string {
  const n = num(count);
  const c = num(cap);
  if (c === null || c <= 0) return MISSING;
  if (n === null) return `Högst ${c} objekt räknas – antal saknas i underlaget`;
  return n >= c
    ? `Nått (${c}) – fler registrerade objekt kan finnas`
    : `Inte nått (${n} av högst ${c})`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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

export function describeMethod(props: LuViewerEvidenceProps): string {
  const kind = str(props.result_semantics_kind);
  const engine = str(props.engine);
  if (kind === 'EXISTENCE_WITHIN_DISTANCE') {
    return `Förekomst inom sökradie${engine ? ` (${engine})` : ''} – anger om objekt finns inom radien, inte var eller hur nära`;
  }
  return kind ? `Okänd metod (${kind})` : MISSING;
}

export function describeGovernanceStatus(status: unknown): string {
  const s = str(status);
  if (s === 'VERIFIED_OBSERVATION') return 'Verifierad observation';
  return s ? 'Ej verifierad' : MISSING;
}

function formatTimestamp(value: unknown): string {
  const s = str(value);
  if (!s) return NOT_IN_VIEWER_PROJECTION;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('sv-SE');
}

function featureLayer(props: LuViewerEvidenceProps): string | null {
  return str(props.layer_id) ?? str(props.dataset);
}

/** A failure the model must show: a governance refusal reads "ofullständigt underlag", anything else "tekniskt fel". */
function stateForError(error: LuErrorPresentation): LuKnowledgeState {
  return error.kind === 'REFUSED' ? 'UNCERTAIN' : 'TECHNICAL_ERROR';
}

function errorTechnical(error: LuErrorPresentation): LuCheckDetailRow[] {
  return error.technical.map((row: LuErrorDetailRow) => ({ label: row.label, value: row.value }));
}

function layerCheck(
  def: LuCheckDefinition,
  assessment: LuAssessmentPresence,
  evidence: LuEvidenceLoad,
  findings: readonly LuFindingLike[],
): LuCheckView {
  const make = (
    state: LuKnowledgeState,
    summary: string,
    details: LuCheckDetailRow[] = [],
    technical: LuCheckDetailRow[] = [],
    searchRadiusMeters: number | null = null,
    evidenceArtifactId: string | null = null,
    registerNote: string | null = null,
  ): LuCheckView => ({
    key: def.key,
    label: def.label,
    state,
    stateLabel: LU_KNOWLEDGE_STATE_LABEL[state],
    summary,
    registerNote,
    serverNote: null,
    ruleId: def.ruleId,
    details,
    technical: def.ruleId ? [{ label: 'Lager', value: def.key }, { label: 'Regel', value: def.ruleId }, ...technical] : technical,
    searchRadiusMeters,
    evidenceArtifactId,
  });
  const notCheckedResult = { label: 'Resultat', value: 'Ej kontrollerad' };
  const noResult = { label: 'Resultat', value: 'Inget resultat kan visas' };

  switch (assessment.status) {
    case 'loading':
      return make('LOADING', 'Hämtar sparad bedömning…');
    case 'error':
      return make(stateForError(assessment.error), assessment.error.messageSv, [noResult], errorTechnical(assessment.error));
    case 'none':
      return make('NOT_CHECKED', 'Det finns ingen sparad bedömning för kontrollpunkten ännu.', [notCheckedResult]);
    case 'not_assessed':
      return make('NOT_CHECKED', 'Den senaste körningen gav ingen bedömning – kontrollen är inte gjord.', [notCheckedResult]);
    case 'present':
      break;
  }

  const ruleFindings = def.ruleId ? findings.filter((f) => f.rule_id === def.ruleId) : [];
  const notCheckedFinding = ruleFindings.find((f) => f.risk_level === 'NOT_CHECKED');
  if (notCheckedFinding) {
    return make(
      'SOURCE_UNAVAILABLE',
      'Källan kunde inte frågas vid bedömningen – kontrollen är inte gjord.',
      [notCheckedResult],
      notCheckedFinding.explanation ? [{ label: 'Regelns text', value: notCheckedFinding.explanation }] : [],
    );
  }

  if (evidence.status === 'idle' || evidence.status === 'loading') return make('LOADING', 'Hämtar kontrollresultat…');
  if (evidence.status === 'error') {
    // DEMO M2b item 1: the control result could not be fetched -- a system state, not a data answer.
    // A governed finding for this layer still exists; say so instead of hiding it.
    const findingNote = ruleFindings.length > 0 ? ' Bedömningen har ett fynd för detta lager – se Fynd.' : '';
    return make(stateForError(evidence.error), `${evidence.error.messageSv}${findingNote}`, [noResult], errorTechnical(evidence.error));
  }

  const layerFeatures = evidence.features.filter((f) => featureLayer(f) === def.key);
  if (layerFeatures.length === 0) {
    return make('NOT_CHECKED', 'Bedömningen innehåller inget kontrollresultat för detta lager.', [notCheckedResult]);
  }
  // NOTE (M2b, verifier finding 4): this per-layer rule is the client's own; it differs from the
  // server's governedLayerChecks.ts for several features per layer. Deliberately unchanged here --
  // the next step is the server delivering the per-layer state on read-back (U20-D).
  const props = layerFeatures.find((f) => f.exists === true) ?? layerFeatures[0]!;
  const radius = num(props.distance_meters);
  const artifactId = str(props.cas_artifact_id);
  const count = formatMatchCount(props.match_count_observed, props.max_features_per_layer);
  // Every row is either taken from the governed viewer evidence or says that it is missing there.
  const details: LuCheckDetailRow[] = [
    { label: 'Evidenstyp', value: describeEvidenceType(props) },
    {
      label: 'Resultat',
      value: props.exists === true ? 'Träff' : props.exists === false ? 'Ingen registrerad träff' : 'Kunde inte tolkas',
    },
    { label: 'Antal', value: count ?? MISSING },
    { label: 'Räknetak', value: describeCountCap(props.match_count_observed, props.max_features_per_layer) },
    { label: 'Sökradie', value: formatRadius(radius) },
    { label: 'Metod', value: describeMethod(props) },
    { label: 'Källa (dataset)', value: str(props.dataset) ?? MISSING },
    { label: 'Datasetversion', value: shortHash(props.version ?? props.layer_version_hash) ?? MISSING },
    { label: 'Hämtad', value: formatTimestamp(props.retrieved_at ?? props.queried_at) },
    { label: 'Upplösning/avgränsning', value: MISSING },
    { label: 'Status', value: describeGovernanceStatus(props.governance_status) },
  ];
  const technical: LuCheckDetailRow[] = [
    { label: 'Underlags-id', value: artifactId ?? MISSING },
    { label: 'Innehållshash', value: str(props.cas_content_hash) ?? MISSING },
    { label: 'Dataset', value: str(props.dataset) ?? MISSING },
    { label: 'Datasetversion (full)', value: str(props.version) ?? str(props.layer_version_hash) ?? MISSING },
    { label: 'Statuskod', value: str(props.governance_status) ?? MISSING },
    { label: 'Metodkod', value: str(props.algorithm) ?? MISSING },
  ];

  if (str(props.governance_status) !== 'VERIFIED_OBSERVATION') {
    return make('UNCERTAIN', 'Underlaget har inte status verifierad observation.', details, technical, radius, artifactId);
  }
  if (typeof props.exists !== 'boolean') {
    return make('UNCERTAIN', 'Kontrollresultatet kunde inte tolkas.', details, technical, radius, artifactId);
  }
  const radiusText = radius === null ? 'sökradien' : `sökradien ${radius} m`;
  if (props.exists) {
    return make('HIT', `${count ?? 'Objekt'} inom ${radiusText}.`, details, technical, radius, artifactId);
  }
  return make(
    'NO_HIT',
    `Inga registrerade objekt inom ${radiusText}.`,
    details,
    technical,
    radius,
    artifactId,
    negativeRegisterNote(def, radius, str(props.dataset)),
  );
}

function propertyCheck(def: LuCheckDefinition, input: LuPropertyInput): LuCheckView {
  const make = (state: LuKnowledgeState, summary: string, details: LuCheckDetailRow[] = [], technical: LuCheckDetailRow[] = []): LuCheckView => ({
    key: def.key,
    label: def.label,
    state,
    stateLabel: state === 'HIT' ? LU_PROPERTY_FOUND_LABEL : LU_KNOWLEDGE_STATE_LABEL[state],
    summary,
    registerNote: null,
    serverNote: null,
    ruleId: null,
    details,
    technical,
    searchRadiusMeters: null,
    evidenceArtifactId: null,
  });
  if (input.lookupError) {
    const e = input.lookupError;
    const state: LuKnowledgeState = e.kind === 'NOT_FOUND' || e.kind === 'REFUSED' ? 'NOT_CHECKED' : 'TECHNICAL_ERROR';
    return make(state, e.messageSv, [], errorTechnical(e));
  }
  if (!input.lookedUp) return make('NOT_CHECKED', 'Fastigheten har inte slagits upp ännu.');
  if (input.geometryError) {
    const e = input.geometryError;
    const state: LuKnowledgeState = e.kind === 'NOT_FOUND' ? 'NOT_CHECKED' : stateForError(e);
    return make(state, e.messageSv, [], errorTechnical(e));
  }
  if (!input.geometry) {
    return input.geometryLoading ? make('LOADING', 'Hämtar lokaliseringspunkt…') : make('NOT_CHECKED', 'Ingen lokaliseringspunkt finns ännu.');
  }
  const derived = input.geometry.provenance === 'derived_from_property_boundary';
  const pointText = derived ? 'beräknad mittpunkt av fastigheten (ej inmätt)' : 'angiven av användaren';
  const [lng, lat] = input.geometry.wgs84LngLat;
  const details: LuCheckDetailRow[] = [
    { label: 'Resultat', value: 'Fastigheten hittades' },
    { label: 'Kontrollpunkt', value: pointText },
    { label: 'Koordinater (WGS84)', value: `${lat.toFixed(6)}, ${lng.toFixed(6)}` },
  ];
  const technical: LuCheckDetailRow[] = [
    { label: 'Lokaliserings-id', value: input.geometry.artifact_id },
    { label: 'Ursprungskod', value: input.geometry.provenance },
  ];
  if (input.geometry.provisioningStatus === 'FAILED') {
    return make('TECHNICAL_ERROR', 'Lokaliseringspunkten är sparad men analysen kunde inte förberedas.', details, technical);
  }
  return make('HIT', `Fastigheten hittades. Kontrollerna utgår från en ${pointText.replace('angiven', 'punkt angiven')}.`, details, technical);
}

/** Only used when the server sends no message_sv of its own. */
const SERVER_REASON_SV: Readonly<Record<string, string>> = {
  NO_EVIDENCE: 'Inget kontrollresultat finns i bedömningen.',
  NOT_CHECKED_FINDING: 'Källan kunde inte frågas vid bedömningen.',
  UNRECOGNIZED_RESULT: 'Resultatet kunde inte tolkas.',
  NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED: 'Inget verifierat dokumentunderlag är knutet till bedömningen.',
  DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED: 'Dokumentunderlag finns men inget verifierat dokumentfaktum.',
  PINNED_EVIDENCE_REFS_UNREADABLE: 'Bedömningens evidensreferenser kunde inte läsas.',
};

/**
 * DEMO M2b item 5: rows for layers the SERVER reported in executionMotor.governed_layer_checks but
 * that are not among the six LU v1 checks (e.g. `document`). Shown exactly as the server states
 * them -- no client derivation. The six known layers are skipped here: they keep coming from the
 * governed viewer evidence. Anything malformed or unknown is "ofullständigt underlag", never green.
 */
function extraServerRows(checks: readonly unknown[]): LuCheckView[] {
  const known = new Set<string>(LU_V1_CHECKS.map((c) => c.key));
  const rows: LuCheckView[] = [];
  const usedKeys = new Set<string>();
  checks.forEach((entry, index) => {
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const layer = e ? str(e.layer) : null;
    if (layer && known.has(layer)) return;
    const status = e ? str(e.status) : null;
    const reason = e ? str(e.reason) : null;
    const baseKey = layer ? `extra-${layer}` : `extra-okand-${index}`;
    const key = (usedKeys.has(baseKey) ? `${baseKey}-${index}` : baseKey) as LuCheckRowKey;
    usedKeys.add(key);
    const technical: LuCheckDetailRow[] = [
      { label: 'Lager', value: layer ?? 'saknas' },
      { label: 'Statuskod', value: status ?? 'saknas' },
      ...(reason ? [{ label: 'Orsakskod', value: reason }] : []),
      ...(e && str(e.rule_id) ? [{ label: 'Regel', value: str(e.rule_id)! }] : []),
      ...(e && str(e.evidence_artifact_id) ? [{ label: 'Underlags-id', value: str(e.evidence_artifact_id)! }] : []),
    ];
    const label = !layer ? 'Okänd kontrollpost' : layer === 'document' ? 'Dokumentbevis' : `Annat underlag (${layer})`;
    const serverNote = e ? str(e.message_sv) : null;
    const reasonText = !serverNote && reason && SERVER_REASON_SV[reason] ? ` ${SERVER_REASON_SV[reason]}` : '';
    let state: LuKnowledgeState;
    let summary: string;
    if (!layer) {
      state = 'UNCERTAIN';
      summary = 'Kontrollposten från servern kunde inte tolkas.';
    } else if (status === 'NOT_CHECKED') {
      state = 'NOT_CHECKED';
      summary = `${layer === 'document' ? 'Ej analyserat.' : 'Ej kontrollerat.'}${reasonText}`;
    } else if (status === 'CHECKED_HIT') {
      state = 'HIT';
      summary = 'Servern redovisar träff.';
    } else if (status === 'CHECKED_NO_HIT') {
      state = 'NO_HIT';
      summary = 'Servern redovisar kontrollerat utan registrerad träff.';
    } else {
      state = 'UNCERTAIN';
      summary = 'Servern redovisar ett okänt kontrolltillstånd.';
    }
    rows.push({
      key,
      label,
      state,
      stateLabel: LU_KNOWLEDGE_STATE_LABEL[state],
      summary,
      registerNote: null,
      serverNote,
      ruleId: e ? str(e.rule_id) : null,
      details: [],
      technical,
      searchRadiusMeters: null,
      evidenceArtifactId: null,
    });
  });
  return rows;
}

export function deriveLuControlChecks(input: {
  readonly property: LuPropertyInput;
  readonly assessment: LuAssessmentPresence;
  readonly evidence: LuEvidenceLoad;
  readonly findings: readonly LuFindingLike[];
  /** The run's executionMotor.governed_layer_checks for the DISPLAYED assessment; null when unknown (reopen). */
  readonly serverLayerChecks?: readonly unknown[] | null;
}): LuCheckView[] {
  const base = LU_V1_CHECKS.map((def) =>
    def.key === 'property' ? propertyCheck(def, input.property) : layerCheck(def, input.assessment, input.evidence, input.findings),
  );
  if (input.assessment.status !== 'present' || !input.serverLayerChecks) return base;
  return [...base, ...extraServerRows(input.serverLayerChecks)];
}

/** Accepts executionMotor.governed_layer_checks only when it is an array; anything else is "unknown". */
export function parseServerLayerChecks(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Parses a /viewer/evidence response defensively; anything that is not a FeatureCollection is an error. */
export function parseViewerEvidence(payload: unknown): LuViewerEvidenceProps[] {
  const fc = payload as { type?: unknown; features?: unknown } | null;
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new LuClientError('Kontrollresultaten kunde inte hämtas. Svaret var inte ett giltigt kontrollresultat.');
  }
  return fc.features.map((f) => ((f as { properties?: unknown })?.properties ?? {}) as LuViewerEvidenceProps);
}

/**
 * DEMO M2b item 2: do these viewer-evidence features belong to the DISPLAYED assessment?
 * ViewerKernel projects exactly the assessment's SPATIAL_EVIDENCE refs, one feature per ref, so the
 * feature ids must equal the assessment's spatial evidence ids. Unknown refs => cannot be checked.
 */
export function checkEvidenceBinding(
  features: readonly LuViewerEvidenceProps[],
  spatialEvidenceRefs: readonly string[] | null,
): { readonly ok: true } | { readonly ok: false; readonly messageSv: string; readonly technical: readonly LuCheckDetailRow[] } {
  if (!spatialEvidenceRefs) {
    return {
      ok: false,
      messageSv: 'Det går inte att kontrollera att kontrollresultaten hör till den visade bedömningen, så de visas inte.',
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
    messageSv: 'Kontrollresultaten hör inte till den visade bedömningen och visas därför inte.',
    technical: [
      ...(missing.length ? [{ label: 'Saknas i kontrollresultaten', value: missing.join(', ') }] : []),
      ...(foreign.length ? [{ label: 'Hör inte till bedömningen', value: foreign.join(', ') }] : []),
    ],
  };
}
