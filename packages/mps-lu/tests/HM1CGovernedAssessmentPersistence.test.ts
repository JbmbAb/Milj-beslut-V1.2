import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/services/spatialAuditService", () => ({ runSpatialAudit: vi.fn().mockResolvedValue({ protectedAreaHits: [], protectedAreaAvailable: true, isProtected: false, sgu: { riskLevel: "LOW", manualReviewRequired: false, summary: "OK" }, insar: { riskLevel: "LOW" }, distanceToWaterMeters: 50, distanceToWaterAvailable: true, text: "OK", sources: [] }) }));
vi.mock("../../../server/services/complianceRuleEngine", () => ({ evaluateComplianceRules: vi.fn().mockReturnValue({ overallRisk: "LOW", permitProbability: 0.8, restrictions: [], rules: [], summary: "OK", violations: [], warnings: [], feasibilityScore: 80, recommendations: [], requiredActions: [], notes: [] }) }));
vi.mock("../../../server/services/nvrService", () => ({ fetchProtectedAreas: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/raaService", () => ({ fetchAncientMonuments: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/vissService", () => ({ queryVissPoint: vi.fn().mockResolvedValue({ ok: true, primaryWaterStatus: null }) }));
vi.mock("../../../server/services/sguRiskService", () => ({ toGeologicalData: vi.fn().mockReturnValue({}) }));
vi.mock("../../../server/services/sluService", () => ({ searchSluByCoordinates: vi.fn().mockResolvedValue([]), getSpeciesInformation: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/auditTrailService", () => ({ auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../src/application/enqueue-lu-execution-ticket", () => ({ enqueueAdmittedLuTicket: vi.fn().mockResolvedValue(null) }));

vi.mock("../../../server/repositories/projectContextBindingRepository", () => {
  type BindingRow = { binding_artifact_id: string; project_context_artifact_id: string; project_context_artifact_type: string };
  const bindingsByProject = new Map<string, BindingRow[]>();
  class FakeProjectContextBindingIndex {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      const rows = bindingsByProject.get(binding.payload.project_id) ?? [];
      if (!rows.some((row) => row.binding_artifact_id === binding.artifact_id)) {
        rows.push({ binding_artifact_id: binding.artifact_id, project_context_artifact_id: binding.payload.project_context_ref.artifact_id, project_context_artifact_type: binding.payload.project_context_ref.artifact_type });
        bindingsByProject.set(binding.payload.project_id, rows);
      }
      if (await this.resolve(binding.payload.project_id, binding.payload.project_context_ref) !== binding.artifact_id) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CONFLICT");
    }
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = (bindingsByProject.get(projectId) ?? []).filter((row) => row.project_context_artifact_id === ref.artifact_id && row.project_context_artifact_type === ref.artifact_type);
      if (rows.length !== 1) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
      return rows[0]!.binding_artifact_id;
    }
    async listBindingRefs(projectId: string) { return (bindingsByProject.get(projectId) ?? []).map((row) => ({ artifact_id: row.binding_artifact_id, artifact_type: "project_context_binding" })); }
    async listSupersessionRefs() { return []; }
    async findProjectContextRef(projectId: string) {
      const rows = bindingsByProject.get(projectId) ?? [];
      if (rows.length !== 1) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
      return { artifact_id: rows[0]!.project_context_artifact_id, artifact_type: rows[0]!.project_context_artifact_type };
    }
  }
  return { PrismaProjectContextBindingIndex: FakeProjectContextBindingIndex };
});

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { SecurityRuntime } from "../../mps-runtime/src/security/SecurityRuntime";
import {
  createGovernedLocalizationAssessment,
  createLocalizationGeometryArtifact,
  createProjectContextBindingIssuerArtifact,
  deriveLuExecutionSeed,
  GovernedAssessmentPersistence,
  localizationAssessmentCanonicalBody,
  orchestrator,
  type ISpatialProvider,
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

class RecordingRepository extends InMemoryArtifactRepository {
  readonly writes: Array<{ artifact_id: string; content_hash: { algorithm: "sha256"; value: string }; body: unknown }> = [];

  override async put(artifact: { artifact_id: string; content_hash: { algorithm: "sha256"; value: string }; body: unknown }): Promise<void> {
    this.writes.push(artifact);
    await super.put(artifact);
  }
}

function runtime(repository: RecordingRepository): LocalizationSpatialRuntime {
  const provider: ISpatialProvider = { query: vi.fn().mockResolvedValue([]) };
  return {
    artifactRepository: repository,
    resolveSpatialProvider: () => provider,
    wgs84ToSweref99: vi.fn().mockResolvedValue([6580000, 674000]),
    sweref99ToWgs84: vi.fn().mockResolvedValue([59.33, 18.07]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("HM1-C — governed assessment persistence", () => {
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

  it("the real entrypoint writes an assessment canonically bound to the execution outcome and its attestation", async () => {
    // The real entrypoint derives its execution subject from a verified current binding. This
    // fixture provisions that chain before issuing the matching V3 identity.
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate("ed25519:lu-execution-authority-v1");
    originalEnv.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    originalEnv.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;

    const repository = new RecordingRepository();
    const contextIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:hm1c-context-issuer");
    const contextIssuer = createProjectContextBindingIssuerArtifact({
      issuer_key_id: contextIssuerKey.provider.keyId,
      issuer_version: "project-context-binding-issuer-v2",
    });
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = contextIssuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = contextIssuerKey.publicKey;
    const releaseId = "product-release-hm1c";
    const releaseHash = "b".repeat(64);
    process.env.PRODUCT_RELEASE_ARTIFACT_ID = releaseId;
    process.env.PRODUCT_RELEASE_HASH = releaseHash;
    await repository.put({
      artifact_id: releaseId,
      content_hash: { algorithm: "sha256", value: "fixture-release" },
      body: { artifact_id: releaseId, artifact_type: "product_release_manifest", release_hash: { value: releaseHash } },
    });
    const projectId = "project-hm1c";
    const context = await provisionCanonicalLuContext({
      repository,
      issuer: contextIssuer,
      signing: contextIssuerKey.provider,
      verification: new LocalPemVerificationKeyProvider(contextIssuerKey.provider.keyId, contextIssuerKey.publicKey),
      projectId,
      propertyDesignation: "HM1C 1:1",
    });
    const registry = createLuRegistryRuntime();
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const geometry = createLocalizationGeometryArtifact({
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
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      artifact_repository: repository,
    });

    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repository)).execute({
      projectId,
      siteAlternatives: [{ id: "hm1c", lat: 59.33, lng: 18.07 }],
    });
    const id = report.siteAnalyses[0].executionMotor!.assessment_artifact_id!;
    const write = repository.writes.find((item) => item.artifact_id === id)!;
    const body = write.body as {
      artifact_id: string;
      artifact_type: string;
      content_hash: { algorithm: "sha256"; value: string };
      references: readonly { artifact_id: string; artifact_type: string }[];
      payload: {
        execution_outcome_ref?: { artifact_id: string; artifact_type: string };
        outcome_attestation_ref?: { artifact_id: string; artifact_type: string };
      };
    };

    expect(body.payload.execution_outcome_ref?.artifact_id).toBe(
      report.siteAnalyses[0].executionMotor!.outcome_id,
    );
    expect(body.payload.outcome_attestation_ref?.artifact_type).toBe("outcome_attestation");
    expect(body.references).toEqual(expect.arrayContaining([
      body.payload.execution_outcome_ref,
      body.payload.outcome_attestation_ref,
    ]));
    expect(body.content_hash).toEqual(sha256ContentHash(
      localizationAssessmentCanonicalBody(body as never),
    ));
  });

  it("rejects a spoofed body that retains the originally declared hash before any assessment write", async () => {
    const repository = new RecordingRepository();
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: "hm1c-spoof" });
    security.bindPrincipal("lu.site_assessment.actor");
    const outcome = {
      outcome_id: "outcome-hm1c-spoof",
      artifact_type: "execution_outcome" as const,
      attempt_ref: { artifact_id: "attempt-hm1c-spoof", artifact_type: "execution_attempt" },
      result: "success" as const,
      content_hash: sha256ContentHash({ result: "success", id: "hm1c-spoof" }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const artifact = createGovernedLocalizationAssessment({
      draft: {
        site_id: "hm1c-spoof",
        project_context_ref: { artifact_id: "project-hm1c", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "property-hm1c", artifact_type: "LU_PROPERTY_CONTEXT" },
        evidence_refs: [],
        system_summary: "original",
      },
      findings: [],
      outcome,
      attestation,
    });
    const spoofed = {
      ...artifact,
      payload: { ...artifact.payload, system_summary: "tampered but hash retained" },
    };
    const gate = new GovernedAssessmentPersistence(
      repository,
      (candidate) => security.verifyAttestation(candidate),
    );

    await expect(gate.persist({ artifact: spoofed, outcome, attestation })).rejects.toThrow(
      /REJECT_LOCALIZATION_ASSESSMENT: canonical_body_hash/,
    );
    expect(repository.writes).toHaveLength(0);
  });

  it("rejects an invalid outcome attestation before any assessment write", async () => {
    const repository = new RecordingRepository();
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: "hm1c-attestation" });
    security.bindPrincipal("lu.site_assessment.actor");
    const outcome = {
      outcome_id: "outcome-hm1c-attestation",
      artifact_type: "execution_outcome" as const,
      attempt_ref: { artifact_id: "attempt-hm1c-attestation", artifact_type: "execution_attempt" },
      result: "success" as const,
      content_hash: sha256ContentHash({ result: "success", id: "hm1c-attestation" }),
    };
    const valid = security.attestOutcome(outcome.content_hash);
    const invalid = { ...valid, signature: `${valid.signature}00` };
    const artifact = createGovernedLocalizationAssessment({
      draft: {
        site_id: "hm1c-attestation",
        project_context_ref: { artifact_id: "project-hm1c", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "property-hm1c", artifact_type: "LU_PROPERTY_CONTEXT" },
        evidence_refs: [],
        system_summary: "attested assessment",
      },
      findings: [],
      outcome,
      attestation: invalid,
    });
    const gate = new GovernedAssessmentPersistence(
      repository,
      (candidate) => security.verifyAttestation(candidate),
    );

    await expect(gate.persist({ artifact, outcome, attestation: invalid })).rejects.toThrow(
      /attestation_signature/,
    );
    expect(repository.writes).toHaveLength(0);
  });

  it("rejects a caller-chosen assessment id even when the canonical body hash is correct", async () => {
    const repository = new RecordingRepository();
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: "hm1c-id" });
    security.bindPrincipal("lu.site_assessment.actor");
    const outcome = {
      outcome_id: "outcome-hm1c-id",
      artifact_type: "execution_outcome" as const,
      attempt_ref: { artifact_id: "attempt-hm1c-id", artifact_type: "execution_attempt" },
      result: "success" as const,
      content_hash: sha256ContentHash({ result: "success", id: "hm1c-id" }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const valid = createGovernedLocalizationAssessment({
      draft: {
        site_id: "hm1c-id",
        project_context_ref: { artifact_id: "project-hm1c", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "property-hm1c", artifact_type: "LU_PROPERTY_CONTEXT" },
        evidence_refs: [],
        system_summary: "canonical id",
      },
      findings: [],
      outcome,
      attestation,
    });
    const callerChosenId = { ...valid, artifact_id: "assessment-caller-chosen" };
    const gate = new GovernedAssessmentPersistence(
      repository,
      (candidate) => security.verifyAttestation(candidate),
    );

    await expect(
      gate.persist({ artifact: callerChosenId, outcome, attestation }),
    ).rejects.toThrow(/canonical_artifact_id/);
    expect(repository.writes).toHaveLength(0);
  });
});
