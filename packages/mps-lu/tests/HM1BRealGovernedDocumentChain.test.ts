import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";

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
    restrictions: [], rules: [], summary: "OK", violations: [], warnings: [],
    feasibilityScore: 80, recommendations: [], requiredActions: [], notes: [],
  }),
}));
vi.mock("../../../server/services/nvrService", () => ({ fetchProtectedAreas: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/raaService", () => ({ fetchAncientMonuments: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../server/services/vissService", () => ({ queryVissPoint: vi.fn().mockResolvedValue({ ok: true, primaryWaterStatus: null }) }));
vi.mock("../../../server/services/sguRiskService", () => ({ toGeologicalData: vi.fn().mockReturnValue({}) }));
vi.mock("../../../server/services/sluService", () => ({
  searchSluByCoordinates: vi.fn().mockResolvedValue([]),
  getSpeciesInformation: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../server/services/auditTrailService", () => ({ auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../src/application/enqueue-lu-execution-ticket", () => ({ enqueueAdmittedLuTicket: vi.fn().mockResolvedValue(null) }));

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

    async listSupersessionRefs() { return []; }

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

import type {
  DocumentFactCandidateArtifact,
  VerifiedDocumentFactArtifact,
} from "../../mps-data-governance/src/DocumentFactArtifact";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import {
  createLocalizationGeometryArtifactV2,
  createProjectContextBindingIssuerArtifact,
  deriveLuExecutionSeed,
  createLuRegistryRuntime,
  orchestrator,
  type DocumentEvidenceArtifact,
  type ISpatialProvider,
} from "../src/index";
import { GenerateLocalizationReportUseCase } from "../../../src/application/generate-localization-report.usecase";
import type { LocalizationSpatialRuntime } from "../../../server/modules/localization/createLocalizationSpatialRuntime";
import { buildVerifiedPriorDecisionFact, withFactRef } from "./fixtures/verifiedDocumentFact";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../src/registry/LuSiteAssessmentRegistry";
import { __resetLuExecutionAuthoritySigningProviderForTests } from "../../../server/security/luExecutionAuthoritySigningKey";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier";
import { provisionCanonicalLuContext } from "./fixtures/provisionCanonicalLuContext";
import { ensureLocalizationProjectionProject } from "./fixtures/ensureLocalizationProjectionProject";
import { provisionLuSourceAuthorityFixture } from "./fixtures/provisionLuSourceAuthority";
import {
  createProductReleaseIssuerArtifact,
  createProductReleaseManifestArtifact,
} from "../../mps-governance/src/release/ProductReleaseAuthority";
import { attestProductRelease } from "../../../server/modules/release/productReleaseAuthority";

function documentEvidence(id: string, title: string, propertyId: string): DocumentEvidenceArtifact {
  return {
    artifact_id: id,
    artifact_type: "DOCUMENT_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `hash-${id}` },
    references: [{ artifact_id: propertyId, artifact_type: "LU_PROPERTY_CONTEXT" }],
    payload: {
      property_ref: { artifact_id: propertyId, artifact_type: "LU_PROPERTY_CONTEXT" },
      document_ref: { artifact_id: `document-${id}`, artifact_type: "EXTERNAL_DOCUMENT" },
      // P3-LU-DOCUMENT-CLASSIFICATION-01C — the legacy relevant_document is dropped rather
        // than given a fabricated classification_ref. The materializer no longer emits it, so a
        // fixture still carrying one would assert against a shape production cannot produce.
        source_document_title: title,
        text_projection_ref: { artifact_id: `projection-${id}`, artifact_type: "TEXT_PROJECTION" },
      source_metadata: { provider: "HM1-B proof", retrieved_at: "2026-08-13T12:00:00.000Z" },
    },
  } as DocumentEvidenceArtifact;
}

function runtime(repository: InMemoryArtifactRepository): LocalizationSpatialRuntime {
  const provider: ISpatialProvider = {
    // SEM-1/OD-03 (W2): query() now returns SpatialQueryOutcomeV2, not a bare evidence array.
    query: vi.fn().mockResolvedValue({ evidence: [], unavailable_layers: [] }),
  };
  return {
    artifactRepository: repository,
    resolveSpatialProvider: () => provider,
    wgs84ToSweref99: vi.fn().mockResolvedValue([6580000, 674000]),
    sweref99ToWgs84: vi.fn().mockResolvedValue([59.33, 18.07]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function seedVerifiedFact(
  repository: InMemoryArtifactRepository,
  fact: VerifiedDocumentFactArtifact,
): Promise<void> {
  await repository.put({
    artifact_id: fact.artifact_id,
    content_hash: { algorithm: "sha256", value: fact.content_hash.digest },
    body: fact,
  });
}

async function seedDocumentEvidence(
  repository: InMemoryArtifactRepository,
  evidence: DocumentEvidenceArtifact,
): Promise<void> {
  await repository.put({
    artifact_id: evidence.artifact_id,
    content_hash: evidence.content_hash,
    body: evidence,
  });
}

async function provisionCanonicalExecutionContext(args: {
  repository: InMemoryArtifactRepository;
  projectId: string;
  propertyDesignation: string;
  label: string;
}) {
  const contextIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:" + args.label + "-context-issuer");
  const contextIssuer = createProjectContextBindingIssuerArtifact({
    issuer_key_id: contextIssuerKey.provider.keyId,
    issuer_version: "project-context-binding-issuer-v2",
  });
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = contextIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = contextIssuerKey.publicKey;

  const releaseIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:" + args.label + "-release-issuer");
  const releaseIssuer = createProductReleaseIssuerArtifact(releaseIssuerKey.provider.keyId);
  await args.repository.put({
    artifact_id: releaseIssuer.artifact_id,
    content_hash: releaseIssuer.content_hash,
    body: releaseIssuer,
  });
  const unsignedRelease = createProductReleaseManifestArtifact({
    product_name: "Miljobeslut-" + args.label,
    package_lock_sha256: "a".repeat(64),
    package_manifest_sha256: "b".repeat(64),
    runtime_entrypoint_sha256: "c".repeat(64),
    issuer_ref: { artifact_id: releaseIssuer.artifact_id, artifact_type: releaseIssuer.artifact_type },
    issued_at: "2026-10-07T00:00:00.000Z",
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
  await args.repository.put({
    artifact_id: signedRelease.artifact_id,
    content_hash: signedRelease.content_hash,
    body: signedRelease,
  });

  await ensureLocalizationProjectionProject({
    projectId: args.projectId,
    propertyDesignation: args.propertyDesignation,
  });
  const context = await provisionCanonicalLuContext({
    repository: args.repository,
    issuer: contextIssuer,
    signing: contextIssuerKey.provider,
    verification: new LocalPemVerificationKeyProvider(
      contextIssuerKey.provider.keyId,
      contextIssuerKey.publicKey,
    ),
    projectId: args.projectId,
    propertyDesignation: args.propertyDesignation,
  });

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  const geometry = createLocalizationGeometryArtifactV2({
    project_id: args.projectId,
    property_context_ref: context.propertyContextRef,
    wgs84LngLat: [18.07, 59.33],
    sweref99NorthingEasting: [6580000, 674000],
    provenance: "derived_from_property_boundary",
    label: "Fastighetens centrumpunkt (automatiskt härledd)",
    created_by: "system",
  });
  const geometryRef = {
    artifact_id: geometry.artifact_id,
    artifact_type: geometry.artifact_type,
  } as const;
  const releaseRef = {
    artifact_id: signedRelease.artifact_id,
    artifact_type: "product_release_manifest",
  } as const;
  const subject = {
    site_id: context.propertyIdentity,
    project_context_binding_ref: context.contextBindingRef,
    product_release_ref: releaseRef,
    execution_contract_version: "lu-execution-identity-v1",
    localization_geometry_ref: geometryRef,
  } as const;
  const seed = deriveLuExecutionSeed({
    site_id: context.propertyIdentity,
    project_id: args.projectId,
    project_context_ref: context.projectContextRef,
    property_context_ref: context.propertyContextRef,
    project_context_binding_ref: context.contextBindingRef,
    product_release_ref: releaseRef,
    product_release_hash: signedRelease.release_hash.value,
    execution_contract_version: "lu-execution-identity-v1",
    rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    localization_geometry_ref: geometryRef,
  });
  const authority = await provisionLuSourceAuthorityFixture({
    repository: args.repository,
    subject,
    deterministic_seed: seed,
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    governed_references: [
      context.contextBindingRef,
      context.projectContextRef,
      context.propertyContextRef,
      releaseRef,
      geometryRef,
    ],
    label: args.label,
  });
  return { context, authority };
}

describe("HM1-B — real governed document/fact chain", () => {
  const originalEnv: Record<string, string | undefined> = {};
  let sourceAuthorityFixture: { restore(): void } | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, "generateDocumentEvidence").mockResolvedValue([]);
  });

  afterEach(() => {
    sourceAuthorityFixture?.restore();
    sourceAuthorityFixture = null;
    for (const name of [
      "PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID",
      "PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM",
      "PRODUCT_RELEASE_ARTIFACT_ID",
      "PRODUCT_RELEASE_ISSUER_KEY_ID",
      "PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM",
    ] as const) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("carries canonical DocumentEvidence and a resolved verified fact through the real entrypoint into the finding and assessment", async () => {

    const repository = new InMemoryArtifactRepository();
    const projectId = "project-hm1b-positive";
    const canonical = await provisionCanonicalExecutionContext({
      repository,
      projectId,
      propertyDesignation: "HM1B POSITIVE 1:1",
      label: "hm1b-positive",
    });
    sourceAuthorityFixture = canonical.authority;
    const fact = buildVerifiedPriorDecisionFact("hm1b-positive");
    await seedVerifiedFact(repository, fact);
    const evidence = withFactRef(
      documentEvidence(
        "doc-evidence-hm1b-positive",
        "Tidigare beslut",
        canonical.context.propertyContextRef.artifact_id,
      ),
      fact,
    );
    await seedDocumentEvidence(repository, evidence);
    const useCase = new GenerateLocalizationReportUseCase(
      async () => runtime(repository),
    );

    const report = await useCase.execute({
      projectId,
      siteAlternatives: [{
        id: "hm1b-positive",
        lat: 59.33,
        lng: 18.07,
        documentEvidenceRefs: [{
          artifact_id: evidence.artifact_id,
          artifact_type: "DOCUMENT_EVIDENCE",
        }],
      }],
    });
    const motor = report.siteAnalyses[0].executionMotor!;
    expect(motor.admitted).toBe(true);
    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    expect(report.siteAnalyses[0].documentEvidence?.map((item) => item.artifact_id)).toEqual([
      evidence.artifact_id,
    ]);

    const assessment = await repository.resolve<{
      payload: { findings: readonly { rule_id: string; evidence_refs: readonly { artifact_id: string }[] }[]; evidence_refs: readonly { artifact_id: string }[] };
    }>({ artifact_id: motor.assessment_artifact_id!, artifact_type: "LOCALIZATION_ASSESSMENT" });
    const finding = assessment.payload.findings.find((item) => item.rule_id === "LU-DOC-BESLUT-001");
    expect(finding).toBeDefined();
    expect(finding!.evidence_refs.map((ref) => ref.artifact_id)).toEqual([
      evidence.artifact_id,
      fact.artifact_id,
    ]);
    expect(assessment.payload.evidence_refs.map((ref) => ref.artifact_id)).toEqual([
      evidence.artifact_id,
      fact.artifact_id,
    ]);
  });

  it("does not create LU-DOC-BESLUT-001 when canonical text says avslag but no verified fact is referenced", async () => {

    const repository = new InMemoryArtifactRepository();
    const projectId = "project-hm1b-negative";
    const canonical = await provisionCanonicalExecutionContext({
      repository,
      projectId,
      propertyDesignation: "HM1B NEGATIVE 1:1",
      label: "hm1b-negative",
    });
    sourceAuthorityFixture = canonical.authority;
    const evidence = documentEvidence(
      "doc-evidence-hm1b-negative",
      "Beslut om avslag",
      canonical.context.propertyContextRef.artifact_id,
    );
    await seedDocumentEvidence(repository, evidence);
    await repository.put({
      artifact_id: "projection-doc-evidence-hm1b-negative",
      content_hash: { algorithm: "sha256", value: "projection-hash" },
      body: { artifact_type: "TEXT_PROJECTION", text: "Ansökan avslås. Avslag meddelas." },
    });
    const useCase = new GenerateLocalizationReportUseCase(
      async () => runtime(repository),
    );

    const report = await useCase.execute({
      projectId,
      siteAlternatives: [{
        id: "hm1b-negative",
        lat: 59.33,
        lng: 18.07,
        documentEvidenceRefs: [{
          artifact_id: evidence.artifact_id,
          artifact_type: "DOCUMENT_EVIDENCE",
        }],
      }],
    });
    const motor = report.siteAnalyses[0].executionMotor!;
    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    const assessment = await repository.resolve<{ payload: { findings: readonly { rule_id: string }[] } }>({
      artifact_id: motor.assessment_artifact_id!,
      artifact_type: "LOCALIZATION_ASSESSMENT",
    });
    expect(assessment.payload.findings.map((finding) => finding.rule_id)).not.toContain("LU-DOC-BESLUT-001");
  });

  it("fails closed when a DocumentEvidence verified-fact reference resolves to a candidate", async () => {
    const repository = new InMemoryArtifactRepository();
    const projectId = "project-hm1b-candidate";
    const canonical = await provisionCanonicalExecutionContext({
      repository,
      projectId,
      propertyDesignation: "HM1B CANDIDATE 1:1",
      label: "hm1b-candidate",
    });
    sourceAuthorityFixture = canonical.authority;
    const verified = buildVerifiedPriorDecisionFact("hm1b-candidate");
    const candidate: DocumentFactCandidateArtifact = {
      artifact_id: verified.artifact_id,
      artifact_type: "DOCUMENT_FACT_CANDIDATE",
      content_hash: verified.content_hash,
      signature: verified.signature,
      verification_status: "CANDIDATE",
      fact_type: verified.fact_type,
      fact_version: verified.fact_version,
      source_document_ref: verified.source_document_ref,
      inventory_ref: verified.inventory_ref,
      source_span: verified.source_span,
      subject_ref: verified.subject_ref,
      assertion: verified.assertion,
    };
    await repository.put({
      artifact_id: candidate.artifact_id,
      content_hash: { algorithm: "sha256", value: candidate.content_hash.digest },
      body: candidate,
    });
    const evidence = withFactRef(
      documentEvidence(
        "doc-evidence-hm1b-candidate",
        "Tidigare beslut",
        canonical.context.propertyContextRef.artifact_id,
      ),
      verified,
    );
    await seedDocumentEvidence(repository, evidence);
    const useCase = new GenerateLocalizationReportUseCase(async () => runtime(repository));

    const report = await useCase.execute({
      projectId,
      siteAlternatives: [{
        id: "hm1b-candidate",
        lat: 59.33,
        lng: 18.07,
        documentEvidenceRefs: [{
          artifact_id: evidence.artifact_id,
          artifact_type: "DOCUMENT_EVIDENCE",
        }],
      }],
    });

    expect(report.siteAnalyses[0].executionMotor).toMatchObject({
      admitted: false,
      reason_codes: ["EXECUTION_KERNEL_ERROR"],
      assessment_artifact_id: null,
    });
    expect(report.siteAnalyses[0].warnings.join(" ")).toContain("REJECT_DOCUMENT_FACT");
  });
});
