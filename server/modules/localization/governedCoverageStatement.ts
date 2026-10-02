/**
 * U20-C (LU 72h; K0 verification finding 1; DIRECTIVE-72H section 11; SI-2/SI-3).
 *
 * The one place that turns a governed risk level plus the governed layer checks into the Swedish
 * overall statement shown in text: the generate-report summary and reasoning, the audit-log
 * description, and both PDF paths.
 *
 * Rule: a risk level is never stated alone when any governed check did not complete. "Låg risk"
 * next to a NOT_CHECKED document check (always the case in document v1) would read as a clean,
 * complete result. The statement therefore always says which part of the basis it covers:
 *
 *   incomplete -> "Låg risk i de kontroller som utfördes; underlaget är ofullständigt:
 *                  5 av 6 kontroller genomförda."   (owner-approved form, OD-K0-1)
 *   complete   -> "Låg risk i de kontroller som utfördes; 6 av 6 kontroller genomförda, varav 4 med
 *                  begränsad täckning."   (U20CDF F6; without the clause when none is limited)
 *   none done  -> "Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda."
 *                  (U20CDF, owner wording: no risk level is named when no check completed)
 *
 * U20CDF2 (U20CDF verification G1; owner's locked specification 2026-10-02 night): "N av M" is only
 * stated for a record whose coverage can be established -- assessGovernedCoverage below, over the
 * same rows the single layer-check derivation produced and the same stored findings the risk level
 * comes from (one record, one contract):
 *   historical -> "Täckningsgrad kan inte fastställas för denna historiska bedömning."
 *                  (coverage_state HISTORICAL_COVERAGE_UNKNOWN: the record says nothing about a
 *                  governed layer, or holds a combination no current run produces); never "0 av M"
 *   no checks  -> "Täckningsgrad kan inte fastställas: uppgift om genomförda kontroller saknas i
 *                  underlaget." (CHECKS_UNAVAILABLE; formerly "Låg risk ...", LOW 2)
 * and a known risk is never dropped: wherever no overall level is named (no checks, historical, 0 of
 * M), the stored HIGH/MEDIUM/LOW findings are named after the statement ("Bedömningens lagrade fynd
 * redovisas var för sig: risknivå hög – ...").
 *
 * Presentation only. The machine-readable risk level, permitProbability, findings,
 * unresolvedChecks and the checks themselves are untouched; this text is derived from them and
 * never feeds back into them.
 */
import {
  GOVERNED_DOCUMENT_CHECK_LAYER,
  GOVERNED_DOCUMENT_CHECK_RULE_ID,
  governedLayerOfRule,
  isFindingObject,
  isGovernedRiskFinding,
  isMalformedFinding,
  isUnknownSeverityFinding,
  type GovernedLayerCheck,
} from './governedLayerChecks';

/** Swedish display names for the governed checks. Unknown layers are shown by their id. */
const GOVERNED_LAYER_LABEL_SV: Readonly<Record<string, string>> = {
  water: 'Brunnar',
  ebh: 'Potentiellt förorenade områden (EBH)',
  protected_area: 'Skyddad natur',
  natura2000: 'Natura 2000',
  water_protection_area: 'Vattenskyddsområde',
  document: 'Dokument och tidigare beslut',
};

export function governedLayerLabelSv(layer: string): string {
  return GOVERNED_LAYER_LABEL_SV[layer] ?? layer;
}

export interface GovernedCheckCoverage {
  readonly checks_total: number;
  /** CHECKED_HIT or CHECKED_NO_HIT. */
  readonly checks_completed: number;
  /** Everything else, including an unrecognized status: never counted as completed. */
  readonly checks_not_completed: number;
  /** The layers whose check did not complete, in check order. */
  readonly not_completed_layers: readonly string[];
  /**
   * U20CDF (U20CD verification F6): completed checks whose basis is known NOT to be complete -- a
   * dataset with known coverage gaps (knownCoverageGaps.ts), or the v1 document check, which only
   * covers the documents pinned to the assessment. Counted only from presented checks.
   */
  readonly checks_completed_with_limited_coverage: number;
  readonly limited_coverage_layers: readonly string[];
}

