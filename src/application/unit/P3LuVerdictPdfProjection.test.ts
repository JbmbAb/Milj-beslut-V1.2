import { describe, it, expect } from "vitest";

import { buildLocalizationPdfData } from "../../../server/services/localizationPdfService";
import type {
  LocalizationReport,
  SiteAnalysisResult,
} from "../generate-localization-report.usecase";

/**
 * ✅ P3-LU-CANONICAL-CHAIN-01 — LU_VERDICT_AUTHORITY_V1 AT THE PDF PROJECTION.
 *
 *   Invariant under test:
 *     The PDF projection may not emit or expose an LU verdict for a site that has no governed
 *     LocalizationAssessmentArtifact, and may not manufacture a summary verdict when nothing
 *     was assessed.
 *
 *   The defect this closes: `buildLocalizationPdfData` declared `overallRisk: string` and
 *   `permitProbability: number` as REQUIRED and copied them straight off `complianceAnalysis`.
 *   Once the usecase began omitting those fields for unassessed sites, the PDF would have
 *   rendered `undefined` into a caseworker-facing document. `summary.bestAlternativeId` was
 *   worse: `|| 'N/A'` manufactured a summary value where none existed, so a report in which
 *   nothing could be assessed still produced a populated comparison section.
 *
 *   The type system now catches this too. LU_VERDICT_TYPE_BOUNDARY_V1 put the verdict fields on
 *   a distinct union variant and put this service into a TypeScript program
 *   (`tsconfig.lu-verdict.json`), so an unnarrowed read fails to compile — see
 *   `P3LuVerdictTypeBoundary.test.ts`. These runtime assertions stay: the compiler proves the
 *   shape is unreachable, not that this projection emits the right values when it is reachable.
 */

function site(
  id: string,
  verdict: { overallRisk: string; permitProbability: number } | null,
  motor: Partial<NonNullable<SiteAnalysisResult["executionMotor"]>> = {},
): SiteAnalysisResult {
  return {
    site: { id, name: `Alternativ ${id}`, lat: 59.3, lng: 18.0 },
    spatialAudit: { isProtected: false, protectedAreaHits: [] } as never,
    complianceAnalysis: {
      ...(verdict ?? {}),
      // LU_VERDICT_TYPE_BOUNDARY_V1 — the discriminant now lives on the analysis itself, and is
      // what makes the verdict fields readable. A fixture that set only
      // `executionMotor.assessment_status` would describe a shape the usecase cannot produce.
      assessment_status: verdict ? "ASSESSED" : "GOVERNANCE_DENIED",
      restrictions: [],
      rules: [],
      requiredActions: [],
      notes: [],
    } as never,
    monuments: [],
    vissWaterStatus: null,
    distanceToWaterMeters: null,
    dataSources: [],
    warnings: [],
    sluObservationCount: 0,
    executionMotor: {
      admitted: verdict !== null,
      reason_codes: verdict ? [] : ["CAPABILITY_DENIED"],
      attempt_id: null,
      outcome_id: null,
      manifest_id: null,
      ticket_id: null,
      finding_ids: [],
      assessment_artifact_id: verdict ? `artifact-${id}` : null,
      property_context_id: null,
      assessment_status: verdict ? "ASSESSED" : "GOVERNANCE_DENIED",
      ...motor,
    },
  } as SiteAnalysisResult;
}

function report(
  sites: SiteAnalysisResult[],
  summary: Partial<LocalizationReport["summary"]> = {},
): LocalizationReport {
  const assessed = sites.filter((s) => s.executionMotor?.assessment_artifact_id != null);
  const unassessed = sites.filter((s) => s.executionMotor?.assessment_artifact_id == null);
  return {
    projectId: "proj-1",
    generatedAt: "2026-08-14T00:00:00.000Z",
    siteAnalyses: sites,
    summary: {
      reasoning: "test",
      comparison_status:
        assessed.length === 0 ? "UNAVAILABLE" : unassessed.length === 0 ? "COMPLETE" : "PARTIAL",
      assessed_site_ids: assessed.map((s) => s.site.id),
      unassessed_site_ids: unassessed.map((s) => s.site.id),
      ...(assessed.length > 0 ? { bestAlternativeId: assessed[0].site.id } : {}),
      ...summary,
    },
    warnings: [],
    humanInTheLoop: "hitl",
  } as LocalizationReport;
}

describe("P3-LU-CANONICAL-CHAIN-01 — PDF projection", () => {
  // ------------------------------------------------------------------ PDF-1

  it("PDF-1: a non-assessed site carries no verdict fields", () => {
    const pdf = buildLocalizationPdfData(report([site("a", null)]));
    const s = pdf.sites[0];

    expect(Object.prototype.hasOwnProperty.call(s, "overallRisk")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(s, "permitProbability")).toBe(false);
    expect(s.assessment_status).toBe("GOVERNANCE_DENIED");
    expect(s.assessment_artifact_id).toBeNull();
    // The site is still present in the document — excluded from the verdict, not from the report.
    expect(s.id).toBe("a");
  });

  // ------------------------------------------------------------------ PDF-2

  it("PDF-2: an UNAVAILABLE comparison renders no best alternative and no placeholder", () => {
    const pdf = buildLocalizationPdfData(report([site("a", null), site("b", null)]));

    expect(pdf.summary.comparison_status).toBe("UNAVAILABLE");
    expect(
      Object.prototype.hasOwnProperty.call(pdf.summary, "bestAlternativeId"),
      "'N/A' rendered as though a comparison had been made and produced nothing.",
    ).toBe(false);
    expect(JSON.stringify(pdf.summary)).not.toMatch(/N\/A|undefined|null/);
    expect(pdf.summary.assessed_site_ids).toEqual([]);
  });

  // ------------------------------------------------------------------ PDF-3

  it("PDF-3: a PARTIAL comparison exposes only assessed sites as ranked", () => {
    const pdf = buildLocalizationPdfData(
      report([site("a", { overallRisk: "LOW", permitProbability: 0.8 }), site("b", null)]),
    );

    expect(pdf.summary.comparison_status).toBe("PARTIAL");
    expect(pdf.summary.assessed_site_ids).toEqual(["a"]);
    expect(pdf.summary.unassessed_site_ids).toEqual(["b"]);
    expect(pdf.summary.bestAlternativeId).toBe("a");

    const [a, b] = pdf.sites;
    expect(a.permitProbability).toBe(0.8);
    expect(Object.prototype.hasOwnProperty.call(b, "permitProbability")).toBe(false);
  });

  // ------------------------------------------------------------------ PDF-4

  it("PDF-4: a governed ASSESSED site still renders its legitimate verdict", () => {
    const pdf = buildLocalizationPdfData(
      report([site("a", { overallRisk: "HIGH", permitProbability: 0.25 })]),
    );
    const s = pdf.sites[0];

    expect(pdf.summary.comparison_status).toBe("COMPLETE");
    expect(s.overallRisk).toBe("HIGH");
    expect(s.permitProbability).toBe(0.25);
    expect(s.assessment_status).toBe("ASSESSED");
    expect(s.assessment_artifact_id).toBe("artifact-a");
  });

  // ------------------------------------------- no fake values anywhere in the projection

  it("no verdict-shaped placeholder survives serialization for an unassessed report", () => {
    const pdf = buildLocalizationPdfData(report([site("a", null), site("b", null)]));
    const serialized = JSON.stringify(pdf.sites);

    expect(serialized).not.toMatch(/"overallRisk"\s*:\s*(null|"")/);
    expect(serialized).not.toMatch(/"permitProbability"\s*:\s*(0|null)/);
  });
});
