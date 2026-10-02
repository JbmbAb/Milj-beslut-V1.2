/**
 * localizationPdfService.ts
 *
 * PDF export for localization study reports.
 * Returns structured JSON suitable for PDF rendering by PDFKit, jsPDF, or similar.
 */

import type { LocalizationReport } from './localizationReportService';
import {
  isGovernedVerdict,
  legacyObservationTag,
  type LuAssessmentStatus,
  type LuComparisonStatus,
} from '../../src/application/generate-localization-report.usecase';
import type { GovernedLayerCheck } from '../modules/localization/governedLayerChecks';

/**
 * U20-C: this projection (POST /api/localization/generate-pdf-data) is the older report path. It
 * says so in its own answer: only the governed fields below come from the governed assessment;
 * everything sourced from `legacyObservations` is an older, ungoverned observation.
 */
export const LEGACY_PDF_GOVERNANCE_NOTE_SV =
  'Äldre rapportväg. Endast assessment_status, assessment_artifact_id, overallRisk, ' +
  'permitProbability/permitProbabilityStatus, unresolvedChecks, overall_statement_sv och ' +
  'governed_layer_checks kommer från den styrda bedömningen. Äldre observationer (fornlämningar, ' +
  'VISS, SLU, skyddade områden, avstånd till vatten, datakällor) står i blocket legacyObservations ' +
  '(governed: false) med tillgänglighet per källa; restrictions och rules kommer från den äldre ' +
  'regelmotorn. Allt detta är äldre observationer som inte är styrd evidens och inte ingår i ' +
  'bedömningen. En källa som inte kunde läsas anges som ej tillgänglig, aldrig som nej eller 0.';

export const LEGACY_SOURCE_UNAVAILABLE_SV = 'ej tillgänglig';
export const LEGACY_SOURCE_AVAILABLE_SV = 'tillgänglig';

/**
 * U20CDF (U20CD verification F4; owner directive 2026-10-02): the older observations stay ONE
 * separate block in this projection -- governed: false, availability per source -- instead of being
 * flattened into site fields. A source that could not be read is shown as unavailable ("ej
 * tillgänglig", value null), never as false / 0 (a false negative observation).
 */
export interface LegacyPdfObservations {
  readonly governed: false;
  readonly source: 'legacy_observation';
  readonly version: 'v1';
  readonly note_sv: string;
  readonly protectedArea: {
    readonly available: boolean;
    readonly status_sv: string;
    readonly isProtected: boolean | null;
    readonly names: string[];
  };
  readonly monuments: {
    readonly available: boolean;
    readonly status_sv: string;
    readonly count: number | null;
    readonly names: string[];
  };
  readonly slu: { readonly available: boolean; readonly status_sv: string; readonly observationCount: number | null };
  readonly viss: {
    readonly available: boolean;
    readonly status_sv: string;
    readonly waterName: string | null;
    readonly ecologicalStatus: string | null;
    readonly chemicalStatus: string | null;
  };
  readonly distanceToWater: { readonly available: boolean; readonly status_sv: string; readonly meters: number | null };
  readonly dataSources: Array<{ source: string; status: string; detail?: string }>;
}

