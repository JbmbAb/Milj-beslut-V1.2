import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { SecurityRuntime } from "../../mps-runtime/src/security/SecurityRuntime";
import {
  createGovernedLocalizationAssessment,
  GovernedAssessmentPersistence,
  localizationAssessmentCanonicalBody,
  orchestrator,
  type ISpatialProvider,
} from "../src/index";
import { GenerateLocalizationReportUseCase } from "../../../src/application/generate-localization-report.usecase";
import type { LocalizationSpatialRuntime } from "../../../server/modules/localization/createLocalizationSpatialRuntime";

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
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("HM1-C — governed assessment persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(orchestrator, "generateDocumentEvidence").mockResolvedValue([]);
  });

  it("the real entrypoint writes an assessment canonically bound to the execution outcome and its attestation", async () => {
    const repository = new RecordingRepository();
    const report = await new GenerateLocalizationReportUseCase(async () => runtime(repository)).execute({
      projectId: "project-hm1c",
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
