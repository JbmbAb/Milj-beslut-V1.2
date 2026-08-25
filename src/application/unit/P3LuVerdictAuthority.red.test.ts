import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 🔴 P3-LU-CANONICAL-CHAIN-01 — LU_VERDICT_AUTHORITY_V1 (RED PROOF).
 *
 *   Invariant under test:
 *     A production LU verdict is valid IFF it is bound to a governed
 *     LocalizationAssessmentArtifact produced by the admitted canonical path.
 *     Otherwise there is NO VERDICT — only an explicit non-verdict status.
 *
 *   Degraded STATUS is permitted. Degraded VERDICT is not.
 *
 *   The defect these tests pin: `generate-localization-report.usecase.ts` calls
 *   `runLuAssessmentViaKernel`, but treats its outcome as advisory. When the kernel denies
 *   admission (line ~645) or throws (line ~700) the usecase logs a warning, pushes a string
 *   onto `warnings`, and RETURNS ANYWAY — carrying `complianceAnalysis.overallRisk` and
 *   `permitProbability` computed by `evaluateComplianceRules` over ungoverned service data.
 *   The report then ranks alternatives by that probability and writes it to the audit trail.
 *
 *   Why the existing gates miss it:
 *     - `LuCutoverSinglePath.test.ts` proves the kernel is INVOKED and that no LU_MPS_MOTOR
 *       flag bypass remains. It does not prove the kernel's result is REQUIRED.
 *     - `P4ALU03NoAlternateSpatialPath.test.ts` scans only `packages/mps-lu/src` and guards
 *       SpatialEvidence production, not the assessment verdict. This file lives in `src/`.
 *
 *   ⚠️ THESE TESTS ARE EXPECTED TO FAIL until the usecase is made fail-closed for verdicts.
 *   That failure IS the proof. Do not weaken them to make the suite green.
 *
 *   Scope note: RED-3/RED-4 concern the LU verdict only. Sewage, mass-logistics and
 *   green-check surfaces carry their own `overallRisk`/`permitProbability` fields and are a
 *   separate governance question, deliberately untouched here.
 */

const kernelMock = vi.fn();
const complianceMock = vi.fn();
const auditLogMock = vi.fn(async () => undefined);

vi.mock("@miljobeslut/mps-lu", () => ({
  LU_SPATIAL_CAPABILITY_KEY: "lu.spatial",
  orchestrator: {
    resolveSpatialEvidence: vi.fn(async () => []),
    buildPropertyContext: vi.fn(async () => null),
  },
  runLuAssessmentViaKernel: (...args: unknown[]) => kernelMock(...args),
  // ASSESSMENT-RELEASE-BINDING-RECON-01: the usecase now calls the canonical wrapper (which
  // requires identity_subject_v3 at the type level) instead of the general engine directly --
  // same underlying call, so the mock must answer to both names.
  runCanonicalLuProductAssessment: (...args: unknown[]) => kernelMock(...args),
  deriveLuExecutionSeed: vi.fn(() => "canonical-seed"),
  createLuRegistryRuntime: vi.fn(() => ({
    getReleaseSnapshot: () => ({ snapshot_id: "lu-registry-snapshot-test" }),
  })),
}));

vi.mock("../../../server/services/complianceRuleEngine", () => ({
  evaluateComplianceRules: (...args: unknown[]) => complianceMock(...args),
}));

vi.mock("../../../server/services/spatialAuditService", () => ({
  runSpatialAudit: vi.fn(async () => ({
    protectedAreas: [],
    ebhObjects: [],
    floodRisk: null,
    sgu: { manualReviewRequired: false },
    distanceToWaterMeters: 500,
  })),
}));

