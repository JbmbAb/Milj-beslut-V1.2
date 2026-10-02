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
 *   complete   -> "Låg risk i de kontroller som utfördes; 6 av 6 kontroller genomförda."
 *   unknown    -> "Låg risk i de kontroller som utfördes; uppgift om antalet genomförda
 *                  kontroller saknas i underlaget."
 *
 * Presentation only. The machine-readable risk level, permitProbability, findings,
 * unresolvedChecks and the checks themselves are untouched; this text is derived from them and
 * never feeds back into them.
 */
import type { GovernedLayerCheck } from './governedLayerChecks';

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
}

function isCompleted(check: GovernedLayerCheck): boolean {
  return check.status === 'CHECKED_HIT' || check.status === 'CHECKED_NO_HIT';
}

/** `null` when the checks are not available at all (e.g. no governed assessment): coverage unknown. */
export function summarizeGovernedCheckCoverage(checks: unknown): GovernedCheckCoverage | null {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  const notCompletedLayers: string[] = [];
  for (const check of checks) {
    const wellFormed =
      Boolean(check) && typeof check === 'object' && typeof (check as GovernedLayerCheck).layer === 'string';
    if (wellFormed && isCompleted(check as GovernedLayerCheck)) continue;
    // A malformed entry is still a check that cannot be shown as completed.
    notCompletedLayers.push(wellFormed ? (check as GovernedLayerCheck).layer : 'okänd kontroll');
  }
  return {
    checks_total: checks.length,
    checks_completed: checks.length - notCompletedLayers.length,
    checks_not_completed: notCompletedLayers.length,
    not_completed_layers: notCompletedLayers,
  };
}

const RISK_LEVEL_SV: Readonly<Record<string, string>> = {
  LOW: 'Låg risk',
  MEDIUM: 'Måttlig risk',
  HIGH: 'Hög risk',
};

/**
 * @param riskLevel the governed overallRisk (unchanged machine value).
 * @param checks    the governed layer checks of the same assessment (spatial + document).
 */
export function governedOverallStatementSv(riskLevel: string, checks: unknown): string {
  const risk = RISK_LEVEL_SV[riskLevel] ?? `Risknivå ${riskLevel}`;
  const coverage = summarizeGovernedCheckCoverage(checks);
  if (!coverage) {
    return `${risk} i de kontroller som utfördes; uppgift om antalet genomförda kontroller saknas i underlaget.`;
  }
  if (coverage.checks_not_completed > 0) {
    // Owner-approved form (OD-K0-1, 2026-10-02): N = completed checks, M = all checks.
    return (
      `${risk} i de kontroller som utfördes; underlaget är ofullständigt: ` +
      `${coverage.checks_completed} av ${coverage.checks_total} kontroller genomförda.`
    );
  }
  return `${risk} i de kontroller som utfördes; ${coverage.checks_completed} av ${coverage.checks_total} kontroller genomförda.`;
}
