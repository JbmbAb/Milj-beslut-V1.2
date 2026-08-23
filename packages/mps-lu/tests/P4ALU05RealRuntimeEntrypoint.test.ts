import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";

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

vi.mock("../../../server/repositories/projectContextBindingRepository", () => {
  type BindingRow = {
    binding_artifact_id: string;
    project_context_artifact_id: string;
    project_context_artifact_type: string;
  };
  const bindingsByProject = new Map<string, BindingRow[]>();

  class FakeProjectContextBindingIndex {
    async register(binding: {
      artifact_id: string;
      payload: {
        project_id: string;
        project_context_ref: { artifact_id: string; artifact_type: string };
      };
    }) {
      const rows = bindingsByProject.get(binding.payload.project_id) ?? [];
      if (!rows.some((row) => row.binding_artifact_id === binding.artifact_id)) {
        rows.push({
          binding_artifact_id: binding.artifact_id,
          project_context_artifact_id: binding.payload.project_context_ref.artifact_id,
          project_context_artifact_type: binding.payload.project_context_ref.artifact_type,
        });
        bindingsByProject.set(binding.payload.project_id, rows);
      }
      const resolved = await this.resolve(binding.payload.project_id, binding.payload.project_context_ref);
      if (resolved !== binding.artifact_id) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CONFLICT");
    }

    async resolve(projectId: string, projectContextRef: { artifact_id: string; artifact_type: string }) {
      const rows = (bindingsByProject.get(projectId) ?? []).filter(
        (row) => row.project_context_artifact_id === projectContextRef.artifact_id
          && row.project_context_artifact_type === projectContextRef.artifact_type,
      );
      if (rows.length !== 1) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
      return rows[0]!.binding_artifact_id;
    }

    async listBindingRefs(projectId: string) {
      return (bindingsByProject.get(projectId) ?? []).map((row) => ({
        artifact_id: row.binding_artifact_id,
        artifact_type: "project_context_binding",
      }));
    }

    async listSupersessionRefs() {
      return [];
    }

    async findProjectContextRef(projectId: string) {
      const rows = bindingsByProject.get(projectId) ?? [];
      if (rows.length !== 1) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
      return {
        artifact_id: rows[0]!.project_context_artifact_id,
        artifact_type: rows[0]!.project_context_artifact_type,
      };
    }
  }

  return { PrismaProjectContextBindingIndex: FakeProjectContextBindingIndex };
});