vi.mock("../../../server/services/nvrService", () => ({
  fetchProtectedAreas: vi.fn(async () => []),
}));
vi.mock("../../../server/services/raaService", () => ({
  fetchAncientMonuments: vi.fn(async () => []),
}));
vi.mock("../../../server/services/vissService", () => ({
  queryVissPoint: vi.fn(async () => null),
}));
vi.mock("../../../server/services/sguRiskService", () => ({
  toGeologicalData: vi.fn(() => ({})),
}));
vi.mock("../../../server/services/sluService", () => ({
  searchSluByCoordinates: vi.fn(async () => []),
  getSpeciesInformation: vi.fn(async () => null),
}));
vi.mock("../../../server/services/auditTrailService", () => ({
  auditTrail: { logAction: (...args: unknown[]) => auditLogMock(...(args as [])) },
}));
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../enqueue-lu-execution-ticket", () => ({
  enqueueAdmittedLuTicket: vi.fn(async () => "ticket-1"),
}));
vi.mock("../../../server/modules/localization/createLocalizationSpatialRuntime", () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
}));
vi.mock("../resolveCanonicalProjectContext", () => ({
  resolveCanonicalProjectContext: vi.fn(async () => ({
    projectContextRef: { artifact_id: "project-context-1", artifact_type: "LU_PROJECT_CONTEXT" },
    propertyContextRef: { artifact_id: "property-context-1", artifact_type: "LU_PROPERTY_CONTEXT" },
    geometryRef: { artifact_id: "property-geometry-1", artifact_type: "geometry" },
    contextBindingRef: { artifact_id: "project-context-binding-1", artifact_type: "project_context_binding" },
    propertyIdentity: "property-1",
    coordinates: [6580000, 674000],
    geometry: { type: "Point", coordinates: [674000, 6580000] },
  })),
}));
vi.mock("../../../server/modules/release/productReleaseRuntime", () => ({
  resolveCanonicalProductRelease: vi.fn(async () => ({
    artifact_id: "product-release-1",
    artifact_type: "product_release_manifest",
    release_hash: { value: "a".repeat(64) },
  })),
}));
vi.mock("../../../server/modules/localization/localizationGeometryService", () => ({
  resolveOrDeriveCurrentLocalizationGeometry: vi.fn(async () => ({
    geometry: {
      artifact_id: "localization-geometry-1",
      artifact_type: "localization_geometry",
    },
  })),
}));

/** An ungoverned verdict — exactly what evaluateComplianceRules returns today. */
const UNGOVERNED_VERDICT = {
  overallRisk: "LOW" as const,
  permitProbability: 0.9,
  requiredActions: [] as string[],
  notes: [] as string[],
};

const SITE = { id: "site-a", name: "Alternativ A", lat: 59.33, lng: 18.06 };

/**
 * A complete LocalizationSpatialRuntime stub.
 *
 * Every member the usecase touches before the kernel call must exist, otherwise the run falls
 * into the catch block and the denial branch is never exercised — the tests would then pass
 * for the wrong reason.
 */
function spatialRuntimeStub() {
  return {
    artifactRepository: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      getByReference: vi.fn(async () => null),
    },
    resolveSpatialProvider: vi.fn(() => ({
      query: vi.fn(async () => []),
    })),
    wgs84ToSweref99: vi.fn(async () => [6580000, 674000] as const),
    close: vi.fn(async () => undefined),
  };
}

async function runReport(sites: { id: string; name?: string; lat: number; lng: number }[] = [SITE]) {
  const mod = await import("../generate-localization-report.usecase");
  const useCase = new mod.GenerateLocalizationReportUseCase(
    async () => spatialRuntimeStub() as never,
  );
  return useCase.execute({ projectId: "proj-1", siteAlternatives: sites });
}

const ASSESSED = (artifactId: string, findings: unknown[] = []) => ({
  admitted: true,
  reason_codes: [] as string[],
  attempt_id: "a1",
  outcome_id: "o1",
  manifest_id: "m1",
  findings,
  finding_ids: [] as string[],
  assessment: { artifact_id: artifactId },
});

const DENIED = {
  admitted: false,
  reason_codes: ["CAPABILITY_DENIED"],
  attempt_id: null,
  outcome_id: null,
  manifest_id: null,
  findings: [] as unknown[],
  finding_ids: [] as string[],
  assessment: null,
};

/** Routes each site to its own kernel outcome, keyed by the order sites are passed in. */
function kernelPerSite(outcomes: unknown[]) {
  let i = 0;
  kernelMock.mockImplementation(async () => outcomes[i++ % outcomes.length]);
}

/**
 * The contract, stated once.
 *
 * A site analysis either carries a governed assessment artifact AND may bear a verdict, or it
 * carries no artifact and MUST NOT bear one. There is no third state.
 */
function assertNoVerdictWithoutArtifact(analysis: any, context: string) {
  const artifactId = analysis.executionMotor?.assessment_artifact_id ?? null;
  if (artifactId !== null) return;

  const verdictFields = {
    overallRisk: analysis.complianceAnalysis?.overallRisk,
    permitProbability: analysis.complianceAnalysis?.permitProbability,
  };
  const present = Object.entries(verdictFields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);

  expect(
    present,
    `${context}: no LocalizationAssessmentArtifact was produced, so the result must carry NO ` +
      `verdict. Found verdict-bearing fields: ${present.join(", ")}. A verdict without a ` +
      `governed assessment is an alternate LU decision authority.`,
  ).toEqual([]);
}

