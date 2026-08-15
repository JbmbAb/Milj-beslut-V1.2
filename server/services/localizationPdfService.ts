/**
 * localizationPdfService.ts
 *
 * PDF export for localization study reports.
 * Returns structured JSON suitable for PDF rendering by PDFKit, jsPDF, or similar.
 */

import type { LocalizationReport } from './localizationReportService';
import type {
  LuAssessmentStatus,
  LuComparisonStatus,
} from '../../src/application/generate-localization-report.usecase';

export interface LocalizationPdfData {
  title: string;
  generatedAt: string;
  projectId: string;
  disclaimer: string;
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
    permitProbability?: number;
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
    monumentCount: number;
    monumentNames: string[];
    warnings: string[];
    dataSources: Array<{ source: string; status: string; detail?: string }>;
    sluObservationCount: number;
    vissWaterName: string | null;
    vissEcologicalStatus: string | null;
    vissChemicalStatus: string | null;
    distanceToWaterMeters: number | null;
    isProtected: boolean;
    protectedAreaNames: string[];
  }>;
  legalBasis: string;
  reportWarnings: string[];
  humanInTheLoop: string;
}

/**
 * Transforms a LocalizationReport into a flat structure ready for PDF rendering.
 */
export function buildLocalizationPdfData(report: LocalizationReport): LocalizationPdfData {
  return {
    title: 'Lokaliseringsutredning – Jämförande platsanalys',
    generatedAt: report.generatedAt,
    projectId: report.projectId,
    disclaimer:
      'Human in the Loop: Detta dokument är AI-genererat beslutsstöd och ersätter inte ' +
      'juridisk eller teknisk expertbedömning. Alla rekommendationer ska granskas av ' +
      'behörig handläggare innan formellt beslut fattas.',
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
    sites: report.siteAnalyses.map((analysis) => ({
      id: analysis.site.id,
      name: analysis.site.name || 'Namnlöst alternativ',
      lat: analysis.site.lat,
      lng: analysis.site.lng,
      // Same rule as the report: verdict keys are omitted, never rendered as undefined or 0.
      ...(analysis.complianceAnalysis.overallRisk !== undefined
        ? { overallRisk: analysis.complianceAnalysis.overallRisk }
        : {}),
      ...(analysis.complianceAnalysis.permitProbability !== undefined
        ? { permitProbability: analysis.complianceAnalysis.permitProbability }
        : {}),
      assessment_status: analysis.executionMotor?.assessment_status ?? 'NOT_ASSESSED',
      assessment_artifact_id: analysis.executionMotor?.assessment_artifact_id ?? null,
      restrictions: analysis.complianceAnalysis.restrictions,
      rules: analysis.complianceAnalysis.rules.map((rule) => ({
        ruleId: rule.ruleId,
        chapter: rule.chapter,
        title: rule.title,
        risk: rule.risk,
        description: rule.description,
        recommendation: rule.recommendation,
      })),
      monumentCount: analysis.monuments.length,
      monumentNames: analysis.monuments.slice(0, 5).map((m) => m.name),
      warnings: analysis.warnings,
      dataSources: analysis.dataSources,
      sluObservationCount: analysis.sluObservationCount,
      vissWaterName: analysis.vissWaterStatus?.waterName ?? null,
      vissEcologicalStatus: analysis.vissWaterStatus?.ecologicalStatus ?? null,
      vissChemicalStatus: analysis.vissWaterStatus?.chemicalStatus ?? null,
      distanceToWaterMeters: analysis.distanceToWaterMeters,
      isProtected: analysis.spatialAudit.isProtected,
      protectedAreaNames: analysis.spatialAudit.protectedAreaHits
        .slice(0, 5)
        .map((hit) => hit.name || 'Namnlöst område'),
    })),
    legalBasis:
      'Denna rapport baseras på data från Naturvårdsregistret (NVR), SGU jordarts- och ' +
      'skredkartor, Riksantikvarieämbetets fornlämningsregister (FMIS/K-samsök), ' +
      'VISS (Vatteninformationssystem Sverige), SLU Artdata, och lokal PostGIS-databas med Lantmäteriet ' +
      'Topografisk webbkarta 10. Bedömningen avser Miljöbalken (1998:808) kap 2, 7, 9.',
    reportWarnings: report.warnings,
    humanInTheLoop: report.humanInTheLoop,
  };
}