function isCompleted(check: GovernedLayerCheck): boolean {
  return check.status === 'CHECKED_HIT' || check.status === 'CHECKED_NO_HIT';
}

function hasLimitedCoverage(check: GovernedLayerCheck): boolean {
  const gaps = (check as { known_coverage_gaps?: unknown }).known_coverage_gaps;
  // v1 document check: "Övriga dokument för fastigheten är inte kontrollerade" (K0) -- always limited.
  return (Array.isArray(gaps) && gaps.length > 0) || check.layer === 'document';
}

/** `null` when the checks are not available at all (e.g. no governed assessment): coverage unknown. */
export function summarizeGovernedCheckCoverage(checks: unknown): GovernedCheckCoverage | null {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  const notCompletedLayers: string[] = [];
  const limitedCoverageLayers: string[] = [];
  for (const check of checks) {
    const wellFormed =
      Boolean(check) && typeof check === 'object' && typeof (check as GovernedLayerCheck).layer === 'string';
    if (wellFormed && isCompleted(check as GovernedLayerCheck)) {
      if (hasLimitedCoverage(check as GovernedLayerCheck)) limitedCoverageLayers.push((check as GovernedLayerCheck).layer);
      continue;
    }
    // A malformed entry is still a check that cannot be shown as completed.
    notCompletedLayers.push(wellFormed ? (check as GovernedLayerCheck).layer : 'okänd kontroll');
  }
  return {
    checks_total: checks.length,
    checks_completed: checks.length - notCompletedLayers.length,
    checks_not_completed: notCompletedLayers.length,
    not_completed_layers: notCompletedLayers,
    checks_completed_with_limited_coverage: limitedCoverageLayers.length,
    limited_coverage_layers: limitedCoverageLayers,
  };
}

const RISK_LEVEL_SV: Readonly<Record<string, string>> = {
  LOW: 'Låg risk',
  MEDIUM: 'Måttlig risk',
  HIGH: 'Hög risk',
};

const RISK_LEVEL_WORD_SV: Readonly<Record<string, string>> = { HIGH: 'hög', MEDIUM: 'måttlig', LOW: 'låg' };
const RISK_LEVEL_ORDER: readonly string[] = ['HIGH', 'MEDIUM', 'LOW'];

/**
 * U20CDF2: a stored finding's level in running text -- "risknivå hög" -- for the places that name
 * stored findings without stating an overall risk level (it never forms the phrase "låg risk").
 */
export function riskLevelPhraseSv(level: string): string {
  return `risknivå ${RISK_LEVEL_WORD_SV[level] ?? level}`;
}

