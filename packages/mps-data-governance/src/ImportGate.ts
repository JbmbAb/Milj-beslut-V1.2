// packages/mps-data-governance/src/ImportGate.ts

import type {
  ImportGateRequest,
  ImportGateResult,
  ImportGateSignableEnvelope,
  ImportGateEvidenceArtifact,
  ImportGateEvidenceEnvelope,
  ImportGateEvidenceStore,
} from "./ImportGateTypes";

import type {
  ContentReference,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  Signer,
  Timestamp,
  ArtifactIdentityStrategy,
} from "../../mps-core/src/types";

import {
  ArtifactIdentityBuilder,
  createSignedArtifactIdentity,
} from "../../mps-core/src/identity";

import { assertContentReferenceMatches } from "../../mps-core/src/references";
import { GovernanceIntegrityViolation } from "../../mps-core/src/errors";

export class ImportGate {
  private readonly builder: ArtifactIdentityBuilder;

  /**
   * The serializer is injected rather than constructed here.
   *
   * It was previously built inline as
   * `JSON.stringify(obj, Object.keys(obj).sort())`, on the assumption that the
   * second argument sorts keys. It does not: it is a replacer allowlist,
   * applied recursively. Every nested object was reduced to the top-level key
   * names, so `manifest_ref` serialized as `{}` and the signed evidence was
   * blind to which manifest had been gated. Two imports of entirely different
   * datasets produced the same content hash. Canonicalization is a boundary
   * concern and belongs to whoever owns the hash domain, not to this gate.
   */
  constructor(
    serializer: CanonicalArtifactSerializer,
    hashEngine: CanonicalHashEngine,
    signer: Signer,
    identityStrategy: ArtifactIdentityStrategy,
    private readonly store: ImportGateEvidenceStore,
  ) {
    this.builder = new ArtifactIdentityBuilder(
      serializer,
      hashEngine,
      signer,
      identityStrategy,
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

    /**
     * A signed, matching, APPROVED artifact is still not authority to import.
     * Signing (createSignedArtifactIdentity) proves the artifact was not
     * tampered with after creation; it proves nothing about who was allowed to
     * create it. Only a GOVERNANCE_REVIEWER actor may authorize import — this
     * is checked defensively (optional chaining, not a thrown error) because
     * `approval_artifact` here may originate from an untyped store read
     * (e.g. FileCheckpointStore.loadApproval does a raw JSON.parse), so a
     * missing `actor_ref` or `role` at runtime must be treated as absent
     * authorization rather than crash the gate.
     */
    if (approval_artifact.actor_ref?.role !== "GOVERNANCE_REVIEWER") {
      return this.record(
        "BLOCK_IMPORT",
        manifest_ref,
        approval_artifact.approved_ref,
        ["IMPORT_GATE_UNAUTHORIZED_APPROVER_ROLE"],
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

    const artifact: ImportGateEvidenceArtifact = {
      ...signed,
      evaluated_at: evaluatedAt,
    };

    return {
      decision,
      manifest_ref,
      approval_ref,
      failed_controls,
      evaluated_at: evaluatedAt,
      evidence_ref: await this.store.put(artifact),
    };
  }
}
