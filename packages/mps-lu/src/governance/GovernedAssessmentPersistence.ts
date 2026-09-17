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

function sameRef(
  left: { readonly artifact_id: string; readonly artifact_type: string } | undefined,
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return left?.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function sameHash(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

/**
 * 04D-R1-F04 persistence hardening.
 *
 * The existing base implementation keeps every pre-F04 binding and write-order check intact.
 * This wrapper adds two checks that must happen before those writes:
 *
 * 1. Recompute the AuthorityEvidence hash from the actual caller-presented body, excluding only
 *    its declared content_hash. A legitimate WeakSet-approved decision therefore cannot be paired
 *    with a mutated evidence body carrying the old id/hash.
 * 2. Bind the verified authority subject to the exact execution that produced the outcome being
 *    persisted by resolving outcome -> attempt -> manifest -> execution_identity_ref.
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

      try {
        const attempt = await this.repository.resolve<{
          readonly manifest_ref: ArtifactReference;
        }>(args.outcome.attempt_ref);
        const manifest = await this.repository.resolve<{
          readonly execution_identity_ref: ArtifactReference;
        }>(attempt.manifest_ref);
        if (!sameRef(manifest.execution_identity_ref, args.authority.decision.subject_ref)) {
          throw new Error(
            "REJECT_LOCALIZATION_ASSESSMENT: authority_execution_identity_binding",
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("authority_execution_identity_binding")
        ) {
          throw error;
        }
        throw new Error(
          "REJECT_LOCALIZATION_ASSESSMENT: authority_execution_identity_binding",
        );
      }
    }

    return new GovernedAssessmentPersistenceBase(
      this.repository,
      this.verifyAttestation,
      this.options,
    ).persist(args);
  }
}
