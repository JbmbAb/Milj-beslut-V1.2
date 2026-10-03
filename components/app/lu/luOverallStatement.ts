/**
 * W-M2d item 2 (LU UI integration; DIRECTIVE-72H §11; owner decision OD-K0-1 and the 2026-10-02
 * night specifications) -- the assessment line ("helhetsraden") is the SERVER's overall statement,
 * shown word for word. The UI composes no statement of its own, names no risk level of its own and
 * counts nothing: `overallStatement.statement_sv` from GET current-assessment is the text, and the
 * server's own machine fields (`coverage_state`, `coverage.not_completed_layers`,
 * `coverage.limited_coverage_layers`, `pinned_evidence`) are only rendered as notices under it, with
 * Swedish layer names. The server guarantees the owner's forms ("Låg risk i de kontroller som
 * utfördes; underlaget är ofullständigt: N av M kontroller genomförda.", "Ingen samlad risknivå kan
 * presenteras – 0 av M kontroller genomförda.", "Täckningsgrad kan inte fastställas för denna
 * historiska bedömning ..."); a missing field reads "Saknas i underlaget", nothing is invented.
 *
 * Every record coverage state has its own Swedish label and tone; none of them is ever green.
 */

import { governedCheckLabelSv } from './luControlChecks';
import { presentServerTextSv } from './luServerText';

export type LuOverallTone = 'complete' | 'qualified' | 'technical';

export interface LuOverallStatementView {
  /** The server's machine coverage state, or 'MISSING' when the answer carries no statement. */
  readonly coverageState: string;
  /** Swedish label of a state that is not DETERMINED; null for DETERMINED. */
  readonly stateLabelSv: string | null;
  /** The server's statement_sv verbatim, or the "Saknas i underlaget" text. */
  readonly statementSv: string;
  /** Plain-Swedish notices from the server's own machine fields, shown directly under the statement. */
  readonly notices: readonly string[];
  readonly tone: LuOverallTone;
  /** True only when the server says re-reading may help (pinned evidence with a transient read error). */
  readonly retryable: boolean;
  /** Machine values for "Teknisk information". */
  readonly technical: readonly { readonly label: string; readonly value: string }[];
}

export const LU_OVERALL_MISSING_SV = 'Saknas i underlaget: svaret innehåller ingen samlad bedömning för den här bedömningen.';

/** Swedish label per server record coverage state (governedCoverageStatement.ts). */
const COVERAGE_STATE_LABEL_SV: Readonly<Record<string, string | null>> = {
  DETERMINED: null,
  // W-UI1 (owner doctrine 2026-10-03): a record from before the coverage contract -- the owner's sentence.
  HISTORICAL_COVERAGE_UNKNOWN: 'Täckningsgrad kan inte fastställas för denna historiska bedömning',
  PINNED_EVIDENCE_UNREADABLE: 'Tekniskt fel – den bundna evidensen kan inte läsas',
  CHECKS_UNAVAILABLE: 'Täckningsgrad okänd – uppgift om kontrollerna saknas',
  // W-M2e item 2 (U20CDF3, coordinator): the STORED record is an invalid combination (a NOT_CHECKED
  // finding next to evidence, evidence outside the governed layers, an unknown severity, a layer
  // evidenced twice) -- no count and no overall level; the stored findings are still listed one by one.
  RECORD_INTEGRITY_ERROR: 'Integritetsfel i den lagrade bedömningen – fynden visas var för sig',
};

/** W-M2e item 2 (inventory): the record coverage states with a label of their own (DETERMINED needs none). */
export const LU_OVERALL_COVERAGE_STATES: readonly string[] = Object.freeze(Object.keys(COVERAGE_STATE_LABEL_SV));

/** W-M2e item 2: states that are a technical or integrity fault of the record (purple, never retried by the UI on its own). */
const TECHNICAL_TONE_STATES: ReadonlySet<string> = new Set(['PINNED_EVIDENCE_UNREADABLE', 'RECORD_INTEGRITY_ERROR']);

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

function labels(layers: readonly string[]): string {
  return [...new Set(layers.map(governedCheckLabelSv))].join(', ');
}

/**
 * W-UI1 (owner invariant 2026-10-03): "0 av M" never stands beside a stored finding. A record that says no
 * check was completed while it holds a stored HIGH/MEDIUM/LOW finding contradicts itself; its line is not
 * shown as the statement.
 */
