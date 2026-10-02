/**
 * U20CDF2 (U20CDF verification G3; owner's locked specification 2026-10-02 night) -- THE normal
 * form of one governed spatial evidence result, shared by both readers of that evidence:
 *
 *  - before the rule engine: the fresh run passes the provider's outcome through
 *    assertGovernedSpatialQueryOutcome before anything reaches the kernel; an outcome outside the
 *    normal form is fail-closed (REJECT_SPATIAL_EVIDENCE_FORM -> EXECUTION_FAILED, no assessment);
 *  - in the coverage read model: computeGovernedLayerChecks (and the evidence details) read every
 *    stored evidence through readSpatialEvidenceForm, so an evidence is "checked, hit" / "checked,
 *    no hit" under exactly the rule the gate admitted.
 *
 * Before this, LURuleEngine fired on a truthy `result.exists` alone while the layer check also
 * demanded the admitted kind and a consistent match count -- `{ exists: true, match_count_observed:
 * 0 }` gave a MEDIUM finding next to "0 av 6". Now there is one acceptance rule and no second
 * interpretation. The rule engine itself (packages/mps-lu) is unchanged: on the product path it
 * only ever sees outcomes this gate admitted, and for those its reading of `exists` and this one
 * coincide (exists is a boolean; the count, when present, agrees with it).
 *
 * The normal form (the ADMIT v1 EXISTENCE_WITHIN_DISTANCE contract the provider produces):
 *  - `payload.source_metadata.dataset` is a non-empty string;
 *  - `result_semantics.kind` is EXISTENCE_WITHIN_DISTANCE, or absent (older evidence predating the
 *    field; never another declared kind);
 *  - `result_semantics.result.exists` is a boolean;
 *  - `result_semantics.result.match_count_observed`, when present (not undefined/null), is a
 *    non-negative integer and `count > 0` equals `exists`.
 * Query outcome level (fresh run only): every unavailable entry names a dataset, and no dataset is
 * both evidenced and reported unavailable. U20CDF3 (low 2): every entry names exactly one of the
 * requested layers, and each requested layer is answered at most once. Silence about a requested
 * layer is not a form violation here; the coverage classification (governedLayerChecks.ts) treats
 * such a record honestly.
 */

export const ADMITTED_SPATIAL_RESULT_KIND = 'EXISTENCE_WITHIN_DISTANCE';

/** The machine code of the fail-closed gate (the governed error vocabulary: REJECT_*). */
export const SPATIAL_EVIDENCE_FORM_REJECT_CODE = 'REJECT_SPATIAL_EVIDENCE_FORM';

export type SpatialEvidenceFormViolation =
  | 'DATASET_MISSING'
  | 'RESULT_MISSING'
  | 'RESULT_KIND_NOT_ADMITTED'
  | 'EXISTS_NOT_BOOLEAN'
  | 'MATCH_COUNT_NOT_A_COUNT'
  | 'MATCH_COUNT_CONTRADICTS_EXISTS';

export type SpatialEvidenceForm =
  | { readonly valid: true; readonly dataset: string; readonly exists: boolean; readonly match_count: number | null }
  | { readonly valid: false; readonly dataset: string | null; readonly violation: SpatialEvidenceFormViolation };

function invalid(dataset: string | null, violation: SpatialEvidenceFormViolation): SpatialEvidenceForm {
  return { valid: false, dataset, violation };
}

export function readSpatialEvidenceForm(evidence: unknown): SpatialEvidenceForm {
  const payload = (evidence && typeof evidence === 'object' ? (evidence as { payload?: unknown }).payload : undefined) as
    | { source_metadata?: { dataset?: unknown }; result_semantics?: unknown }
    | undefined;
  const rawDataset = payload?.source_metadata?.dataset;
  const dataset = typeof rawDataset === 'string' && rawDataset.length > 0 ? rawDataset : null;
  if (!dataset) return invalid(null, 'DATASET_MISSING');

  const semantics = payload?.result_semantics as { kind?: unknown; result?: unknown } | undefined;
  if (!semantics || typeof semantics !== 'object') return invalid(dataset, 'RESULT_MISSING');
  if (semantics.kind !== undefined && semantics.kind !== ADMITTED_SPATIAL_RESULT_KIND) {
    return invalid(dataset, 'RESULT_KIND_NOT_ADMITTED');
  }
  const result = semantics.result as { exists?: unknown; match_count_observed?: unknown } | undefined;
  if (!result || typeof result !== 'object') return invalid(dataset, 'RESULT_MISSING');
  if (typeof result.exists !== 'boolean') return invalid(dataset, 'EXISTS_NOT_BOOLEAN');

  const count = result.match_count_observed;
  if (count === undefined || count === null) return { valid: true, dataset, exists: result.exists, match_count: null };
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return invalid(dataset, 'MATCH_COUNT_NOT_A_COUNT');
  if (count > 0 !== result.exists) return invalid(dataset, 'MATCH_COUNT_CONTRADICTS_EXISTS');
  return { valid: true, dataset, exists: result.exists, match_count: count };
}

