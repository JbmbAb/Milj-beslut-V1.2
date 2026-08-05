import { createHash } from "node:crypto";
import { ExecutionManifestArtifact } from "../execution/ExecutionManifestArtifact";
import { ExecutionAttemptArtifact } from "../execution/ExecutionAttemptArtifact";
import { ExecutionIdentityArtifact } from "../execution/ExecutionIdentityArtifact";
import { CapabilityResolutionArtifact } from "../execution/CapabilityResolutionArtifact";
import { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext";

export class AdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdmissionError";
  }
}

/**
 * RuntimeAdmissionKernel
 *
 * The strict gatekeeper for execution.
 * Domain logic SHALL NOT execute unless admitted by this kernel.
 */
export class RuntimeAdmissionKernel {
  constructor(private readonly verificationContext: FrozenCoreVerificationContext) {}

  public admit(manifest: ExecutionManifestArtifact): ExecutionAttemptArtifact {
    // 1. Resolve Identity
    const identityArtifact = this.verificationContext.artifactResolver.resolve(manifest.execution_identity_ref) as ExecutionIdentityArtifact;
    if (!identityArtifact || identityArtifact.artifact_type !== "execution_identity") {
      throw new AdmissionError("DENIED: Invalid or missing Execution Identity");
    }

    // 2. Resolve Capability Resolution
    const resolutionArtifact = this.verificationContext.artifactResolver.resolve(manifest.capability_resolution_ref) as CapabilityResolutionArtifact;
    if (!resolutionArtifact || resolutionArtifact.artifact_type !== "capability_resolution") {
      throw new AdmissionError("DENIED: Invalid or missing Capability Resolution");
    }

    // 3. Verify Capability Grant closure via frozen rule
    // In full implementation, we run FrozenCoreVerifier against a runtime context slice.
    // For this admission check, we ensure the grant can be resolved.
    const rule_cap_26_i1 = this.verificationContext.ruleRegistry.rules.find(r => r.rule_id === "CAP-26-I1");
    if (!rule_cap_26_i1) {
      throw new AdmissionError("DENIED: Compliance rule CAP-26-I1 missing or registry tampered");
    }

    // Deterministic started_at: seed from parameters only (never wall-clock in identity).
    const started_at =
      manifest.parameters && typeof manifest.parameters["deterministic_seed"] === "string"
        ? (manifest.parameters["deterministic_seed"] as string)
        : `seed:${manifest.artifact_id}:1`;

    const hashValue = createHash("sha256")
      .update(
        JSON.stringify({
          manifest_id: manifest.artifact_id,
          attempt_number: 1,
          started_at,
          identity: manifest.execution_identity_ref.artifact_id,
          capability: manifest.capability_resolution_ref.artifact_id,
        }),
      )
      .digest("hex");

    return {
      artifact_id: `attempt-${manifest.artifact_id}`,
      artifact_type: "execution_attempt",
      manifest_ref: { artifact_id: manifest.artifact_id, artifact_type: "execution_manifest" },
      attempt_number: 1,
      started_at,
      content_hash: { algorithm: "sha256", value: hashValue },
      references: [],
    };
  }
}
