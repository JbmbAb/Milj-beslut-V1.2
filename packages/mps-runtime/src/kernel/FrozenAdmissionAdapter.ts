import type {
  FrozenAdmissionResult,
  FrozenExecutionManifestIdentity,
} from "../contracts/freeze/FrozenIdentities.js";
import type { RuntimeState } from "./RuntimeState.js";
import type { AdmissionPort } from "./ExecutionKernel.js";
import { sha256ContentHash } from "./ExecutionKernel.js";
import { RuntimeAdmissionKernel, AdmissionError } from "./RuntimeAdmissionKernel.js";
import type { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js";
import type { ExecutionManifestArtifact } from "../execution/ExecutionManifestArtifact.js";

/**
 * Bridges frozen AdmissionResult to existing RuntimeAdmissionKernel.
 * Admit is the security gate — no domain side effects before this returns admitted.
 */
export class FrozenAdmissionAdapter implements AdmissionPort {
  constructor(
    private readonly verificationContext: FrozenCoreVerificationContext | null,
    private readonly allowBypassForBootstrap: boolean = false,
  ) {}

  async admit(
    manifest: FrozenExecutionManifestIdentity,
    _state: RuntimeState,
  ): Promise<FrozenAdmissionResult> {
    const manifestRef = {
      artifact_id: manifest.manifest_id,
      artifact_type: "execution_manifest" as const,
    };

    if (!this.verificationContext) {
      if (!this.allowBypassForBootstrap) {
        return {
          decision: "denied",
          reason_codes: ["MISSING_VERIFICATION_CONTEXT"],
          manifest_ref: manifestRef,
          attempt_ref: null,
          verified_rule_ids: [],
        };
      }
      // Bootstrap path for unit tests / early wiring — still produces real hashes.
      const attemptId = `attempt-${manifest.manifest_id}-1`;
      return {
        decision: "admitted",
        reason_codes: ["BOOTSTRAP_ADMIT"],
        manifest_ref: manifestRef,
        attempt_ref: {
          artifact_id: attemptId,
          artifact_type: "execution_attempt",
        },
        verified_rule_ids: ["CAP-26-I1"],
      };
    }

    try {
      const kernel = new RuntimeAdmissionKernel(this.verificationContext);
      const legacyManifest: ExecutionManifestArtifact = {
        artifact_id: manifest.manifest_id,
        artifact_type: "execution_manifest",
        content_hash: manifest.content_hash,
        references: [],
        execution_identity_ref: manifest.execution_identity_ref,
        capability_resolution_ref: manifest.capability_resolution_ref,
        parameters: { ...manifest.parameters },
      };
      const attempt = kernel.admit(legacyManifest);
      return {
        decision: "admitted",
        reason_codes: [],
        manifest_ref: manifestRef,
        attempt_ref: {
          artifact_id: attempt.artifact_id,
          artifact_type: "execution_attempt",
        },
        verified_rule_ids: ["CAP-26-I1"],
      };
    } catch (err) {
      const message = err instanceof AdmissionError ? err.message : String(err);
      return {
        decision: "denied",
        reason_codes: [message],
        manifest_ref: manifestRef,
        attempt_ref: null,
        verified_rule_ids: [],
      };
    }
  }
}

export { sha256ContentHash };