export interface LocalizationPdfData {
  title: string;
  generatedAt: string;
  projectId: string;
  disclaimer: string;
  /** U20-C: what in this older report path is governed and what is not. */
  governance_note_sv: string;
  summary: {
    /**
     * P3-LU-CANONICAL-CHAIN-01 — omitted when no site carries a governed verdict.
     *
     * Previously defaulted to the string 'N/A', which renders in the PDF as though a
     * comparison had been made and produced nothing. Absence is the only representation that
     * cannot be read as a result.
     */
    bestAlternativeId?: string;
    reasoning: string;
    /** COMPLETE | PARTIAL | UNAVAILABLE — how much of the candidate set was assessed. */
    comparison_status: LuComparisonStatus;
    assessed_site_ids: string[];
    unassessed_site_ids: string[];
  };
  sites: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    /**
     * Verdict-bearing. Present IFF the site has a governed LocalizationAssessmentArtifact.
     * Rendering `undefined` into a PDF would put an unbacked verdict in front of a caseworker.
     */
    overallRisk?: string;
    /**
     * W2b: absent exactly when the governed verdict's permitProbability is `null` (SEM-1
     * NOT_CHECKED). The old code read this key unconditionally, so a consumer that only checked
     * `!== undefined` let `null` through and rendered `Math.round(null * 100)` = 0%, a fabricated
     * number the ADR-28A/SEM-1 decision was written specifically to prevent. Same rule as
     * `bestAlternativeId` above: absence, not a placeholder value, carries the "not computed"
     * meaning. See `permitProbabilityStatus`/`permitProbabilityText` for what fills its place.
     */
    permitProbability?: number;
    /** Present IFF `permitProbability` is withheld. Only one cause exists today. */
    permitProbabilityStatus?: 'NOT_CHECKED';
    /** Caseworker-facing Swedish text to render in place of a number. Present IFF the status above is. */
    permitProbabilityText?: string;
    /** The governed rules whose required evidence could not be checked, so the withholding is traceable. */
    unresolvedChecks?: Array<{ ruleId: string; findingId: string }>;
    /**
     * U20-C / OD-K0-1: the governed risk level in words, never alone: always with how many
     * governed checks were completed ("… underlaget är ofullständigt: 5 av 6 kontroller
     * genomförda."). Present IFF the site carries a governed verdict.
     */
    overall_statement_sv?: string;
    /**
     * U20CDF2 (G1): next to overall_statement_sv, whether the run's coverage could be established
     * (DETERMINED) or not (HISTORICAL_COVERAGE_UNKNOWN / CHECKS_UNAVAILABLE). Present IFF both the
     * statement and the run's coverage state are.
     */
    overall_coverage_state?: string;
    /** U20-C (K0 verification finding 1): the governed layer checks, document check included; null without a governed run. */
    governed_layer_checks: readonly GovernedLayerCheck[] | null;
    /** Why a site carries no verdict, so the PDF can state it rather than leave a blank. */
    assessment_status: LuAssessmentStatus;
    assessment_artifact_id: string | null;
    restrictions: string[];
    rules: Array<{
      ruleId: string;
      chapter: string;
      title: string;
      risk: string;
      description: string;
      recommendation: string;
    }>;
    /**
     * W3a -- SEM-2/SEM-3 (Q2): present IFF `restrictions`/`rules` above actually came from the
     * legacy engine (i.e. either array is non-empty), so a caseworker never reads them as part of
     * the governed verdict above. Independent of `assessment_status`/`overallRisk`: a site can be
     * ungoverned and still carry a legacy observation, or governed and still carry one alongside it.
     */
    legacyObservationLabel?: string;
    warnings: string[];
    /** U20CDF (F4): the older observations, as their own block -- never flattened into site fields. */
    legacyObservations: LegacyPdfObservations;
  }>;
  legalBasis: string;
  reportWarnings: string[];
  humanInTheLoop: string;
}

type LegacyObservationsBlockInput = NonNullable<LocalizationReport['siteAnalyses'][number]['legacyObservations']>;

/**
 * U20CDF (F4): the block as a block. Availability comes from the block itself (per source); a
 * missing availability entry counts as NOT available -- a value is only ever shown for a source that
 * was actually read.
 */
