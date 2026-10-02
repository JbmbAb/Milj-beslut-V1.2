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

/**
 * DEMO M1a / U12: `ok` on these (legacy, ungoverned) data sources only means the source ANSWERED --
 * it was never checked by the governed assessment. It must therefore never read as "kontrollerat --
 * ingen träff" / "Inga avvikelser identifierade". Only `presentLuGovernedLayerCheck` below may say
 * "kontrollerat", and only for a layer the governed run actually checked.
 */
const LABEL_BY_STATUS: Readonly<Record<LuDataSourceStatus, string>> = {
  ok: 'Källan svarade – inte kontrollerad i den styrda bedömningen',
  degraded: 'Ofullständigt underlag',
  unavailable: 'Källan är otillgänglig',
};

export function presentLuCoverageStatus(status: string): LuCoverageStatusPresentation {
  const known = LABEL_BY_STATUS[status as LuDataSourceStatus];
  return { label: known ?? 'Okänd status' };
}

/** DEMO M1a / U12: the governed per-layer check states (server: governedLayerChecks.ts). */
export type LuGovernedLayerCheckStatus = 'CHECKED_NO_HIT' | 'CHECKED_HIT' | 'NOT_CHECKED';

const GOVERNED_CHECK_LABEL: Readonly<Record<LuGovernedLayerCheckStatus, string>> = {
  CHECKED_NO_HIT: 'Kontrollerat – ingen träff',
  CHECKED_HIT: 'Kontrollerat – träff (se fynd)',
  NOT_CHECKED: 'Inte kontrollerat',
};

const GOVERNED_LAYER_NAME: Readonly<Record<string, string>> = {
  water: 'Vatten',
  ebh: 'Förorenade områden (EBH)',
  protected_area: 'Skyddade naturområden',
  natura2000: 'Natura 2000',
  water_protection_area: 'Vattenskyddsområden',
};

export function presentLuGovernedLayerCheck(check: { layer: string; status: string }): { name: string; label: string } {
  return {
    name: GOVERNED_LAYER_NAME[check.layer] ?? check.layer,
    // An unrecognised status is never shown as a checked/no-hit state.
    label: GOVERNED_CHECK_LABEL[check.status as LuGovernedLayerCheckStatus] ?? 'Okänd status',
  };
}