/** The query-outcome level violations of the fresh-run gate (on top of the per-evidence ones). */
export type SpatialQueryOutcomeViolation =
  | SpatialEvidenceFormViolation
  | 'UNAVAILABLE_WITHOUT_DATASET'
  | 'EVIDENCE_AND_UNAVAILABLE'
  /** U20CDF3 (low 2): an entry names a dataset that is not exactly one of the requested layers. */
  | 'DATASET_NOT_REQUESTED'
  /** U20CDF3 (low 2): a requested layer is answered more than once. */
  | 'DUPLICATE_LAYER_OUTCOME';

/** Swedish description of each violation (the machine code stays the truth, in parentheses). */
export const SPATIAL_QUERY_OUTCOME_VIOLATION_SV: Readonly<Record<SpatialQueryOutcomeViolation, string>> = {
  DATASET_MISSING: 'en evidens saknar lagernamn',
  RESULT_MISSING: 'resultat saknas i evidensen',
  RESULT_KIND_NOT_ADMITTED: 'evidensen anger en resultattyp som inte är tillåten',
  EXISTS_NOT_BOOLEAN: 'träffuppgiften är inte ett sant/falskt-värde',
  MATCH_COUNT_NOT_A_COUNT: 'antalet träffar är inget giltigt antal',
  MATCH_COUNT_CONTRADICTS_EXISTS: 'antalet träffar motsäger träffuppgiften',
  UNAVAILABLE_WITHOUT_DATASET: 'en uppgift om otillgängligt lager saknar lagernamn',
  EVIDENCE_AND_UNAVAILABLE: 'samma lager redovisas både med evidens och som otillgängligt',
  DATASET_NOT_REQUESTED: 'svaret gäller ett lager som inte efterfrågades',
  DUPLICATE_LAYER_OUTCOME: 'samma lager redovisas mer än en gång',
};

/**
 * U20CDF3 (U20CDF2 verification H6 / low 6): the gate's rejection as its own typed class -- a stable
 * machine code (REJECT_SPATIAL_EVIDENCE_FORM), the exact violation, and the layer concerned (null when
 * the entry names none). The fresh run reports it as exactly this, never as an ExecutionKernel error:
 * the gate stops the run before the kernel and the rule engine are reached.
 * The message names only a layer and fixed codes (no provider text).
 */
export class GovernedSpatialEvidenceFormError extends Error {
  readonly code = SPATIAL_EVIDENCE_FORM_REJECT_CODE;

  constructor(
    readonly violation: SpatialQueryOutcomeViolation,
    readonly layer: string | null,
  ) {
    super(`${SPATIAL_EVIDENCE_FORM_REJECT_CODE}: ${layer ?? 'okänt-lager'} ${violation}`);
    this.name = 'GovernedSpatialEvidenceFormError';
  }
}

/**
 * The fresh-run gate: throws a GovernedSpatialEvidenceFormError
 * (`REJECT_SPATIAL_EVIDENCE_FORM: <dataset> <violation>`) for the first entry outside the normal form.
 *
 * U20CDF3 (U20CDF2 verification H4 / low 2): every entry must name EXACTLY one of `requestedLayers`
 * (no case folding, no trimming) and no requested layer may be answered twice. An unknown or
 * mis-cased dataset used to pass, reach the rule engine (no rule -> no finding) and add a seventh
 * layer row ("6 av 7", "Låg risk"); now the run fails closed before the rule engine. Such a dataset is
 * never echoed as a layer (layer null): it is an arbitrary provider string.
 */
export function assertGovernedSpatialQueryOutcome(
  outcome: {
    readonly evidence: readonly unknown[];
    readonly unavailable_layers: readonly unknown[];
  },
  requestedLayers: readonly string[],
): void {
  const requested = new Set(requestedLayers);
  const evidenced = new Set<string>();
  for (const evidence of outcome.evidence) {
    const form = readSpatialEvidenceForm(evidence);
    if (form.dataset === null) {
      throw new GovernedSpatialEvidenceFormError('DATASET_MISSING', null);
    }
    if (!requested.has(form.dataset)) throw new GovernedSpatialEvidenceFormError('DATASET_NOT_REQUESTED', null);
    if (form.valid === false) {
      const rejected = form as Extract<SpatialEvidenceForm, { valid: false }>;
      throw new GovernedSpatialEvidenceFormError(rejected.violation, rejected.dataset);
    }
    if (evidenced.has(form.dataset)) throw new GovernedSpatialEvidenceFormError('DUPLICATE_LAYER_OUTCOME', form.dataset);
    evidenced.add(form.dataset);
  }
  const unavailableSeen = new Set<string>();
  for (const unavailable of outcome.unavailable_layers) {
    const dataset = unavailable && typeof unavailable === 'object' ? (unavailable as { dataset?: unknown }).dataset : undefined;
    if (typeof dataset !== 'string' || dataset.length === 0) {
      throw new GovernedSpatialEvidenceFormError('UNAVAILABLE_WITHOUT_DATASET', null);
    }
    if (!requested.has(dataset)) throw new GovernedSpatialEvidenceFormError('DATASET_NOT_REQUESTED', null);
    if (evidenced.has(dataset)) throw new GovernedSpatialEvidenceFormError('EVIDENCE_AND_UNAVAILABLE', dataset);
    if (unavailableSeen.has(dataset)) throw new GovernedSpatialEvidenceFormError('DUPLICATE_LAYER_OUTCOME', dataset);
    unavailableSeen.add(dataset);
  }
}