function legacyPdfObservations(legacy: LegacyObservationsBlockInput): LegacyPdfObservations {
  const read = legacy.sourceAvailability as Partial<LegacyObservationsBlockInput['sourceAvailability']> | undefined;
  const statusSv = (available: boolean) => (available ? LEGACY_SOURCE_AVAILABLE_SV : LEGACY_SOURCE_UNAVAILABLE_SV);
  const protectedAvailable = legacy.protectedArea.available === true && typeof legacy.protectedArea.isProtected === 'boolean';
  const monumentsAvailable = read?.raa === true;
  const sluAvailable = read?.slu === true && typeof legacy.sluObservationCount === 'number';
  const vissAvailable = read?.viss === true;
  const waterAvailable = legacy.distanceToWater.available === true;
  return {
    governed: false,
    source: 'legacy_observation',
    version: 'v1',
    note_sv: legacy.note_sv,
    protectedArea: {
      available: protectedAvailable,
      status_sv: statusSv(protectedAvailable),
      isProtected: protectedAvailable ? legacy.protectedArea.isProtected : null,
      names: protectedAvailable ? legacy.protectedArea.hitNames.slice(0, 5) : [],
    },
    monuments: {
      available: monumentsAvailable,
      status_sv: statusSv(monumentsAvailable),
      count: monumentsAvailable ? legacy.monuments.length : null,
      names: monumentsAvailable ? legacy.monuments.slice(0, 5).map((m) => m.name) : [],
    },
    slu: {
      available: sluAvailable,
      status_sv: statusSv(sluAvailable),
      observationCount: sluAvailable ? legacy.sluObservationCount : null,
    },
    viss: {
      available: vissAvailable,
      status_sv: statusSv(vissAvailable),
      waterName: vissAvailable ? legacy.vissWaterStatus?.waterName ?? null : null,
      ecologicalStatus: vissAvailable ? legacy.vissWaterStatus?.ecologicalStatus ?? null : null,
      chemicalStatus: vissAvailable ? legacy.vissWaterStatus?.chemicalStatus ?? null : null,
    },
    distanceToWater: {
      available: waterAvailable,
      status_sv: statusSv(waterAvailable),
      meters: waterAvailable ? legacy.distanceToWater.meters : null,
    },
    dataSources: [...legacy.dataSources],
  };
}

/**
 * Transforms a LocalizationReport into a flat structure ready for PDF rendering.
 */
