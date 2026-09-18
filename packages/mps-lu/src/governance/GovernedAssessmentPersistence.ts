export * from "./GovernedAssessmentPersistenceBase.js";

import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import { sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { FrozenExecutionOutcomeIdentity } from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { OutcomeAttestation } from "../../../mps-runtime/src/security/SecurityContracts.js";
import type { LocalizationAssessmentArtifact } from "../artifacts/LocalizationAssessmentArtifact.js";
import {
  GovernedAssessmentPersistence as GovernedAssessmentPersistenceBase,
  type AssessmentAuthorityBinding,
  type VerifyOutcomeAttestation,
} from "./GovernedAssessmentPersistenceBase.js";
import {
  LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
  assertLuExecutionAuthorityLifecycleCurrent,
  type LuExecutionAuthorityLifecycleArtifact,
} from "./LuExecutionAuthorityLifecycle.js";
import {
  LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
  type LuSourceAuthorityTemporalStatusArtifact,
} from "./LuSourceAuthorityTemporalStatus.js";

function sameRef(
  left: { readonly artifact_id: string; readonly artifact_type: string } | undefined,
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return left?.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function sameHash(
  left: { readonly algorithm: string; readonly value: string } | undefined,
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left?.algorithm === right.algorithm && left.value === right.value;
}

/**
 * F04 + 04E persistence hardening.
 *
 * The verifier proves the source chain, current root-signed issuer lifecycle and historical
 * exact-attempt ticket. This wrapper repeats the load-bearing CURRENT lifecycle predicate at the
 * actual mutation boundary, then rehashes and cross-binds decision/evidence/lifecycle/ticket to the
 * exact outcome attempt + execution identity before the base persistence layer can write to CAS.
 */
export class GovernedAssessmentPersistence {
  constructor(
    private readonly repository: ArtifactRepositoryPort,
    private readonly verifyAttestation: VerifyOutcomeAttestation,
    private readonly options: { readonly requireAuthorityEvidence?: boolean } = {},
  ) {}

  async persist(args: {
    readonly artifact: LocalizationAssessmentArtifact;
    readonly outcome: FrozenExecutionOutcomeIdentity;
    readonly attestation: OutcomeAttestation;
    readonly authority?: AssessmentAuthorityBinding;
  }): Promise<LocalizationAssessmentArtifact> {
    if (args.authority) {
      const { content_hash: declaredEvidenceHash, ...evidenceBody } = args.authority.evidence;
      const computedEvidenceHash = sha256ContentHash(evidenceBody);
      if (!sameHash(declaredEvidenceHash, computedEvidenceHash)) {
        throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_evidence_body_hash");
      }

      const decision = args.authority.decision;
      try {
        if (
          decision.authorized_at_decision_time === true &&
          !sameRef(args.outcome.attempt_ref, decision.attempt_ref)
        ) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_attempt_binding");
        }
        const attempt = await this.repository.resolve<{
          readonly manifest_ref: ArtifactReference;
        }>(args.outcome.attempt_ref);
        const manifest = await this.repository.resolve<{
          readonly execution_identity_ref: ArtifactReference;
        }>(attempt.manifest_ref);
        if (!sameRef(manifest.execution_identity_ref, decision.subject_ref)) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_execution_identity_binding");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("authority_attempt_binding") ||
            error.message.includes("authority_execution_identity_binding"))
        ) {
          throw error;
        }
        throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_execution_identity_binding");
      }

      if (decision.authorized_at_decision_time === true) {
        const evidence = args.authority.evidence;
        if (
          !evidence.decision_time ||
          evidence.decision_time !== decision.decision_time ||
          !sameRef(evidence.temporal_status_ref, decision.temporal_status_ref) ||
          !sameHash(evidence.temporal_status_hash, decision.temporal_status_hash)
        ) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_temporal_evidence_binding");
        }

        const lifecycleCandidates = args.authority.supporting_artifacts.filter(
          (artifact) => artifact.artifact_type === LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
        );
        if (lifecycleCandidates.length !== 1) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_lifecycle_cardinality");
        }
        const lifecycle = lifecycleCandidates[0] as LuExecutionAuthorityLifecycleArtifact;
        if (
          !sameRef(
            { artifact_id: lifecycle.artifact_id, artifact_type: lifecycle.artifact_type },
            decision.lifecycle_ref,
          ) ||
          !sameHash(lifecycle.content_hash, decision.lifecycle_hash)
        ) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_lifecycle_binding");
        }
        const {
          content_hash: declaredLifecycleHash,
          attestation: _lifecycleAttestation,
          ...lifecycleBody
        } = lifecycle;
        const computedLifecycleHash = sha256ContentHash(lifecycleBody);
        if (!sameHash(declaredLifecycleHash, computedLifecycleHash)) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_lifecycle_body_hash");
        }
        // Currentness is intentionally checked again at the actual write boundary.
        assertLuExecutionAuthorityLifecycleCurrent(lifecycle);

        const candidates = args.authority.supporting_artifacts.filter(
          (artifact) => artifact.artifact_type === LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
        );
        if (candidates.length !== 1) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_temporal_status_cardinality");
        }
        const status = candidates[0] as LuSourceAuthorityTemporalStatusArtifact;
        if (
          !sameRef(
            { artifact_id: status.artifact_id, artifact_type: status.artifact_type },
            decision.temporal_status_ref,
          ) ||
          !sameHash(status.content_hash, decision.temporal_status_hash) ||
          !sameRef(status.payload.attempt_ref, decision.attempt_ref) ||
          !sameRef(status.payload.lifecycle_ref, decision.lifecycle_ref) ||
          !sameHash(status.payload.lifecycle_hash, decision.lifecycle_hash) ||
          status.payload.decision_time !== decision.decision_time
        ) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_temporal_status_binding");
        }

        const {
          content_hash: declaredStatusHash,
          attestation: _statusAttestation,
          ...statusBody
        } = status;
        const computedStatusHash = sha256ContentHash(statusBody);
        if (!sameHash(declaredStatusHash, computedStatusHash)) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_temporal_status_body_hash");
        }
      }
    }

    return new GovernedAssessmentPersistenceBase(
      this.repository,
      this.verifyAttestation,
      this.options,
    ).persist(args);
  }
}
