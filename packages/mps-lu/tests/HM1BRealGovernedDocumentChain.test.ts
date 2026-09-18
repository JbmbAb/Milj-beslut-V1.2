import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPemSigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

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

import type {
  DocumentFactCandidateArtifact,
  VerifiedDocumentFactArtifact,
} from "../../mps-data-governance/src/DocumentFactArtifact";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { orchestrator, type DocumentEvidenceArtifact, type ISpatialProvider } from "../src/index";
import { GenerateLocalizationReportUseCase } from "../../../src/application/generate-localization-report.usecase";
import type { LocalizationSpatialRuntime } from "../../../server/modules/localization/createLocalizationSpatialRuntime";
import { buildVerifiedPriorDecisionFact, withFactRef } from "./fixtures/verifiedDocumentFact";
import { issueExecutionIdentity } from "../src/execution/LuExecutionIdentityIssuer";
import { LU_EXECUTION_PRINCIPAL_ID } from "../src/execution/LuExecutionKernelClient";
import { createLuRegistryRuntime } from "../src/registry/createLuRegistryRuntime";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../src/registry/LuSiteAssessmentRegistry";
import { __resetLuExecutionAuthoritySigningProviderForTests } from "../../../server/security/luExecutionAuthoritySigningKey";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier";

// PROD-LU-ADMISSION-02E: explicit authority-issued identity provisioned ahead of the run, via a
// separate call to issueExecutionIdentity -- see HM1CGovernedAssessmentPersistence.test.ts.
async function provisionExecutionIdentity(
  repository: InMemoryArtifactRepository,
  site_id: string,
): Promise<void> {
  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  await issueExecutionIdentity({
    site_id,
    deterministic_seed: `lu-seed-${site_id}`,
    actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" },
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    artifact_repository: repository,
  });
}

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
    query: vi.fn().mockResolvedValue([]),
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

describe("HM1-B — real governed document/fact chain", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, "generateDocumentEvidence").mockResolvedValue([]);
  });

  afterEach(() => {
    for (const name of ["LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM", "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM"] as const) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("does not admit V1 DocumentEvidence as new governed LU input", async () => {
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate("ed25519:lu-execution-authority-v1");
    originalEnv.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    originalEnv.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;

    const repository = new InMemoryArtifactRepository();
    const fact = buildVerifiedPriorDecisionFact("hm1b-positive");
    await seedVerifiedFact(repository, fact);
    const evidence = withFactRef(
      documentEvidence("doc-evidence-hm1b-positive", "Tidigare beslut", "prop-hm1b-positive"),
      fact,
    );
    await seedDocumentEvidence(repository, evidence);
    await provisionExecutionIdentity(repository, "hm1b-positive");
    const useCase = new GenerateLocalizationReportUseCase(
      async () => runtime(repository),
    );

    const report = await useCase.execute({
      projectId: "project-hm1b-positive",
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
    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    expect(report.siteAnalyses[0].documentEvidence ?? []).toEqual([]);
    const motor = report.siteAnalyses[0].executionMotor!;
    if (motor.assessment_artifact_id) {
      const assessment = await repository.resolve<{
        payload: { findings: readonly { rule_id: string }[] };
      }>({ artifact_id: motor.assessment_artifact_id, artifact_type: "LOCALIZATION_ASSESSMENT" });
      expect(assessment.payload.findings.map((item) => item.rule_id)).not.toContain("LU-DOC-BESLUT-001");
    }
  });

  it("does not create LU-DOC-BESLUT-001 when canonical text says avslag but no verified fact is referenced", async () => {
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate("ed25519:lu-execution-authority-v1");
    originalEnv.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    originalEnv.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = publicKey;

    const repository = new InMemoryArtifactRepository();
    const evidence = documentEvidence(
      "doc-evidence-hm1b-negative",
      "Beslut om avslag",
      "prop-hm1b-negative",
    );
    await seedDocumentEvidence(repository, evidence);
    await repository.put({
      artifact_id: "projection-doc-evidence-hm1b-negative",
      content_hash: { algorithm: "sha256", value: "projection-hash" },
      body: { artifact_type: "TEXT_PROJECTION", text: "Ansökan avslås. Avslag meddelas." },
    });
    await provisionExecutionIdentity(repository, "hm1b-negative");
    const useCase = new GenerateLocalizationReportUseCase(
      async () => runtime(repository),
    );

    const report = await useCase.execute({
      projectId: "project-hm1b-negative",
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
    if (motor.assessment_artifact_id) {
      const assessment = await repository.resolve<{ payload: { findings: readonly { rule_id: string }[] } }>({
        artifact_id: motor.assessment_artifact_id,
        artifact_type: "LOCALIZATION_ASSESSMENT",
      });
      expect(assessment.payload.findings.map((finding) => finding.rule_id)).not.toContain("LU-DOC-BESLUT-001");
    }
  });

    it("fails closed when a DocumentEvidence verified-fact reference would have been a candidate — V1 evidence is skipped instead of consumed", async () => {
    const repository = new InMemoryArtifactRepository();
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
        "prop-hm1b-candidate",
      ),
      verified,
    );
    await seedDocumentEvidence(repository, evidence);
    const useCase = new GenerateLocalizationReportUseCase(async () => runtime(repository));

    const report = await useCase.execute({
      projectId: "project-hm1b-candidate",
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

    expect(orchestrator.generateDocumentEvidence).not.toHaveBeenCalled();
    expect(report.siteAnalyses[0].warnings.join(" ")).not.toContain("REJECT_DOCUMENT_FACT");
  });
});
