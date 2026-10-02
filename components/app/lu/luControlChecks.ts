/**
 * DEMO M2a (LU product demonstrator) -- the six checks of the LU v1 set as knowledge states.
 *
 * Pure presentation model. Everything here is derived from data the governed API already returns:
 *   - GET /api/localization/:projectId/viewer/evidence  (per layer: exists, match_count_observed,
 *     max_features_per_layer, distance_meters = SEARCH RADIUS, algorithm, result_semantics_kind,
 *     engine, version / layer_version_hash, governance_status, cas ids)
 *   - GET /api/localization/:projectId/current-assessment  (findings: rule_id, risk_level incl.
 *     NOT_CHECKED, explanation, evidence_refs)
 *   - GET /api/localization/:projectId/geometry  (provenance, provisioning status)
 * plus the static rule/layer definitions (LURuleEngine LAYER_RULE_IDS).
 *
 * Invariants:
 *   - Silence is never absence. No evidence for a layer => "Inte kontrollerat", never "ingen träff".
 *   - No assessment yet => every layer is "Inte kontrollerat".
 *   - distance_meters is the SEARCH RADIUS of an existence-within-distance query. It is never shown
 *     as a measured distance ("avstånd").
 *   - A count equal to the per-layer cap is shown as "minst N" (the query stops counting there).
 *   - Nothing is invented: a field the API does not provide is shown as "saknas i underlaget".
 */

export type LuCheckKey = 'property' | 'water' | 'ebh' | 'protected_area' | 'natura2000' | 'water_protection_area';

export type LuKnowledgeState = 'HIT' | 'NO_HIT' | 'NOT_CHECKED' | 'UNCERTAIN' | 'SOURCE_UNAVAILABLE' | 'LOADING';

export const LU_KNOWLEDGE_STATE_LABEL: Readonly<Record<LuKnowledgeState, string>> = {
  HIT: 'Träff',
  NO_HIT: 'Kontrollerat – ingen träff',
  NOT_CHECKED: 'Inte kontrollerat',
  UNCERTAIN: 'Osäkert underlag',
  SOURCE_UNAVAILABLE: 'Källa otillgänglig',
  LOADING: 'Hämtar…',
};

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
  | { readonly status: 'error'; readonly message: string };

export type LuAssessmentPresence = 'none' | 'loading' | 'present' | 'error';

export interface LuPropertyInput {
  readonly lookedUp: boolean;
  readonly lookupError?: string;
  readonly geometryLoading?: boolean;
  readonly geometryError?: string;
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
  readonly key: LuCheckKey;
  readonly label: string;
  readonly state: LuKnowledgeState;
  readonly stateLabel: string;
  readonly summary: string;
  /** Rows for the evidence panel (result, count, radius, method, dataset version, status, retrieved_at). */
  readonly details: readonly LuCheckDetailRow[];
  /** Ids/hashes for the collapsed "Teknisk information" section. */
  readonly technical: readonly LuCheckDetailRow[];
  /** Search radius in metres when the governed evidence states one (for the map ring). */
  readonly searchRadiusMeters: number | null;
  /** The governed spatial evidence artifact id for this check, when there is one. */
  readonly evidenceArtifactId: string | null;
}

const MISSING = 'Saknas i underlaget';

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
  if (!s) return MISSING;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('sv-SE');
}

function featureLayer(props: LuViewerEvidenceProps): string | null {
  return str(props.layer_id) ?? str(props.dataset);
}