describe("🔴 P3-LU-CANONICAL-CHAIN-01 — LU_VERDICT_AUTHORITY_V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    complianceMock.mockReturnValue({ ...UNGOVERNED_VERDICT });
  });

  // ------------------------------------------------------------------ RED-1

  it("RED-1: kernel DENIES admission → result must carry no verdict", async () => {
    kernelMock.mockResolvedValue({
      admitted: false,
      reason_codes: ["CAPABILITY_DENIED"],
      attempt_id: null,
      outcome_id: null,
      manifest_id: null,
      findings: [],
      finding_ids: [],
      assessment: null,
    });

    const report = await runReport();
    const analysis = report.siteAnalyses[0];

    expect(analysis.executionMotor?.admitted).toBe(false);
    assertNoVerdictWithoutArtifact(analysis, "RED-1 (admission denied)");
  });

  // ------------------------------------------------------------------ RED-2

  it("RED-2: kernel THROWS → result must carry no verdict", async () => {
    kernelMock.mockRejectedValue(new Error("kernel exploded"));

    const report = await runReport();
    const analysis = report.siteAnalyses[0];

    expect(analysis.executionMotor?.reason_codes).toContain("EXECUTION_KERNEL_ERROR");
    assertNoVerdictWithoutArtifact(analysis, "RED-2 (kernel threw)");
  });

  // ------------------------------------------------------------------ RED-3

  it("RED-3: an ungoverned compliance result cannot become the returned LU verdict", async () => {
    kernelMock.mockResolvedValue({
      admitted: false,
      reason_codes: ["NO_EVIDENCE"],
      attempt_id: null,
      outcome_id: null,
      manifest_id: null,
      findings: [],
      finding_ids: [],
      assessment: null,
    });
    // A deliberately distinctive ungoverned verdict, so we can prove it did NOT surface.
    complianceMock.mockReturnValue({
      overallRisk: "LOW",
      permitProbability: 0.97,
      requiredActions: [],
      notes: [],
    });

    const report = await runReport();
    const analysis = report.siteAnalyses[0];

    expect(
      analysis.complianceAnalysis?.permitProbability,
      "RED-3: 0.97 came from evaluateComplianceRules over ungoverned service data. It must not " +
        "reach the caller as an authoritative LU verdict when no governed assessment exists.",
    ).not.toBe(0.97);
  });

  // ------------------------------------------------------------------ RED-4

  it("RED-4: assessment_artifact_id === null AND verdict fields present is impossible", async () => {
    for (const kernel of [
      { admitted: false, reason_codes: ["DENIED"], findings: [], finding_ids: [], assessment: null,
        attempt_id: null, outcome_id: null, manifest_id: null },
      { admitted: true, reason_codes: [], findings: [], finding_ids: [], assessment: null,
        attempt_id: "a1", outcome_id: "o1", manifest_id: "m1" },
    ]) {
      kernelMock.mockResolvedValue(kernel);
      const report = await runReport();
      assertNoVerdictWithoutArtifact(
        report.siteAnalyses[0],
        `RED-4 (admitted=${kernel.admitted}, assessment=null)`,
      );
    }
  });

  // -------------------------------------------------- POSITIVE CONTROL (not vacuous)

  it("CONTROL: a governed assessment DOES permit a verdict", async () => {
    kernelMock.mockResolvedValue({
      admitted: true,
      reason_codes: [],
      attempt_id: "a1",
      outcome_id: "o1",
      manifest_id: "m1",
      findings: [],
      finding_ids: [],
      assessment: { artifact_id: "assessment-artifact-1" },
    });

    const report = await runReport();
    const analysis = report.siteAnalyses[0];

    expect(
      analysis.executionMotor?.assessment_artifact_id,
      "If this is null the other four tests pass vacuously — nothing would ever bear a verdict.",
    ).toBe("assessment-artifact-1");
    expect(analysis.complianceAnalysis?.overallRisk).toBeDefined();
  });

  it("derives an ASSESSED verdict only from governed findings, not live compliance inputs", async () => {
    const governedMediumFinding = {
      finding_id: "finding-governed-medium",
      rule_id: "LU-GOVERNED-001",
      rule_version: "1",
      explanation: "Governed medium finding",
      risk_level: "MEDIUM",
      evidence_refs: [],
    };
    complianceMock
      .mockReturnValueOnce({ overallRisk: "HIGH", permitProbability: 0.01, summary: "live verdict A", requiredActions: [], notes: [] })
      .mockReturnValueOnce({ overallRisk: "LOW", permitProbability: 0.99, summary: "live verdict B", requiredActions: [], notes: [] });
    kernelPerSite([
      ASSESSED("artifact-a", [governedMediumFinding]),
      ASSESSED("artifact-b", [governedMediumFinding]),
    ]);

    const report = await runReport([SITE, SITE_B]);

    for (const analysis of report.siteAnalyses) {
      expect(analysis.executionMotor?.assessment_status).toBe("ASSESSED");
      expect(analysis.complianceAnalysis.overallRisk).toBe("MEDIUM");
      expect(analysis.complianceAnalysis.permitProbability).toBe(0.5);
      expect(analysis.complianceAnalysis.summary).toBe("Governed LU assessment findings establish MEDIUM risk.");
    }
  });

  // ------------------------------------------- BLAST RADIUS: report-level comparison

  const SITE_B = { id: "site-b", name: "Alternativ B", lat: 59.34, lng: 18.07 };
  const SITE_C = { id: "site-c", name: "Alternativ C", lat: 59.35, lng: 18.08 };

  it("RED-5: an unassessed site cannot win bestAlternativeId", async () => {
    // The unassessed site is given the HIGHER ungoverned probability on purpose: if ranking
    // ever reads ungoverned values again, it would win and this test would catch it.
    complianceMock
      .mockReturnValueOnce({ overallRisk: "HIGH", permitProbability: 0.99, requiredActions: [], notes: [] })
      .mockReturnValueOnce({ overallRisk: "LOW", permitProbability: 0.40, requiredActions: [], notes: [] });
    kernelPerSite([DENIED, ASSESSED("artifact-b")]);

    const report = await runReport([SITE, SITE_B]);

    expect(report.summary.bestAlternativeId).toBe("site-b");
    expect(report.summary.unassessed_site_ids).toEqual(["site-a"]);
    expect(report.summary.assessed_site_ids).toEqual(["site-b"]);
  });

  it("RED-6: a PARTIAL report ranks assessed sites only and says so", async () => {
    complianceMock.mockReturnValue({ ...UNGOVERNED_VERDICT });
    kernelPerSite([ASSESSED("artifact-a"), DENIED, ASSESSED("artifact-c")]);

    const report = await runReport([SITE, SITE_B, SITE_C]);

    expect(report.summary.comparison_status).toBe("PARTIAL");
    expect(report.summary.assessed_site_ids.sort()).toEqual(["site-a", "site-c"]);
    expect(report.summary.unassessed_site_ids).toEqual(["site-b"]);
    expect(
      report.summary.reasoning,
      "A winner drawn from a subset must not read as best of all candidates.",
    ).toMatch(/partiell/i);
    // The unassessed site is still reported — excluded from ranking, not from the report.
    expect(report.siteAnalyses.map((a) => a.site.id)).toEqual(["site-a", "site-b", "site-c"]);
  });

  it("RED-7: zero governed assessments → no winner, UNAVAILABLE", async () => {
    complianceMock.mockReturnValue({ ...UNGOVERNED_VERDICT });
    kernelPerSite([DENIED, DENIED]);

    const report = await runReport([SITE, SITE_B]);

    expect(report.summary.bestAlternativeId).toBeUndefined();
    expect(report.summary.comparison_status).toBe("UNAVAILABLE");
    expect(report.summary.assessed_site_ids).toEqual([]);
  });

  it("RED-8: missing verdicts are never stringified as 0, undefined or a fallback", async () => {
    complianceMock.mockReturnValue({ ...UNGOVERNED_VERDICT });
    kernelPerSite([DENIED, DENIED]);

    const report = await runReport([SITE, SITE_B]);

    expect(report.summary.reasoning).not.toMatch(/undefined|NaN|null/);
    expect(
      report.summary.reasoning,
      "A 0% probability is a verdict — 'certainly refused' — not an absence of one.",
    ).not.toMatch(/\b0\s*%/);

    const details = auditLogMock.mock.calls.at(-1)?.[6]?.details ?? {};
    for (const forbidden of ["bestPermitProbability", "overallRisk", "bestAlternativeId"]) {
      expect(
        Object.prototype.hasOwnProperty.call(details, forbidden),
        `audit detail '${forbidden}' must be ABSENT when nothing was assessed — emitting it as ` +
          "null or 0 writes an unbacked verdict into the audit record.",
      ).toBe(false);
    }
    expect(details.comparison_status).toBe("UNAVAILABLE");
    expect(details.unassessed_sites).toHaveLength(2);
    for (const entry of details.unassessed_sites) {
      expect(entry.assessment_status).toBe("GOVERNANCE_DENIED");
      expect(Object.prototype.hasOwnProperty.call(entry, "permitProbability")).toBe(false);
    }
  });
});
