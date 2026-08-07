// packages/mps-data-governance/src/ImportGate.ts

import type {
  ImportGateRequest,
  ImportGateResult,
  ImportGateSignableEnvelope,
  ImportGateEvidenceArtifact,
  ImportGateEvidenceEnvelope,
} from "./ImportGateTypes";

import type {
  ContentReference,
  CanonicalHashEngine,
  Signer,
  Timestamp,
  ArtifactIdentityStrategy,
} from "../../mps-core/src/types";

import type { ArtifactRepository } from "../../mps-artifact-store/src/ArtifactRepository";

import {
  ArtifactIdentityBuilder,
  createSignedArtifactIdentity,
} from "../../mps-core/src/identity";

import { assertContentReferenceMatches } from "../../mps-core/src/references";
import { GovernanceIntegrityViolation } from "../../mps-core/src/errors";

export class ImportGate {
  private readonly builder: ArtifactIdentityBuilder;

  constructor(
    private readonly hashEngine: CanonicalHashEngine,
    private readonly signer: Signer,
    private readonly identityStrategy: ArtifactIdentityStrategy,
    private readonly repository: ArtifactRepository,
  ) {
    // Skapa en enkel deterministisk serializer på plats för att driva signeringen
    const serializer = {
      serialize: (obj: any) => JSON.stringify(obj, Object.keys(obj).sort())
    };
    this.builder = new ArtifactIdentityBuilder(
      serializer,
      this.hashEngine,
      this.signer,
      this.identityStrategy
    );
  }

  async evaluate(
    request: ImportGateRequest,
    evaluatedAt: Timestamp,
  ): Promise<ImportGateResult> {
    const { manifest_ref, approval_artifact, compliance_results } = request;

    const failedControls = compliance_results
      .filter((r) => r.result === "FAIL")
      .map((r) => r.control_id);

    if (!approval_artifact) {
      return this.record(
        "BLOCK_IMPORT",
        manifest_ref,
        null,
        ["IMPORT_GATE_MISSING_APPROVAL"],
        evaluatedAt,
      );
    }

    try {
      assertContentReferenceMatches(
        approval_artifact.approved_ref,
        manifest_ref,
        "IMPORT_GATE_APPROVAL_MANIFEST_MISMATCH",
        "DatasetApprovalArtifact.approved_ref does not match the manifest presented for import",
        GovernanceIntegrityViolation,
      );
    } catch (error) {
      if (error instanceof GovernanceIntegrityViolation) {
        return this.record(
          "BLOCK_IMPORT",
          manifest_ref,
          approval_artifact.approved_ref,
          ["IMPORT_GATE_APPROVAL_MANIFEST_MISMATCH"],
          evaluatedAt,
        );
      }
      throw error;
    }

    if (failedControls.length > 0) {
      return this.record(
        "BLOCK_IMPORT",
        manifest_ref,
        approval_artifact.approved_ref,
        failedControls,
        evaluatedAt,
      );
    }

    if (approval_artifact.decision !== "APPROVED") {
      return this.record(
        "BLOCK_IMPORT",
        manifest_ref,
        approval_artifact.approved_ref,
        ["IMPORT_GATE_DECISION_REJECTED"],
        evaluatedAt,
      );
    }

    return this.record(
      "ALLOW_IMPORT",
      manifest_ref,
      approval_artifact.approved_ref,
      [],
      evaluatedAt,
    );
  }

  private async record(
    decision: ImportGateEvidenceEnvelope["decision"],
    manifest_ref: ContentReference,
    approval_ref: ContentReference | null,
    failed_controls: readonly string[],
    evaluatedAt: Timestamp,
  ): Promise<ImportGateResult> {
    const envelope: ImportGateSignableEnvelope = {
      artifact_type: "IMPORT_GATE_EVIDENCE",
      decision,
      manifest_ref,
      approval_ref,
      failed_controls,
    };

    const signed = await createSignedArtifactIdentity(
      envelope,
      this.builder,
    );

    const artifact_id = this.identityStrategy.createArtifactId(
      signed.content_hash,
    );

    const artifact: ImportGateEvidenceArtifact = {
      ...signed,
      artifact_id,
      evaluated_at: evaluatedAt,
    };

    const stored = await this.repository.put(artifact);

    return {
      decision,
      manifest_ref,
      approval_ref,
      failed_controls,
      evaluated_at: evaluatedAt,
      evidence_ref: stored.reference,
    };
  }
}