export function buildLocalizationPdfData(report: LocalizationReport): LocalizationPdfData {
  // P3-LU-CANONICAL-CHAIN-01 added three required summary fields. A report constructed against
  // the older shape reaches the spread below and fails as "undefined is not iterable", which
  // says nothing about what is actually wrong. Naming the violation costs one check and saves
  // the next person the same debugging session.
  if (
    !report.summary ||
    typeof report.summary.comparison_status !== 'string' ||
    !Array.isArray(report.summary.assessed_site_ids) ||
    !Array.isArray(report.summary.unassessed_site_ids)
  ) {
    throw new Error(
      'LocalizationReport.summary is missing the coverage fields required since ' +
        'P3-LU-CANONICAL-CHAIN-01 (comparison_status, assessed_site_ids, unassessed_site_ids). ' +
        'A summary without them cannot say how much of the candidate set was assessed, so the ' +
        'PDF cannot state whether a winner was drawn from all alternatives or a subset.',
    );
  }

  return {
    title: 'Lokaliseringsutredning – Jämförande platsanalys',
    generatedAt: report.generatedAt,
    projectId: report.projectId,
    disclaimer:
      'Human in the Loop: Detta dokument är AI-genererat beslutsstöd och ersätter inte ' +
      'juridisk eller teknisk expertbedömning. Alla rekommendationer ska granskas av ' +
      'behörig handläggare innan formellt beslut fattas.',
    governance_note_sv: LEGACY_PDF_GOVERNANCE_NOTE_SV,
    summary: {
      // Spread rather than assign: an absent winner must leave the key OFF the object, not
      // present-with-a-placeholder. `|| 'N/A'` previously manufactured a summary value.
      ...(report.summary.bestAlternativeId
        ? { bestAlternativeId: report.summary.bestAlternativeId }
        : {}),
      reasoning: report.summary.reasoning,
      comparison_status: report.summary.comparison_status,
      assessed_site_ids: [...report.summary.assessed_site_ids],
      unassessed_site_ids: [...report.summary.unassessed_site_ids],
    },
    sites: report.siteAnalyses.map((analysis) => {
      // U20-C: the older observations come only from their explicit, ungoverned block. This
      // projection is never built without them (both callers opt in); failing loudly beats
      // printing zero monuments / "not protected" for observations that were never read.
      const legacy = analysis.legacyObservations;
      if (!legacy) {
        throw new Error(
          'LEGACY_OBSERVATIONS_NOT_INCLUDED: buildLocalizationPdfData needs a report generated with ' +
            'includeLegacyObservations; it will not print absent observations as empty results.',
        );
      }
      return {
        id: analysis.site.id,
        name: analysis.site.name || 'Namnlöst alternativ',
        lat: analysis.site.lat,
        lng: analysis.site.lng,
        // Same rule as the report: verdict keys are omitted, never rendered as undefined or 0.
        // The narrowing is what makes the fields readable at all — LU_VERDICT_TYPE_BOUNDARY_V1
        // removes them from the non-verdict variant, so an undefined can no longer reach the
        // caseworker-facing document by way of a field this projection forgot to check.
        ...(isGovernedVerdict(analysis.complianceAnalysis)
          ? analysis.complianceAnalysis.permitProbability === null
            ? {
                overallRisk: analysis.complianceAnalysis.overallRisk,
                permitProbabilityStatus: 'NOT_CHECKED' as const,
                permitProbabilityText: 'kan inte anges',
                unresolvedChecks: analysis.complianceAnalysis.unresolvedChecks.map((c) => ({
                  ruleId: c.rule_id,
                  findingId: c.finding_id,
                })),
              }
            : {
                overallRisk: analysis.complianceAnalysis.overallRisk,
                permitProbability: analysis.complianceAnalysis.permitProbability,
              }
          : {}),
        // U20-C / OD-K0-1: the qualified statement travels with the verdict, never the bare level.
        ...(isGovernedVerdict(analysis.complianceAnalysis)
          ? {
              overall_statement_sv: analysis.complianceAnalysis.summary,
              ...(analysis.executionMotor?.governed_coverage_state
                ? { overall_coverage_state: analysis.executionMotor.governed_coverage_state }
                : {}),
            }
          : {}),
        governed_layer_checks: analysis.executionMotor?.governed_layer_checks ?? null,
        assessment_status: analysis.executionMotor?.assessment_status ?? 'NOT_ASSESSED',
        assessment_artifact_id: analysis.executionMotor?.assessment_artifact_id ?? null,
        restrictions: [...legacy.restrictions],
        rules: legacy.rules.map((rule) => ({
          ruleId: rule.ruleId,
          chapter: rule.chapter,
          title: rule.title,
          risk: rule.risk,
          description: rule.description,
          recommendation: rule.recommendation,
        })),
        ...(legacyObservationTag({ restrictions: [...legacy.restrictions], rules: legacy.rules }).legacyObservation
          ? { legacyObservationLabel: 'Observation från äldre regelmotor — ej del av den styrda bedömningen' }
          : {}),
        // Governed-path warnings first, then the (labelled, sanitized) legacy ones.
        warnings: [...analysis.warnings, ...legacy.warnings],
        legacyObservations: legacyPdfObservations(legacy),
      };
    }),
    legalBasis:
      'Denna rapport baseras på data från Naturvårdsregistret (NVR), SGU jordarts- och ' +
      'skredkartor, Riksantikvarieämbetets fornlämningsregister (FMIS/K-samsök), ' +
      'VISS (Vatteninformationssystem Sverige), SLU Artdata, och lokal PostGIS-databas med Lantmäteriet ' +
      'Topografisk webbkarta 10. Bedömningen avser Miljöbalken (1998:808) kap 2, 7, 9.',
    reportWarnings: report.warnings,
    humanInTheLoop: report.humanInTheLoop,
  };
}
