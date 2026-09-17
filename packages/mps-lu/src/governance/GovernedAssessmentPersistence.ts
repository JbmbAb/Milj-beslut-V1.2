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
 * Before the base implementation performs any write, this wrapper rehashes the presented
 * AuthorityEvidence, binds it to the outcome's exact execution identity, and binds the 04E
 * positive authority decision to the exact persisted execution attempt. T_decision must equal
 * that attempt's immutable started_at; an authorization ticket for attempt A therefore cannot be
 * replayed as authority for attempt B, and an old logical decision instant cannot be attached to
 * a newly-created mutation.
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
      let persistedAttempt:
        | {
            readonly manifest_ref: ArtifactReference;
            readonly started_at: string;
          }
        | undefined;
      try {
        if (
          decision.authorized_at_decision_time === true &&
          !sameRef(args.outcome.attempt_ref, decision.attempt_ref)
        ) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_attempt_binding");
        }
        persistedAttempt = await this.repository.resolve<{
          readonly manifest_ref: ArtifactReference;
          readonly started_at: string;
        }>(args.outcome.attempt_ref);
        const manifest = await this.repository.resolve<{
          readonly execution_identity_ref: ArtifactReference;
        }>(persistedAttempt.manifest_ref);
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
        if (persistedAttempt.started_at !== decision.decision_time) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_decision_time_binding");
        }

        const evidence = args.authority.evidence;
        if (
          !evidence.decision_time ||
          evidence.decision_time !== decision.decision_time ||
          !sameRef(evidence.temporal_status_ref, decision.temporal_status_ref) ||
          !sameHash(evidence.temporal_status_hash, decision.temporal_status_hash)
        ) {
          throw new Error("REJECT_LOCALIZATION_ASSESSMENT: authority_temporal_evidence_binding");
        }

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