function layerCheck(
  def: LuCheckDefinition,
  assessment: LuAssessmentPresence,
  evidence: LuEvidenceLoad,
  findings: readonly LuFindingLike[],
): LuCheckView {
  const base = { key: def.key, label: def.label };
  const make = (
    state: LuKnowledgeState,
    summary: string,
    details: LuCheckDetailRow[] = [],
    technical: LuCheckDetailRow[] = [],
    searchRadiusMeters: number | null = null,
    evidenceArtifactId: string | null = null,
  ): LuCheckView => ({
    ...base,
    state,
    stateLabel: LU_KNOWLEDGE_STATE_LABEL[state],
    summary,
    details,
    technical: def.ruleId ? [{ label: 'Lager', value: def.key }, { label: 'Regel', value: def.ruleId }, ...technical] : technical,
    searchRadiusMeters,
    evidenceArtifactId,
  });
  const notCheckedResult = { label: 'Resultat', value: 'Ej kontrollerad' };

  if (assessment === 'loading') return make('LOADING', 'Hämtar sparad bedömning…');
  if (assessment === 'error') return make('UNCERTAIN', 'Den sparade bedömningen kunde inte läsas.', [notCheckedResult]);
  if (assessment === 'none') return make('NOT_CHECKED', 'Ingen bedömning har körts ännu.', [notCheckedResult]);

  const notCheckedFinding = def.ruleId
    ? findings.find((f) => f.rule_id === def.ruleId && f.risk_level === 'NOT_CHECKED')
    : undefined;
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
    return make('UNCERTAIN', 'Kontrollresultatet kunde inte hämtas.', [notCheckedResult], [{ label: 'Fel', value: evidence.message }]);
  }

  const layerFeatures = evidence.features.filter((f) => featureLayer(f) === def.key);
  if (layerFeatures.length === 0) {
    return make('NOT_CHECKED', 'Bedömningen innehåller inget kontrollresultat för detta lager.', [notCheckedResult]);
  }
  const props = layerFeatures.find((f) => f.exists === true) ?? layerFeatures[0]!;
  const radius = num(props.distance_meters);
  const artifactId = str(props.cas_artifact_id);
  const count = formatMatchCount(props.match_count_observed, props.max_features_per_layer);
  const details: LuCheckDetailRow[] = [
    {
      label: 'Resultat',
      value: props.exists === true ? 'Träff' : props.exists === false ? 'Ingen träff' : 'Kunde inte tolkas',
    },
    { label: 'Antal', value: count ?? MISSING },
    { label: 'Sökradie', value: formatRadius(radius) },
    { label: 'Metod', value: describeMethod(props) },
    { label: 'Datasetversion', value: shortHash(props.version ?? props.layer_version_hash) ?? MISSING },
    { label: 'Status', value: describeGovernanceStatus(props.governance_status) },
    { label: 'Hämtad', value: formatTimestamp(props.retrieved_at ?? props.queried_at) },
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
  return make('NO_HIT', `Inga objekt inom ${radiusText}.`, details, technical, radius, artifactId);
}

function propertyCheck(def: LuCheckDefinition, input: LuPropertyInput): LuCheckView {
  const make = (state: LuKnowledgeState, summary: string, details: LuCheckDetailRow[] = [], technical: LuCheckDetailRow[] = []): LuCheckView => ({
    key: def.key,
    label: def.label,
    state,
    stateLabel: LU_KNOWLEDGE_STATE_LABEL[state],
    summary,
    details,
    technical,
    searchRadiusMeters: null,
    evidenceArtifactId: null,
  });
  if (input.lookupError) return make('NOT_CHECKED', `Fastigheten kunde inte slås upp: ${input.lookupError}`);
  if (!input.lookedUp) return make('NOT_CHECKED', 'Fastigheten har inte slagits upp ännu.');
  if (input.geometryError) return make('UNCERTAIN', input.geometryError);
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
    return make('UNCERTAIN', 'Lokaliseringspunkten är sparad men analysen kunde inte förberedas.', details, technical);
  }
  return make('HIT', `Fastigheten hittades. Kontrollerna utgår från en ${pointText.replace('angiven', 'punkt angiven')}.`, details, technical);
}

export function deriveLuControlChecks(input: {
  readonly property: LuPropertyInput;
  readonly assessment: LuAssessmentPresence;
  readonly evidence: LuEvidenceLoad;
  readonly findings: readonly LuFindingLike[];
}): LuCheckView[] {
  return LU_V1_CHECKS.map((def) =>
    def.key === 'property' ? propertyCheck(def, input.property) : layerCheck(def, input.assessment, input.evidence, input.findings),
  );
}

/** Parses a /viewer/evidence response defensively; anything that is not a FeatureCollection is an error. */
export function parseViewerEvidence(payload: unknown): LuViewerEvidenceProps[] {
  const fc = payload as { type?: unknown; features?: unknown } | null;
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('Svaret var inte ett giltigt kontrollresultat.');
  }
  return fc.features.map((f) => ((f as { properties?: unknown })?.properties ?? {}) as LuViewerEvidenceProps);
}
