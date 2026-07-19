/**
 * localizationPdfService.ts
 *
 * PDF export for localization study reports.
 * Returns structured JSON suitable for PDF rendering by PDFKit, jsPDF, or similar.
 */

import type { LocalizationReport } from './localizationReportService';

export interface LocalizationPdfData {
  title: string;
  generatedAt: string;
  projectId: string;
  disclaimer: string;
  summary: {
    bestAlternativeId: string;
    reasoning: string;
  };
  sites: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    overallRisk: string;
    permitProbability: number;
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
      bestAlternativeId: report.summary.bestAlternativeId || 'N/A',
      reasoning: report.summary.reasoning,
    },
    sites: report.siteAnalyses.map((analysis) => ({
      id: analysis.site.id,
      name: analysis.site.name || 'Namnlöst alternativ',
      lat: analysis.site.lat,
      lng: analysis.site.lng,
      overallRisk: analysis.complianceAnalysis.overallRisk,
      permitProbability: analysis.complianceAnalysis.permitProbability,
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