export const LU_OVERALL_ZERO_WITH_FINDINGS_SV =
  'Underlaget är motsägelsefullt: inga kontroller redovisas som genomförda, men bedömningen innehåller lagrade fynd. ' +
  'Ingen samlad bedömning visas – fynden redovisas var för sig.';

const ZERO_OF_M = /(^|\s)0 av \d+ kontroller/;

export function presentLuOverallStatement(
  raw: unknown,
  /** W-UI1: how many stored HIGH/MEDIUM/LOW findings the displayed record holds (for the "0 av M" invariant). */
  context: { readonly storedRiskFindings?: number } = {},
): LuOverallStatementView {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const statement = o ? str(o.statement_sv) : null;
  if (!o || !statement) {
    return {
      coverageState: 'MISSING',
      stateLabelSv: 'Saknas i underlaget',
      statementSv: LU_OVERALL_MISSING_SV,
      notices: [],
      tone: 'qualified',
      retryable: false,
      technical: [],
    };
  }
  const coverageState = str(o.coverage_state) ?? 'UNKNOWN';
  const coverage = o.coverage && typeof o.coverage === 'object' ? (o.coverage as Record<string, unknown>) : null;
  const pinned = o.pinned_evidence && typeof o.pinned_evidence === 'object' ? (o.pinned_evidence as Record<string, unknown>) : null;

  const notices: string[] = [];
  const notCompleted = coverage ? strings(coverage.not_completed_layers) : [];
  const limited = coverage ? strings(coverage.limited_coverage_layers) : [];
  if (notCompleted.length > 0) notices.push(`Ej genomförda kontroller: ${labels(notCompleted)}.`);
  if (limited.length > 0) notices.push(`Genomförda med begränsad täckning: ${labels(limited)}.`);

  const notDeterminedCount = coverage ? num(coverage.checks_not_completed) : null;
  const limitedCount = coverage ? num(coverage.checks_completed_with_limited_coverage) : null;
  const complete = coverageState === 'DETERMINED' && notDeterminedCount === 0 && limitedCount === 0;
  const tone: LuOverallTone = TECHNICAL_TONE_STATES.has(coverageState) ? 'technical' : complete ? 'complete' : 'qualified';

  const technical: { label: string; value: string }[] = [
    { label: 'Täckningskod', value: coverageState },
    ...(str(o.risk_level) ? [{ label: 'Risknivå (maskinvärde)', value: String(o.risk_level) }] : []),
    ...(strings(o.coverage_basis).length > 0 ? [{ label: 'Grund', value: strings(o.coverage_basis).join(', ') }] : []),
    ...(pinned && strings(pinned.unreadable_artifact_ids).length > 0
      ? [{ label: 'Oläsbara evidensobjekt', value: strings(pinned.unreadable_artifact_ids).join(', ') }]
      : []),
    ...(pinned && str(pinned.technical_error_class) ? [{ label: 'Felklass', value: String(pinned.technical_error_class) }] : []),
  ];

  const stateLabelSv = Object.prototype.hasOwnProperty.call(COVERAGE_STATE_LABEL_SV, coverageState)
    ? (COVERAGE_STATE_LABEL_SV[coverageState] ?? null)
    : 'Okänt täckningstillstånd';
  // W-UI1: the "0 av M" invariant -- a contradictory record is shown as such, its line only under Teknisk information.
  const zeroCompleted = (coverage ? num(coverage.checks_completed) === 0 : false) || ZERO_OF_M.test(statement);
  if (zeroCompleted && (context.storedRiskFindings ?? 0) > 0) {
    return {
      coverageState,
      stateLabelSv: 'Motsägelsefullt underlag',
      statementSv: LU_OVERALL_ZERO_WITH_FINDINGS_SV,
      notices: [],
      tone: 'technical',
      retryable: false,
      technical: [...technical, { label: 'Serverns text', value: statement }],
    };
  }
  return {
    coverageState,
    stateLabelSv,
    // W-UI1 (C): the server's line without internal terms (CAS, a code in parentheses); the codes stay technical.
    statementSv: presentServerTextSv(statement),
    notices,
    tone,
    // W-UI1 (owner decision 2): re-reading is offered only when the server marks the unreadable pinned evidence
    // retryable -- its flag, no client class list.
    retryable: coverageState === 'PINNED_EVIDENCE_UNREADABLE' && pinned?.retryable === true,
    technical,
  };
}