import {
  LU_SPATIAL_CAPABILITY_KEY,
  LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID,
  SPATIAL_STACK_V1,
  SpatialProviderResolver,
  createLocalizationGeometryArtifactV2,
  createProjectContextBindingIssuerArtifact,
  deriveLuExecutionSeed,
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
import { issueExecutionIdentityV3 } from "../src/execution/LuExecutionIdentityIssuer";
import { LU_EXECUTION_PRINCIPAL_ID } from "../src/execution/LuExecutionKernelClient";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../src/registry/LuSiteAssessmentRegistry";
import { __resetLuExecutionAuthoritySigningProviderForTests } from "../../../server/security/luExecutionAuthoritySigningKey";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier";
import { provisionCanonicalLuContext } from "./fixtures/provisionCanonicalLuContext";
import { ensureLocalizationProjectionProject } from "./fixtures/ensureLocalizationProjectionProject";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

describe("P4A-LU-05 — real runtime entrypoint", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, "generateDocumentEvidence").mockResolvedValue([]);
  });

  afterEach(() => {
    for (const name of [
      "LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM",
      "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM",
      "PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID",
      "PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM",
      "PRODUCT_RELEASE_ARTIFACT_ID",
      "PRODUCT_RELEASE_HASH",
    ] as const) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("runs GenerateLocalizationReportUseCase through registry resolution, production provider, evidence, findings and assessment", async () => {
    // The real entrypoint now derives its execution subject from a verified current binding;
    // the fixture provisions that full canonical chain before issuing the matching V3 identity.
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate("ed25519:lu-execution-authority-v1");
    originalEnv.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    originalEnv.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;

    const contextIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:p4a-context-issuer");
    const contextIssuer = createProjectContextBindingIssuerArtifact({
      issuer_key_id: contextIssuerKey.provider.keyId,
      issuer_version: "project-context-binding-issuer-v2",
    });
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = contextIssuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = contextIssuerKey.publicKey;
    const releaseId = "product-release-p4a-lu-05";
    const releaseHash = "a".repeat(64);
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = releaseId;
    process.env.PRODUCT_RELEASE_HASH = releaseHash;

    const artifactRepository = new InMemoryArtifactRepository();
    const provider = new SpatialProviderPostGIS(
      "postgresql://unused-by-proof",
      artifactRepository,
    );
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("ST_Transform")) {
        // PRODUCT-LU-LOCALIZATION-GEOMETRY-01: sweref99ToWgs84 (the derived-geometry path) issues
        // the inverse transform, selecting AS lat/AS lng instead of AS n/AS e -- distinguish by
        // that column alias so both directions get a shape their caller can actually read.
        if (sql.includes("AS lat")) {
          return { rows: [{ lat: 59.33, lng: 18.07 }], rowCount: 1 };
        }
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
      sweref99ToWgs84: (northing, easting) => provider.sweref99ToWgs84(northing, easting),
      close: () => provider.close(),
    };
    const useCase = new GenerateLocalizationReportUseCase(async () => runtime);

    await artifactRepository.put({
      artifact_id: releaseId,
      content_hash: { algorithm: "sha256", value: "fixture-release" },
      body: {
        artifact_id: releaseId,
        artifact_type: "product_release_manifest",
        release_hash: { value: releaseHash },
      },
    });
    const projectId = "project-p4a-lu-05";
    await ensureLocalizationProjectionProject({
      projectId,
      propertyDesignation: "P4A LU 05 1:1",
    });
    const context = await provisionCanonicalLuContext({
      repository: artifactRepository,
      issuer: contextIssuer,
      signing: contextIssuerKey.provider,
      verification: new LocalPemVerificationKeyProvider(
        contextIssuerKey.provider.keyId,
        contextIssuerKey.publicKey,
      ),
      projectId,
      propertyDesignation: "P4A LU 05 1:1",
    });
    const luCapability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const geometry = createLocalizationGeometryArtifactV2({
      project_id: projectId,
      property_context_ref: context.propertyContextRef,
      wgs84LngLat: [18.07, 59.33],
      sweref99NorthingEasting: [6580000, 674000],
      provenance: "derived_from_property_boundary",
      label: "Fastighetens centrumpunkt (automatiskt härledd)",
      created_by: "system",
    });
    const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
    await issueExecutionIdentityV3({
      subject: {
        site_id: context.propertyIdentity,
        project_context_binding_ref: context.contextBindingRef,
        product_release_ref: { artifact_id: releaseId, artifact_type: "product_release_manifest" },
        execution_contract_version: "lu-execution-identity-v1",
        localization_geometry_ref: geometryRef,
      },
      deterministic_seed: deriveLuExecutionSeed({
        site_id: context.propertyIdentity,
        project_id: projectId,
        project_context_ref: context.projectContextRef,
        property_context_ref: context.propertyContextRef,
        project_context_binding_ref: context.contextBindingRef,
        product_release_ref: { artifact_id: releaseId, artifact_type: "product_release_manifest" },
        product_release_hash: releaseHash,
        execution_contract_version: "lu-execution-identity-v1",
        rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
        localization_geometry_ref: geometryRef,
      }),
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" },
      capability_ref: { artifact_id: luCapability.artifact_id, artifact_type: luCapability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: artifactRepository,
    });

    const report = await useCase.execute({
      projectId,
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
    expect(evidence).toHaveLength(5);
    const findingEvidenceIds = new Set(
      assessment.payload.findings.flatMap((finding) =>
        finding.evidence_refs.map((ref) => ref.artifact_id),
      ),
    );
    expect(findingEvidenceIds).toHaveLength(3);
    for (const artifact of evidence) {
      const layer = artifact.payload.layer_ref.layer_id;
      expect(artifact.payload.result_semantics.kind).toBe("EXISTENCE_WITHIN_DISTANCE");
      expect(artifact.payload.result_semantics.result.exists).toBe(true);
      expect(artifact.payload.operation.engine_fingerprint).toEqual(SPATIAL_STACK_V1);
      expect(artifact.payload.layer_ref.version_hash).toBe(
        SPATIAL_LAYER_REGISTRY[layer].version_hash,
      );
      expect(artifact.payload.geometry).toBeNull();
      if (["water", "ebh", "protected_area"].includes(layer)) {
        expect(findingEvidenceIds.has(artifact.artifact_id)).toBe(true);
      } else {
        expect(["natura2000", "water_protection_area"]).toContain(layer);
        expect(findingEvidenceIds.has(artifact.artifact_id)).toBe(false);
      }
    }
    expect(poolQuery.mock.calls.filter(([sql]) => String(sql).includes("ST_DWithin"))).toHaveLength(5);
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
    const sweref99ToWgs84 = vi.fn();
    const runtime: LocalizationSpatialRuntime = {
      artifactRepository,
      resolveSpatialProvider,
      wgs84ToSweref99,
      sweref99ToWgs84,
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
