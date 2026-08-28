import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../../../server/services/nvrService", () => ({ fetchProtectedAreas: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/raaService", () => ({ fetchAncientMonuments: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/vissService", () => ({
  queryVissPoint: vi.fn().mockResolvedValue({ ok: true, primaryWaterStatus: null }),
}));
vi.mock("../../../server/services/sguRiskService", () => ({ toGeologicalData: vi.fn().mockReturnValue({}) }));
vi.mock("../../../server/services/sluService", () => ({
  searchSluByCoordinates: vi.fn().mockResolvedValue([]),
  getSpeciesInformation: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../server/services/auditTrailService", () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
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
      payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } };
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
      if (
        (await this.resolve(binding.payload.project_id, binding.payload.project_context_ref)) !==
        binding.artifact_id
      ) {
        throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CONFLICT");
      }
    }
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = (bindingsByProject.get(projectId) ?? []).filter(
        (row) =>
          row.project_context_artifact_id === ref.artifact_id &&
          row.project_context_artifact_type === ref.artifact_type,
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

vi.mock("../../../server/repositories/localizationGeometryProjectionRepository", () => {
  type Row = {
    projectId: string;
    geometryArtifactId: string;
    propertyContextRefId: string;
    propertyContextRefType: string;
    createdAt: Date;
  };
  const rowsByProject = new Map<string, Row[]>();
  class FakeLocalizationGeometryProjectionIndex {
    async register(row: {
      projectId: string;
      geometryArtifactId: string;
      propertyContextRef: { artifact_id: string; artifact_type: string };
    }) {
      const rows = rowsByProject.get(row.projectId) ?? [];
      if (!rows.some((existing) => existing.geometryArtifactId === row.geometryArtifactId)) {
        rows.push({
          projectId: row.projectId,
          geometryArtifactId: row.geometryArtifactId,
          propertyContextRefId: row.propertyContextRef.artifact_id,
          propertyContextRefType: row.propertyContextRef.artifact_type,
          createdAt: new Date(),
        });
        rowsByProject.set(row.projectId, rows);
      }
    }
    async listForProject(projectId: string) {
      return rowsByProject.get(projectId) ?? [];
    }
  }
  return { PrismaLocalizationGeometryProjectionIndex: FakeLocalizationGeometryProjectionIndex };
});

vi.mock("../../../server/repositories/localizationGeometrySupersessionRepository", () => {
  class FakeLocalizationGeometrySupersessionIndex {
    async register() {
      return undefined;
    }
    async listForProject() {
      return [];
    }
  }
  return { PrismaLocalizationGeometrySupersessionIndex: FakeLocalizationGeometrySupersessionIndex };
});

vi.mock("../../../server/repositories/projectAssessmentProjectionRepository", () => {
  class FakeProjectAssessmentProjectionIndex {
    async register() {
      return undefined;
    }
    async listForProject() {
      return [];
    }
  }
  return { PrismaProjectAssessmentProjectionIndex: FakeProjectAssessmentProjectionIndex };
});

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import {
  createDocumentEvidenceArtifactV2,
} from "../src/artifacts/DocumentEvidenceArtifactV2";
import {
  createDocumentEvidencePropertyBindingArtifactV3,
} from "../src/artifacts/DocumentEvidencePropertyBindingArtifactV3";
import { createDocumentFactCandidate } from "../../mps-data-governance/src/createDocumentFactCandidate";
import { verifyRealDocumentFactCandidate } from "../../mps-data-governance/src/verifyRealDocumentFactCandidate";
import { createVerifiedDocumentFactV2 } from "../../mps-data-governance/src/VerifiedDocumentFactV2";
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from "../../mps-data-governance/src/DocumentFactArtifact";
import {
  createLocalizationGeometryArtifactV2,
  createProjectContextBindingIssuerArtifact,
  deriveLuExecutionSeed,
  orchestrator,
  type ISpatialProvider,
  type LocalizationAssessmentArtifact,
  type LUPropertyContextArtifact,
} from "../src/index";
import { GenerateLocalizationReportUseCase } from "../../../src/application/generate-localization-report.usecase";
import type { LocalizationSpatialRuntime } from "../../../server/modules/localization/createLocalizationSpatialRuntime";
import { issueExecutionIdentityV3 } from "../src/execution/LuExecutionIdentityIssuer";
import { LU_EXECUTION_PRINCIPAL_ID } from "../src/execution/LuExecutionKernelClient";
import { createLuRegistryRuntime } from "../src/registry/createLuRegistryRuntime";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../src/registry/LuSiteAssessmentRegistry";
import { __resetLuExecutionAuthoritySigningProviderForTests } from "../../../server/security/luExecutionAuthoritySigningKey";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier";
import { provisionCanonicalLuContext } from "./fixtures/provisionCanonicalLuContext";
import { createProductReleaseIssuerArtifact, createProductReleaseManifestArtifact } from "../../mps-governance/src/release/ProductReleaseAuthority";
import { attestProductRelease } from "../../../server/modules/release/productReleaseAuthority";
import { PrismaLocalizationGeometryProjectionIndex } from "../../../server/repositories/localizationGeometryProjectionRepository";
import {
  GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
  NO_GOVERNED_DOCUMENT_EVIDENCE_DETAIL,
} from "../../../src/application/resolveGovernedDocumentEvidenceForLuAssessment";
import type { AuthUser } from "../../../server/security/types";
import type { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";

const H = (ch: string): string => ch.repeat(64);
const LU_WORKSPACE_USER: AuthUser = {
  id: "user-cutover",
  organisationId: "org-cutover",
  bankidId: "bankid-cutover",
  role: "CONSULTANT",
};

class RecordingRepository extends InMemoryArtifactRepository {
  readonly writes: Array<{
    artifact_id: string;
    content_hash: { algorithm: "sha256"; value: string };
    body: unknown;
  }> = [];

  override async put(artifact: {
    artifact_id: string;
    content_hash: { algorithm: "sha256"; value: string };
    body: unknown;
  }): Promise<void> {
    this.writes.push(artifact);
    await super.put(artifact);
  }
}

function luWorkspaceGenerateReportBody(projectId: string) {
  return {
    projectId,
    siteAlternatives: [
      {
        id: "site-selected",
        name: "Vald punkt",
        lat: 59.33,
        lng: 18.07,
      },
    ],
    user: LU_WORKSPACE_USER,
  };
}

function runtime(
  repository: RecordingRepository,
  spatialQuery: ISpatialProvider["query"],
): LocalizationSpatialRuntime {
  const provider: ISpatialProvider = { query: spatialQuery };
  return {
    artifactRepository: repository,
    resolveSpatialProvider: () => provider,
    wgs84ToSweref99: vi.fn().mockResolvedValue([6580000, 674000]),
    sweref99ToWgs84: vi.fn().mockResolvedValue([59.33, 18.07]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function seedGovernedDocumentChain(
  repository: RecordingRepository,
  propertyContext: LUPropertyContextArtifact,
) {
  const contentRef = (id: string) => ({
    id,
    content_hash: { algorithm: "sha256" as const, digest: `hash-${id}` },
  });
  const signBytes = async (bytes: Uint8Array) => ({
    signatureBase64: Buffer.from(bytes).toString("base64").slice(0, 16),
  });
  const candidate = await createDocumentFactCandidate(
    {
      fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
      fact_version: "1.0",
      source_document_ref: contentRef("doc-cutover"),
      inventory_ref: contentRef("inv-cutover"),
      source_span: {
        text_projection_ref: contentRef("proj-cutover"),
        start_offset: 0,
        end_offset: 48,
      },
      asserted_by: { identity_ref: contentRef("extractor-cutover"), role: "SYSTEM_PROCESS" },
      assertion_method: "DETERMINISTIC_EXTRACTION",
      asserter_version: "cutover-extractor/v1",
      asserted_at: "2026-08-28T00:00:00.000Z",
    },
    { keyId: "ed25519:cutover-extractor", sign: signBytes },
  );
  const verifiedV1 = await verifyRealDocumentFactCandidate(
    {
      candidate,
      verified_by: { identity_ref: contentRef("reviewer-cutover"), role: "GOVERNANCE_REVIEWER" },
      verification_method: "HUMAN_REVIEW",
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
      verified_at: "2026-08-28T01:00:00.000Z",
    },
    { keyId: "ed25519:cutover-reviewer", sign: signBytes },
  );
  const fact = await createVerifiedDocumentFactV2(
    verifiedV1,
    {
      artifact_id: "document_fact_review_attestation-cutover",
      artifact_type: "DOCUMENT_FACT_REVIEW_ATTESTATION",
      content_hash: H("e"),
    },
    { keyId: "ed25519:cutover-reviewer", sign: signBytes },
  );
  const factRef = {
    artifact_id: fact.artifact_id,
    artifact_type: fact.artifact_type,
    content_hash: fact.content_hash.digest,
  };
  const evidence = createDocumentEvidenceArtifactV2({
    document_ref: {
      artifact_id: "raw-doc-cutover",
      artifact_type: "RAW_SOURCE",
      content_hash: H("a"),
    },
    verified_fact_refs: [factRef],
    source_metadata: { provider: "cutover-test", retrieved_at: "2026-08-28T00:00:00.000Z" },
  });
  const binding = createDocumentEvidencePropertyBindingArtifactV3({
    contract_version: "document-evidence-property-binding-v3",
    document_evidence_ref: {
      artifact_id: evidence.artifact_id,
      artifact_type: evidence.artifact_type,
      content_hash: evidence.content_hash.value,
    },
    verified_fact_refs: [factRef],
    property_ref: {
      artifact_id: propertyContext.artifact_id,
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: propertyContext.content_hash.value,
    },
    binding_authority: {
      identity_ref: {
        id: "reviewer-cutover",
        content_hash: { algorithm: "sha256", digest: H("c") },
      },
      role: "GOVERNANCE_REVIEWER",
    },
    justification_refs: [{ artifact_id: "justification-1", artifact_type: "GOVERNANCE_NOTE" }],
    review_attestation_ref: {
      artifact_id: "attestation-1",
      artifact_type: "DOCUMENT_PROPERTY_REVIEW_ATTESTATION",
      content_hash: H("d"),
    },
  });
  await repository.put({
    artifact_id: fact.artifact_id,
    content_hash: { algorithm: "sha256", value: fact.content_hash.digest },
    body: fact,
  });
  await repository.put({
    artifact_id: evidence.artifact_id,
    content_hash: evidence.content_hash,
    body: evidence,
  });
  await repository.put({
    artifact_id: binding.artifact_id,
    content_hash: binding.content_hash,
    body: binding,
  });
  return { evidence, binding, fact };
}

async function provisionProductPath(projectId: string) {
  const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(
    "ed25519:lu-execution-authority-v1",
  );
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;
  delete process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID;
  delete process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM;
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;

  const repository = new RecordingRepository();
  const contextIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:cutover-context-issuer");
  const contextIssuer = createProjectContextBindingIssuerArtifact({
    issuer_key_id: contextIssuerKey.provider.keyId,
    issuer_version: "project-context-binding-issuer-v2",
  });
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = contextIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = contextIssuerKey.publicKey;

  const releaseIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:product-release-issuer-cutover");
  const releaseIssuer = createProductReleaseIssuerArtifact(releaseIssuerKey.provider.keyId);
  await repository.put({
    artifact_id: releaseIssuer.artifact_id,
    content_hash: releaseIssuer.content_hash,
    body: releaseIssuer,
  });
  const unsignedRelease = createProductReleaseManifestArtifact({
    product_name: "Miljobeslut-cutover",
    package_lock_sha256: "a".repeat(64),
    package_manifest_sha256: "b".repeat(64),
    runtime_entrypoint_sha256: "c".repeat(64),
    issuer_ref: { artifact_id: releaseIssuer.artifact_id, artifact_type: releaseIssuer.artifact_type },
    issued_at: "2026-08-28T00:00:00.000Z",
  });
  const signedRelease = {
    ...unsignedRelease,
    attestation: await attestProductRelease({
      release: unsignedRelease,
      issuer: releaseIssuer,
      signing: releaseIssuerKey.provider,
    }),
  };
  process.env.PRODUCT_RELEASE_ARTIFACT_ID = signedRelease.artifact_id;
  process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = releaseIssuerKey.provider.keyId;
  process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = releaseIssuerKey.publicKey;
  await repository.put({
    artifact_id: signedRelease.artifact_id,
    content_hash: signedRelease.content_hash,
    body: signedRelease,
  });

  const context = await provisionCanonicalLuContext({
    repository,
    issuer: contextIssuer,
    signing: contextIssuerKey.provider,
    verification: new LocalPemVerificationKeyProvider(
      contextIssuerKey.provider.keyId,
      contextIssuerKey.publicKey,
    ),
    projectId,
    propertyDesignation: "CUTOVER 1:1",
  });
  const propertyContext = await repository.resolve<LUPropertyContextArtifact>(context.propertyContextRef);
  const geometry = createLocalizationGeometryArtifactV2({
    project_id: projectId,
    property_context_ref: context.propertyContextRef,
    wgs84LngLat: [18.07, 59.33],
    sweref99NorthingEasting: [6580000, 674000],
    provenance: "derived_from_property_boundary",
    label: "Fastighetens centrumpunkt (automatiskt härledd)",
    created_by: LU_WORKSPACE_USER.id,
  });
  await repository.put({
    artifact_id: geometry.artifact_id,
    content_hash: geometry.content_hash,
    body: geometry,
  });
  await new PrismaLocalizationGeometryProjectionIndex().register({
    projectId,
    geometryArtifactId: geometry.artifact_id,
    propertyContextRef: geometry.payload.property_context_ref,
  });

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
  await issueExecutionIdentityV3({
    subject: {
      site_id: context.propertyIdentity,
      project_context_binding_ref: context.contextBindingRef,
      product_release_ref: {
        artifact_id: signedRelease.artifact_id,
        artifact_type: "product_release_manifest",
      },
      execution_contract_version: "lu-execution-identity-v1",
      localization_geometry_ref: geometryRef,
    },
    deterministic_seed: deriveLuExecutionSeed({
      site_id: context.propertyIdentity,
      project_id: projectId,
      project_context_ref: context.projectContextRef,
      property_context_ref: context.propertyContextRef,
      project_context_binding_ref: context.contextBindingRef,
      product_release_ref: {
        artifact_id: signedRelease.artifact_id,
        artifact_type: "product_release_manifest",
      },
      product_release_hash: signedRelease.release_hash.value,
      execution_contract_version: "lu-execution-identity-v1",
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: geometryRef,
    }),
    actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" },
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    artifact_repository: repository,
  });

  const spatialQuery = vi.fn(async () => []);
  return { repository, propertyContext, spatialQuery, runtime: runtime(repository, spatialQuery) };
}

describe("GOVERNED-UI-LU-CUTOVER-01 — product generate-report path", () => {
  const originalEnv: Record<string, string | undefined> = {};
  const envNames = [
    "LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM",
    "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM",
    "LU_EXECUTION_AUTHORITY_ROOT_KEY_ID",
    "LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM",
    "PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID",
    "PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM",
    "PRODUCT_RELEASE_ARTIFACT_ID",
    "PRODUCT_RELEASE_ISSUER_KEY_ID",
    "PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM",
    "MPS_LU_BOOTSTRAP_ADMIT",
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, "generateDocumentEvidence").mockResolvedValue([]);
    for (const name of envNames) {
      originalEnv[name] = process.env[name];
    }
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  afterEach(() => {
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("LuWorkspace-shaped request without documentEvidenceRefs produces LU-DOC-BESLUT-001 on a real assessment", async () => {
    const projectId = "project-cutover-positive";
    const { repository, propertyContext, spatialQuery, runtime: spatialRuntime } =
      await provisionProductPath(projectId);
    const { evidence, fact } = await seedGovernedDocumentChain(repository, propertyContext);

    const request = luWorkspaceGenerateReportBody(projectId);
    expect(request.siteAlternatives[0]).not.toHaveProperty("documentEvidenceRefs");

    const report = await new GenerateLocalizationReportUseCase(async () => spatialRuntime).execute(request);

    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    expect(spatialQuery).toHaveBeenCalled();
    expect(fact.contract_version).toBe("verified-document-fact-v2");
    expect(report.siteAnalyses[0].documentEvidence?.map((item) => item.artifact_id)).toEqual([
      evidence.artifact_id,
    ]);
    expect(report.siteAnalyses[0].dataSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: GOVERNED_DOCUMENT_EVIDENCE_SOURCE, status: "ok" }),
      ]),
    );

    const motor = report.siteAnalyses[0].executionMotor!;
    expect(motor.assessment_status).toBe("ASSESSED");
    expect(motor.assessment_artifact_id).toMatch(/^assessment-/);
    expect(motor.findings.map((finding) => finding.rule_id)).toContain("LU-DOC-BESLUT-001");

    const assessment = await repository.resolve<LocalizationAssessmentArtifact>({
      artifact_id: motor.assessment_artifact_id!,
      artifact_type: "LOCALIZATION_ASSESSMENT",
    });
    expect(assessment.payload.findings.map((finding) => finding.rule_id)).toContain("LU-DOC-BESLUT-001");
    expect(assessment.payload.evidence_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact_id: evidence.artifact_id, artifact_type: "DOCUMENT_EVIDENCE" }),
        expect.objectContaining({ artifact_id: fact.artifact_id, artifact_type: "VERIFIED_DOCUMENT_FACT" }),
      ]),
    );
  });

  it("absence of governed document evidence is explicit coverage and does not mint V1", async () => {
    const projectId = "project-cutover-absence";
    const { repository, spatialQuery, runtime: spatialRuntime } = await provisionProductPath(projectId);

    const request = luWorkspaceGenerateReportBody(projectId);
    expect(request.siteAlternatives[0]).not.toHaveProperty("documentEvidenceRefs");

    const report = await new GenerateLocalizationReportUseCase(async () => spatialRuntime).execute(request);

    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    expect(spatialQuery).toHaveBeenCalled();
    expect(report.siteAnalyses[0].documentEvidence ?? []).toEqual([]);
    expect(report.siteAnalyses[0].dataSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
          status: "unavailable",
          detail: NO_GOVERNED_DOCUMENT_EVIDENCE_DETAIL,
        }),
      ]),
    );
    expect(repository.writes.some((write) => write.content_hash.value === "uncalculated")).toBe(false);
    expect(repository.writes.some((write) => /^doc_ev_\d+/.test(write.artifact_id))).toBe(false);
    const motor = report.siteAnalyses[0].executionMotor!;
    expect(motor.findings.map((finding) => finding.rule_id)).not.toContain("LU-DOC-BESLUT-001");
    expect(motor.assessment_artifact_id).toMatch(/^assessment-/);
  });

  it("historical V1 document evidence in CAS cannot enter a new governed assessment", async () => {
    const projectId = "project-cutover-v1";
    const { repository, propertyContext, runtime: spatialRuntime } = await provisionProductPath(projectId);
    const v1: DocumentEvidenceArtifact = {
      artifact_id: "doc_ev_v1_historical",
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "hash-v1-historical" },
      references: [{ artifact_id: propertyContext.artifact_id, artifact_type: "LU_PROPERTY_CONTEXT" }],
      payload: {
        property_ref: { artifact_id: propertyContext.artifact_id, artifact_type: "LU_PROPERTY_CONTEXT" },
        document_ref: { artifact_id: "legacy-doc", artifact_type: "EXTERNAL_DOCUMENT" },
        source_metadata: { provider: "legacy", retrieved_at: "2026-08-01T00:00:00.000Z" },
      },
    };
    await repository.put({
      artifact_id: v1.artifact_id,
      content_hash: v1.content_hash,
      body: v1,
    });

    const report = await new GenerateLocalizationReportUseCase(async () => spatialRuntime).execute(
      luWorkspaceGenerateReportBody(projectId),
    );

    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    expect(report.siteAnalyses[0].documentEvidence ?? []).toEqual([]);
    expect(report.siteAnalyses[0].dataSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
          status: "unavailable",
        }),
      ]),
    );
    const motor = report.siteAnalyses[0].executionMotor!;
    expect(motor.findings.map((finding) => finding.rule_id)).not.toContain("LU-DOC-BESLUT-001");
  });
});
