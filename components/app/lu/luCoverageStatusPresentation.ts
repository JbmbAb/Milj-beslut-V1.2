/**
 * LU-UNKNOWN-MISSING-DISPLAY-V1.
 *
 * Presentation mapping ONLY -- no new assessment semantics. The three per-source coverage states
 * this maps (`ok` / `degraded` / `unavailable`) are exactly the real, already-computed
 * `DataSourceStatus.status` enum the backend has produced since before this unit
 * (src/application/generate-localization-report.usecase.ts's buildDataSources). This module does
 * not invent a distinction the backend cannot support: it does not parse free-text `warnings`
 * strings to guess a status, and it does not correlate a data source to a specific finding/rule --
 * it only labels the coverage state the backend already assigned to that source.
 *
 * Critical rule: absence of data must never render as absence of risk. An unrecognized status
 * value falls through to an explicit "unknown" label, never silently to the "ok" label -- a status
 * this module doesn't recognize is exactly the situation where inventing a safe-looking default
 * would be most dangerous.
 */

export type LuDataSourceStatus = 'ok' | 'degraded' | 'unavailable';

export interface LuCoverageStatusPresentation {
  readonly label: string;
}

const LABEL_BY_STATUS: Readonly<Record<LuDataSourceStatus, string>> = {
  ok: 'Inga avvikelser identifierade i denna källa',
  degraded: 'Ofullständigt underlag',
  unavailable: 'Källan är otillgänglig',
};

export function presentLuCoverageStatus(status: string): LuCoverageStatusPresentation {
  const known = LABEL_BY_STATUS[status as LuDataSourceStatus];
  return { label: known ?? 'Okänd status' };
}
