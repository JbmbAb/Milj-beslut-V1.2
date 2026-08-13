import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/services/spatialAuditService", () => ({
  runSpatialAudit: vi.fn().mockResolvedValue({
    protectedAreaHits: [],
    protectedAreaAvailable: true,
    isProtected: false,
    sgu: { riskLevel: "LOW", manualReviewRequired: false, summary: "OK" },
    insar: { riskLevel: "LOW" },
    distanceToWaterMeters: 50,
    distanceToWaterAvailable: true,
    text: "OK",
    sources: [],
  }),
}));

vi.mock("../../../server/services/complianceRuleEngine", () => ({
  evaluateComplianceRules: vi.fn().mockReturnValue({
    overallRisk: "LOW",
    permitProbability: 0.8,
    restrictions: [],
    rules: [],
    summary: "OK",
    violations: [],
    warnings: [],
    feasibilityScore: 80,
    recommendations: [],
    requiredActions: [],
    notes: [],
  }),
}));

vi.mock("../../../server/services/nvrService", () => ({
  fetchProtectedAreas: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../server/services/raaService", () => ({
  fetchAncientMonuments: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../server/services/vissService", () => ({
  queryVissPoint: vi.fn().mockResolvedValue({ ok: true, primaryWaterStatus: null }),
}));
vi.mock("../../../server/services/sguRiskService", () => ({
  toGeologicalData: vi.fn().mockReturnValue({}),
}));
vi.mock("../../../server/services/sluService", () => ({
  searchSluByCoordinates: vi.fn().mockResolvedValue([]),
  getSpeciesInformation: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../server/services/auditTrailService", () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/application/enqueue-lu-execution-ticket", () => ({
  enqueueAdmittedLuTicket: vi.fn().mockResolvedValue(null),
}));

import {
  LU_SPATIAL_CAPABILITY_KEY,
  LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID,
  SPATIAL_STACK_V1,
  SpatialProviderResolver,
  createLuRegistryRuntime,
  orchestrator,
  type SpatialEvidenceArtifact,
} from "../src/index";
import { SpatialProviderPostGIS } from "../../spatial-provider-postgis/src/SpatialProviderPostGIS";
import { SPATIAL_LAYER_REGISTRY } from "../../spatial-provider-postgis/src/SpatialLayerRegistry";
import {
  InMemoryArtifactRepository,
  type ArtifactRepositoryPort,
} from "../../mps-runtime/src/index";
import {
  GenerateLocalizationReportUseCase,
} from "../../../src/application/generate-localization-report.usecase";
import type { LocalizationSpatialRuntime } from "../../../server/modules/localization/createLocalizationSpatialRuntime";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

describe("P4A-LU-05 — real runtime entrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, "generateDocumentEvidence").mockResolvedValue([]);
  });

  it("runs GenerateLocalizationReportUseCase through registry resolution, production provider, evidence, findings and assessment", async () => {
    const artifactRepository = new InMemoryArtifactRepository();
    const provider = new SpatialProviderPostGIS(
      "postgresql://unused-by-proof",
      artifactRepository,
    );
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("ST_Transform")) {
        return { rows: [{ n: 6580000, e: 674000 }], rowCount: 1 };
      }
      if (sql.includes("ST_DWithin")) {
        return { rows: [{ hit: 1 }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in P4A-LU-05 proof: ${sql}`);
    });
    const poolEnd = vi.fn().mockResolvedValue(undefined);
    (provider as unknown as { pool: { query: typeof poolQuery; end: typeof poolEnd } }).pool = {
      query: poolQuery,
      end: poolEnd,
    };

    const registry = createLuRegistryRuntime();
    const registryResolve = vi.spyOn(registry, "resolveProviderByKey");
    const resolver = new SpatialProviderResolver({
      registry,
      providers: { [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: provider },
    });
    const resolveSpatialProvider = vi.spyOn(resolver, "resolve");
    const providerQuery = vi.spyOn(provider, "query");

    const runtime: LocalizationSpatialRuntime = {
      artifactRepository,
      resolveSpatialProvider: (capabilityKey) => resolver.resolve(capabilityKey),
      wgs84ToSweref99: (lat, lng) => provider.wgs84ToSweref99(lat, lng),
      close: () => provider.close(),
    };
    const useCase = new GenerateLocalizationReportUseCase(async () => runtime);

    const report = await useCase.execute({
      projectId: "project-p4a-lu-05",
      siteAlternatives: [{ id: "site-p4a-lu-05", lat: 59.33, lng: 18.07 }],
    });

    expect(resolveSpatialProvider).toHaveBeenCalledOnce();
    expect(resolveSpatialProvider).toHaveBeenCalledWith(LU_SPATIAL_CAPABILITY_KEY);
    expect(registryResolve).toHaveBeenCalledWith("lu.spatial.postgis");
    expect(provider).toBeInstanceOf(SpatialProviderPostGIS);
    expect(providerQuery).toHaveBeenCalledOnce();

    const analysis = report.siteAnalyses[0];
    expect(analysis.executionMotor?.admitted).toBe(true);
    expect(analysis.executionMotor?.finding_ids).toHaveLength(3);
    expect(analysis.executionMotor?.assessment_artifact_id).toBeTruthy();

    const assessment = await artifactRepository.resolve<{
      artifact_type: string;
      payload: {
        evidence_refs: readonly { artifact_id: string; artifact_type: string }[];
        findings: readonly {
          rule_id: string;
          evidence_refs: readonly { artifact_id: string; artifact_type: string }[];
        }[];
      };
    }>({
      artifact_id: analysis.executionMotor!.assessment_artifact_id!,
      artifact_type: "LOCALIZATION_ASSESSMENT",
    });
    expect(assessment.artifact_type).toBe("LOCALIZATION_ASSESSMENT");
    expect(assessment.payload.findings.map((finding) => finding.rule_id).sort()).toEqual([
      "LU-EBH-001",
      "LU-PROTECTED-001",
      "LU-WATER-001",
    ]);

    const evidence = await Promise.all(
      assessment.payload.evidence_refs.map((ref) =>
        artifactRepository.resolve<SpatialEvidenceArtifact>(ref),
      ),
    );
    expect(evidence).toHaveLength(3);
    for (const artifact of evidence) {
      const layer = artifact.payload.layer_ref.layer_id;
      expect(artifact.payload.result_semantics.kind).toBe("EXISTENCE_WITHIN_DISTANCE");
      expect(artifact.payload.result_semantics.result.exists).toBe(true);
      expect(artifact.payload.operation.engine_fingerprint).toEqual(SPATIAL_STACK_V1);
      expect(artifact.payload.layer_ref.version_hash).toBe(
        SPATIAL_LAYER_REGISTRY[layer].version_hash,
      );
      expect(artifact.payload.geometry).toBeNull();
      expect(
        assessment.payload.findings.some((finding) =>
          finding.evidence_refs.some((ref) => ref.artifact_id === artifact.artifact_id),
        ),
      ).toBe(true);
    }
    expect(poolQuery.mock.calls.filter(([sql]) => String(sql).includes("ST_DWithin"))).toHaveLength(3);
    expect(poolEnd).toHaveBeenCalledOnce();
  });

  it("keeps concrete PostGIS construction in the composition root and out of the application entrypoint", () => {
    const useCaseSource = readFileSync(
      path.join(repoRoot, "src/application/generate-localization-report.usecase.ts"),
      "utf8",
    );
    const compositionSource = readFileSync(
      path.join(repoRoot, "server/modules/localization/createLocalizationSpatialRuntime.ts"),
      "utf8",
    );

    expect(useCaseSource).not.toContain("@miljobeslut/spatial-provider-postgis");
    expect(useCaseSource).not.toMatch(/new\s+SpatialProviderPostGIS\s*\(/);
    expect(useCaseSource).toContain("resolveSpatialProvider(LU_SPATIAL_CAPABILITY_KEY)");
    expect(compositionSource).toContain("new SpatialProviderPostGIS");
    expect(compositionSource).toContain("new SpatialProviderResolver");
  });

  it("fails closed before provider execution when the runtime cannot resolve the canonical capability", async () => {
    const artifactRepository = new InMemoryArtifactRepository();
    const resolveSpatialProvider = vi.fn(() => {
      throw new Error("REJECT_SPATIAL_PROVIDER: missing canonical binding");
    });
    const wgs84ToSweref99 = vi.fn();
    const runtime: LocalizationSpatialRuntime = {
      artifactRepository,
      resolveSpatialProvider,
      wgs84ToSweref99,
      close: vi.fn().mockResolvedValue(undefined),
    };
    const useCase = new GenerateLocalizationReportUseCase(async () => runtime);

    const report = await useCase.execute({
      projectId: "project-p4a-lu-05-reject",
      siteAlternatives: [{ id: "site-reject", lat: 59.33, lng: 18.07 }],
    });

    expect(resolveSpatialProvider).toHaveBeenCalledWith(LU_SPATIAL_CAPABILITY_KEY);
    expect(wgs84ToSweref99).not.toHaveBeenCalled();
    expect(report.siteAnalyses[0].executionMotor).toMatchObject({
      admitted: false,
      reason_codes: ["EXECUTION_KERNEL_ERROR"],
      assessment_artifact_id: null,
    });
    expect(report.siteAnalyses[0].warnings.join(" ")).toContain(
      "REJECT_SPATIAL_PROVIDER: missing canonical binding",
    );
  });
});