/** The highest HIGH/MEDIUM/LOW level among the findings; null when none carries one. */
export function highestGovernedRiskLevel(findings: readonly { readonly risk_level?: unknown }[]): string | null {
  return RISK_LEVEL_ORDER.find((level) => findings.some((f) => f?.risk_level === level)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// U20CDF2 (G1): can the coverage of this record be established at all?
// ---------------------------------------------------------------------------------------------

/**
 * The machine-readable coverage state of one assessment record (PRES-24: new token, owner wording):
 *  - DETERMINED: every governed layer is accounted for, consistently with the stored findings, as a
 *    current run records it -- "N av M" is stated;
 *  - HISTORICAL_COVERAGE_UNKNOWN: the record lacks the coverage metadata a current run writes;
 *  - PINNED_EVIDENCE_UNREADABLE (U20CDF2 G2): the record is bound to evidence that cannot be read back
 *    from CAS -- an integrity/technical error, not a new coverage computation (nothing is recounted
 *    from what happens to be readable now; the stored findings are still named);
 *  - CHECKS_UNAVAILABLE: no layer checks at all;
 *  - RECORD_INTEGRITY_ERROR (U20CDF3; owner: "ogiltig kombination fail-closed"): the record holds a
 *    combination no known producer writes and that the common normal form does not admit (see
 *    assessGovernedCoverage) -- a typed integrity error: no count, no overall level, stored findings
 *    still named.
 */
export type GovernedRecordCoverageState =
  | 'DETERMINED'
  | 'HISTORICAL_COVERAGE_UNKNOWN'
  | 'PINNED_EVIDENCE_UNREADABLE'
  | 'CHECKS_UNAVAILABLE'
  | 'RECORD_INTEGRITY_ERROR';

/**
 * U20CDF2 (G2): what a read-back could not read among the assessment's pinned evidence refs. A ref
 * that is not found is a lasting loss (EVIDENCE_NOT_FOUND, not retryable); a failed read of a present
 * object may pass on retry (EVIDENCE_READ_ERROR, retryable) -- one lasting loss makes the whole
 * record not retryable. Content that was read but failed its own identity is not here: that fails
 * the read-back closed (424) before any statement is made.
 */
export interface PinnedEvidenceReadability {
  readonly pinned_total: number;
  readonly unreadable_artifact_ids: readonly string[];
  readonly technical_error_class: 'EVIDENCE_NOT_FOUND' | 'EVIDENCE_READ_ERROR' | null;
  readonly retryable: boolean | null;
  /**
   * U20CDF3 (low 2): pinned spatial evidence that was read intact but names a dataset outside the
   * governed layers (unknown or mis-cased). No layer row is made for it; the record is a
   * RECORD_INTEGRITY_ERROR. Absent when there is none.
   */
  readonly outside_governed_layers_artifact_ids?: readonly string[];
  /**
   * U20CDF4 (U20CDF3 verification L6.2): positions in the assessment's `evidence_refs` of entries that are
   * not a well-formed ref (not an object, no string id or type, a known evidence type in the wrong
   * spelling). The record is a RECORD_INTEGRITY_ERROR. Absent when there is none.
   */
  readonly malformed_evidence_ref_indexes?: readonly number[];
  /**
   * W-U20CDF5 (U20CDF4 verification M1): the refs alone pin at least one DOCUMENT_EVIDENCE and one
   * VERIFIED_DOCUMENT_FACT -- exactly what LU-DOC-BESLUT-001 reads -- known WITHOUT reading any artifact.
   * Lets a NOT_CHECKED document finding beside them be recognised as a contradiction even when a pinned
   * document could not be read (the document row is then a technical error, not CHECKED_HIT). Absent
   * when not.
   */
  readonly document_rule_inputs_pinned?: boolean;
}

export const HISTORICAL_COVERAGE_UNKNOWN_SV = 'Täckningsgrad kan inte fastställas för denna historiska bedömning.';
const CHECKS_UNAVAILABLE_SV = 'Täckningsgrad kan inte fastställas: uppgift om genomförda kontroller saknas i underlaget.';
export const RECORD_INTEGRITY_ERROR_SV =
  'Integritetsfel: bedömningens lagrade underlag är motsägelsefullt eller ligger utanför det styrda formatet. ' +
  'Täckningsgrad och samlad risknivå kan därför inte fastställas.';

export interface GovernedStatementContext {
  /** The assessment's stored findings -- the rule engine's outcome the risk level is derived from. */
  readonly findings: readonly { readonly rule_id: string; readonly risk_level: string }[];
  /** Read-back only (U20CDF2 G2): what could not be read among the pinned evidence refs. */
  readonly pinnedEvidence?: PinnedEvidenceReadability;
  /**
   * U20CDF4 (owner decisions 2026-10-03 (4) points 1-3): the record was written by THIS run, i.e. by the
   * current producer. "Historical" means written by an older producer that never promised the
   * metadata; for a fresh record the actual contract is the current one, so whatever a current run
   * never writes (a silent layer, a hit without its finding, ...) is a break of that contract:
   * RECORD_INTEGRITY_ERROR with the same basis codes -- never "denna historiska bedömning".
   */
  readonly freshRun?: boolean;
  /**
   * W-U20CDF5: facts about the STORED record being read back that the findings list alone cannot carry
   * (passed by the read-back, the PDF, verify and the map; absent for a fresh run and for callers that
   * only hold checks + findings).
   *  - hasFindingsField (U20CDF4 verification L3): false when the record has no `findings` field at all.
   *    `findings` has been in the assessment type since 61063241 (2026-08-04) and in every producer since
   *    9c200a78 (2026-08-08), so its absence breaks the finding contract (MALFORMED_RECORD_ENTRY:findings),
   *    exactly like a field that is not a list.
   */
  readonly storedRecord?: {
    readonly hasFindingsField: boolean;
  };
}

export interface GovernedCoverageAssessment {
  readonly coverage_state: GovernedRecordCoverageState;
  /** Machine codes of what makes the coverage undeterminable, in check order; [] when DETERMINED. */
  readonly coverage_basis: readonly string[];
  /** The N-of-M count; null unless DETERMINED (never reconstructed from what happens to be readable). */
  readonly coverage: GovernedCheckCoverage | null;
  /** Present iff coverage_state is PINNED_EVIDENCE_UNREADABLE and the read-back said what it could not read. */
  readonly pinned_evidence?: PinnedEvidenceReadability;
}

/**
 * Reads the rows of the single layer-check derivation (computeGovernedLayerChecks /
 * computeGovernedDocumentCheck) together with the stored findings. A current run -- provider outcome
 * in the normal form, rule engine over it, everything pinned -- never yields any of these, so each
 * one marks a record that does not carry a current run's coverage metadata:
 *  - LAYER_NOT_RECORDED:<layer>  the record says nothing about a governed layer (no evidence, no
 *    NOT_CHECKED finding): the real provider answers for every requested layer, so only an older
 *    producer leaves this (e.g. before negative results were persisted, or before the layer existed);
 *  - FINDING_WITHOUT_CONSISTENT_EVIDENCE:<layer>  a stored risk finding without the consistent
 *    evidence a current run pins with it (the layer still counts as processed);
 *  - EVIDENCE_NOT_IN_NORMAL_FORM:<layer>  stored evidence the fresh-run gate would have rejected, from
 *    before the result contract (no result_semantics); U20CDF4: evidence that declares the contract and
 *    breaks it is EVIDENCE_VIOLATES_RESULT_CONTRACT, an integrity error (owner decision 2);
 *  - HIT_WITHOUT_FINDING:<layer>  a hit the layer's rule did not turn into a finding;
 *  - DOCUMENT_FINDING_WITHOUT_PINNED_DOCUMENTS  an LU-DOC-BESLUT-001 finding without the pinned
 *    document evidence + verified fact it rests on.
 */
export function assessGovernedCoverage(checks: unknown, context: GovernedStatementContext): GovernedCoverageAssessment {
  if (!Array.isArray(checks) || checks.length === 0) {
    // U20CDF4: a fresh run always writes its checks; without them its record is not established.
    return context?.freshRun
      ? { coverage_state: 'RECORD_INTEGRITY_ERROR', coverage_basis: ['CHECKS_UNAVAILABLE'], coverage: null }
      : { coverage_state: 'CHECKS_UNAVAILABLE', coverage_basis: [], coverage: null };
  }
  const pinned = context?.pinnedEvidence;
  const findings = Array.isArray(context?.findings) ? context.findings : [];
  // U20CDF3 (owner: "ogiltig kombination fail-closed"; one common normal form): combinations no known
  // producer writes are a typed integrity error, ahead of the historical classification.
  // W-U20CDF5 (U20CDF4 verification M1): and ahead of PINNED_EVIDENCE_UNREADABLE. Every entry below is
  // established WITHOUT the evidence that could not be read -- from the record itself (findings, refs) or
  // from evidence that WAS read -- so a read fault never hides it: the record is a RECORD_INTEGRITY_ERROR
  // (not retryable), with what could not be read appended to its basis.
  const integrity: string[] = [];
  for (const id of pinned?.outside_governed_layers_artifact_ids ?? []) integrity.push(`EVIDENCE_OUTSIDE_GOVERNED_LAYERS:${id}`);
  // U20CDF4 (U20CDF3 verification L6.2/L6.3; owner decision 2): entries that break the record's own
  // contract -- a malformed evidence ref (used to be dropped silently, the layer then read "historical"),
  // a findings field that is present but not a list, or a finding that is not one (used to throw: a
  // generic 500). W-U20CDF5 (U20CDF4 verification L3): a stored record WITHOUT a findings field breaks the
  // same contract (every producer since 9c200a78 writes it; it used to be read as "no finding", then 500).
  for (const index of pinned?.malformed_evidence_ref_indexes ?? []) integrity.push(`MALFORMED_RECORD_ENTRY:evidence_refs#${index}`);
  const rawFindings = (context as { findings?: unknown } | undefined)?.findings;
  if (context?.storedRecord?.hasFindingsField === false || (rawFindings !== undefined && !Array.isArray(rawFindings))) {
    integrity.push('MALFORMED_RECORD_ENTRY:findings');
  }
  // U20CDF3 (U20CDF2 verification H5.1 / low 4): a NOT_CHECKED finding of a layer's rule next to stored
  // evidence for that layer -- with or without a risk finding beside it. The gate rejects evidence +
  // unavailable for one layer and the rule engine writes NOT_CHECKED only for an unavailable layer, so
  // no known producer writes this; it used to read as "0 av M".
  const notCheckedRules = new Set(
    findings.filter((finding) => finding?.risk_level === 'NOT_CHECKED').map((finding) => finding.rule_id),
  );
  for (const entry of checks) {
    if (!entry || typeof entry !== 'object') continue;
    const check = entry as GovernedLayerCheck;
    if (check.layer === GOVERNED_DOCUMENT_CHECK_LAYER) {
      // U20CDF4 (U20CDF3 verification L6.1): the document check was exempt here, so a NOT_CHECKED finding
      // of LU-DOC-BESLUT-001 next to the pinned DE + VF it would rest on (the row CHECKED_HIT, derived
      // from the refs, OD-K0-3) read "6 av 6". The rule engine writes NOT_CHECKED only for an unavailable
      // spatial layer, so no producer writes this: the same contradiction as for a layer.
      // W-U20CDF5 (M1): the pinned DE + VF are known from the refs alone, also when a pinned document
      // could not be read (the row is then a technical error, not CHECKED_HIT).
      const ruleInputsPinned = check.status === 'CHECKED_HIT' || pinned?.document_rule_inputs_pinned === true;
      if (ruleInputsPinned && notCheckedRules.has(GOVERNED_DOCUMENT_CHECK_RULE_ID)) {
        integrity.push(`NOT_CHECKED_FINDING_WITH_EVIDENCE:${GOVERNED_DOCUMENT_CHECK_LAYER}`);
      }
      continue;
    }
    const contradicted =
      check.reason === 'NOT_CHECKED_FINDING_WITH_EVIDENCE' ||
      (check.status === 'CHECKED_HIT' && check.rule_id !== null && notCheckedRules.has(check.rule_id) && check.evidence_artifact_id !== null);
    if (contradicted) integrity.push(`NOT_CHECKED_FINDING_WITH_EVIDENCE:${check.layer}`);
    // U20CDF3 (low 7b): more than one evidence for one layer (the gate admits one outcome per layer).
    if (check.reason === 'DUPLICATE_LAYER_EVIDENCE') integrity.push(`DUPLICATE_LAYER_EVIDENCE:${check.layer}`);
    // U20CDF4 (owner decision 2): evidence that declares the result contract and breaks it. (Evidence
    // from before the contract -- UNRECOGNIZED_RESULT -- stays historical below.)
    if (check.reason === 'EVIDENCE_VIOLATES_RESULT_CONTRACT') integrity.push(`EVIDENCE_VIOLATES_RESULT_CONTRACT:${check.layer}`);
  }
  // U20CDF3 (U20CDF2 verification H4 / low 3): a stored finding with a severity outside the governed
  // values ('high', 'CRITICAL', ...) used to be silently ignored (machine level LOW, nothing in the
  // text). It is an integrity error, and storedRiskFindingsSv names it.
  findings.forEach((finding, index) => {
    if (isMalformedFinding(finding)) {
      integrity.push(`MALFORMED_RECORD_ENTRY:findings#${index}`);
      return;
    }
    if (!isUnknownSeverityFinding(finding)) return;
    const id = (finding as { finding_id?: unknown })?.finding_id;
    const ruleId = (finding as { rule_id?: unknown })?.rule_id;
    integrity.push(`UNKNOWN_SEVERITY:${typeof id === 'string' && id ? id : typeof ruleId === 'string' && ruleId ? ruleId : `#${index}`}`);
  });
  // U20CDF2 (G2): bound to evidence that cannot be read -- a technical/integrity error, never a recount of
  // what happens to be readable now. W-U20CDF5 (M1): only when nothing above already establishes a break.
  const unreadableBasis =
    pinned && pinned.unreadable_artifact_ids.length > 0
      ? pinned.unreadable_artifact_ids.map((id) => `PINNED_EVIDENCE_UNREADABLE:${id}`)
      : checks
          .filter((entry): entry is GovernedLayerCheck => Boolean(entry) && (entry as GovernedLayerCheck).reason === 'PINNED_EVIDENCE_UNREADABLE')
          .map((check) => `PINNED_EVIDENCE_UNREADABLE:${check.evidence_artifact_id ?? check.layer}`);
  if (integrity.length > 0) {
    return { coverage_state: 'RECORD_INTEGRITY_ERROR', coverage_basis: [...integrity, ...unreadableBasis], coverage: null };
  }
  if (unreadableBasis.length > 0) {
    return {
      coverage_state: 'PINNED_EVIDENCE_UNREADABLE',
      coverage_basis: unreadableBasis,
      coverage: null,
      // Exactly the readability fields (the integrity list above is reported through coverage_basis).
      ...(pinned && pinned.unreadable_artifact_ids.length > 0
        ? {
            pinned_evidence: {
              pinned_total: pinned.pinned_total,
              unreadable_artifact_ids: pinned.unreadable_artifact_ids,
              technical_error_class: pinned.technical_error_class,
              retryable: pinned.retryable,
            },
          }
        : {}),
    };
  }
  const riskRules = new Set(findings.filter(isGovernedRiskFinding).map((finding) => finding.rule_id));
  const basis: string[] = [];
  let documentCheck: GovernedLayerCheck | null = null;
  for (const entry of checks) {
    if (!entry || typeof entry !== 'object') continue;
    const check = entry as GovernedLayerCheck;
    if (check.layer === GOVERNED_DOCUMENT_CHECK_LAYER) {
      documentCheck = check;
      continue;
    }
    if (check.reason === 'NO_EVIDENCE') basis.push(`LAYER_NOT_RECORDED:${check.layer}`);
    else if (check.reason === 'FINDING_WITHOUT_CONSISTENT_EVIDENCE') basis.push(`FINDING_WITHOUT_CONSISTENT_EVIDENCE:${check.layer}`);
    else if (check.reason === 'UNRECOGNIZED_RESULT') basis.push(`EVIDENCE_NOT_IN_NORMAL_FORM:${check.layer}`);
    else if (check.status === 'CHECKED_HIT' && check.rule_id && !riskRules.has(check.rule_id)) {
      basis.push(`HIT_WITHOUT_FINDING:${check.layer}`);
    }
  }
  if (riskRules.has(GOVERNED_DOCUMENT_CHECK_RULE_ID) && documentCheck?.status !== 'CHECKED_HIT') {
    basis.push('DOCUMENT_FINDING_WITHOUT_PINNED_DOCUMENTS');
  }
  if (basis.length > 0) {
    // U20CDF4: only a record from an older producer is historical; a fresh one breaks the current contract.
    return { coverage_state: context?.freshRun ? 'RECORD_INTEGRITY_ERROR' : 'HISTORICAL_COVERAGE_UNKNOWN', coverage_basis: basis, coverage: null };
  }
  return { coverage_state: 'DETERMINED', coverage_basis: [], coverage: summarizeGovernedCheckCoverage(checks) };
}

const STORED_FINDING_LABEL_ORDER = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area', GOVERNED_DOCUMENT_CHECK_LAYER];

/**
 * The stored HIGH/MEDIUM/LOW findings in words, highest level first, each with the checks (or, for a
 * rule outside them, the rule id) it comes from: "risknivå hög – Natura 2000; risknivå måttlig –
 * Brunnar"; U20CDF3 (low 3): findings of unknown severity last ("okänd allvarlighetsgrad – ...").
 * null when there is none.
 */
/**
 * U20CDF4 (owner decision 1: no raw text from a broken record): a rule id outside the governed checks is
 * named only when it is a plain identifier; anything else (not a string, markup, a long text) is named
 * by this neutral label -- the finding is still named, its stored value is not echoed.
 */
const SAFE_RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const INVALID_RULE_ID_LABEL_SV = 'regel med ogiltigt id';

export function storedRiskFindingsSv(findings: readonly { readonly rule_id: string; readonly risk_level: string }[]): string | null {
  const parts: string[] = [];
  const order = (key: string) => {
    const index = STORED_FINDING_LABEL_ORDER.indexOf(key);
    return index >= 0 ? `0${index}` : `1${key}`;
  };
  const labelsOf = (selected: readonly { readonly rule_id?: unknown }[]) => {
    const keys = new Set<string>();
    for (const finding of selected) {
      const ruleId = finding.rule_id;
      const layer =
        typeof ruleId !== 'string'
          ? null
          : ruleId === GOVERNED_DOCUMENT_CHECK_RULE_ID
            ? GOVERNED_DOCUMENT_CHECK_LAYER
            : governedLayerOfRule(ruleId);
      keys.add(layer ?? (typeof ruleId === 'string' && SAFE_RULE_ID.test(ruleId) ? `rule:${ruleId}` : 'rule-invalid'));
    }
    return [...keys]
      .sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0))
      .map((key) =>
        key === 'rule-invalid' ? INVALID_RULE_ID_LABEL_SV : key.startsWith('rule:') ? key.slice('rule:'.length) : governedLayerLabelSv(key),
      );
  };
  // U20CDF4 (L6.3): only entries that are objects carry anything to name (a null entry is reported as
  // MALFORMED_RECORD_ENTRY by assessGovernedCoverage, and named nowhere as a level).
  const objects = (Array.isArray(findings) ? findings : []).filter(isFindingObject);
  for (const level of RISK_LEVEL_ORDER) {
    const labels = labelsOf(objects.filter((finding) => finding.risk_level === level));
    if (labels.length > 0) parts.push(`${riskLevelPhraseSv(level)} – ${labels.join(', ')}`);
  }
  // U20CDF3 (low 3): a finding of unknown severity is never dropped; its raw value is not echoed.
  const unknown = labelsOf(objects.filter((finding) => isUnknownSeverityFinding(finding)));
  if (unknown.length > 0) parts.push(`okänd allvarlighetsgrad – ${unknown.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * @param riskLevel the governed overallRisk (unchanged machine value).
 * @param checks    the governed layer checks of the same assessment (spatial + document).
 * @param context   U20CDF2: the same assessment's stored findings.
 */
export function governedOverallStatementSv(riskLevel: string, checks: unknown, context: GovernedStatementContext): string {
  const risk = RISK_LEVEL_SV[riskLevel] ?? `Risknivå ${riskLevel}`;
  const assessed = assessGovernedCoverage(checks, context);
  const stored = storedRiskFindingsSv(Array.isArray(context?.findings) ? context.findings : []);
  // U20CDF2 (owner: a known risk never disappears): named wherever no overall level is stated.
  const storedClause = stored ? ` Bedömningens lagrade fynd redovisas var för sig: ${stored}.` : '';
  if (assessed.coverage_state === 'CHECKS_UNAVAILABLE') return `${CHECKS_UNAVAILABLE_SV}${storedClause}`;
  if (assessed.coverage_state === 'HISTORICAL_COVERAGE_UNKNOWN') return `${HISTORICAL_COVERAGE_UNKNOWN_SV}${storedClause}`;
  if (assessed.coverage_state === 'RECORD_INTEGRITY_ERROR') return `${RECORD_INTEGRITY_ERROR_SV}${storedClause}`;
  if (assessed.coverage_state === 'PINNED_EVIDENCE_UNREADABLE') {
    // U20CDF2 (G2; owner): never "0 av M" recounted from what is readable now, never an overall
    // level that hides or replaces the stored findings; the error class and whether a retry can help.
    const pinned = assessed.pinned_evidence;
    const what = pinned
      ? `${pinned.unreadable_artifact_ids.length} av ${pinned.pinned_total} bundna evidensobjekt kunde inte läsas ur CAS` +
        (pinned.technical_error_class ? ` (${pinned.technical_error_class})` : '')
      : 'bundna evidensobjekt kunde inte läsas ur CAS';
    const retry =
      pinned?.retryable === true
        ? ' Ett nytt försök kan lyckas.'
        : pinned?.retryable === false
          ? ' Felet är bestående och löses inte av ett nytt försök.'
          : '';
    return `Den pinnade evidensen kan inte verifieras: ${what}.${retry} Täckningsgrad och samlad risknivå kan därför inte fastställas.${storedClause}`;
  }
  const coverage = assessed.coverage!;
  if (coverage.checks_completed === 0) {
    // U20CDF (U20CD verification F2; DIRECTIVE-72H section 11; owner wording 2026-10-02): with no
    // completed check there is nothing a risk level could be about -- "Låg risk ... 0 av 6" would be
    // the collapse to LOW the directive forbids. No level is named; the machine value is untouched.
    // In a current record no M-layer finding can stand beside 0 of M (a finding makes its layer
    // completed); a finding of another rule is still named, never dropped.
    return `Ingen samlad risknivå kan presenteras – 0 av ${coverage.checks_total} kontroller genomförda.${storedClause}`;
  }
  if (coverage.checks_not_completed > 0) {
    // Owner-approved form (OD-K0-1, 2026-10-02): N = completed checks, M = all checks.
    return (
      `${risk} i de kontroller som utfördes; underlaget är ofullständigt: ` +
      `${coverage.checks_completed} av ${coverage.checks_total} kontroller genomförda.`
    );
  }
  const limited = coverage.checks_completed_with_limited_coverage;
  // U20CDF (U20CD verification F6): "all checks done" never reads as full coverage when the basis of
  // some of them is known to be limited.
  return (
    `${risk} i de kontroller som utfördes; ${coverage.checks_completed} av ${coverage.checks_total} kontroller genomförda` +
    (limited > 0 ? `, varav ${limited} med begränsad täckning.` : '.')
  );
}
