import { describe, it, expect } from "vitest";
import { RuntimeAdmissionKernel, AdmissionError } from "./RuntimeAdmissionKernel.js";
import type { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js";
import { RuleRegistrySnapshot } from "../../../mps-compliance/src/conformance/RuleRegistrySnapshot.js";
import { CAP_26_I1 } from "../../../mps-compliance/src/validators/CAP_26_I1.js";
import type { ExecutionManifestArtifact } from "../execution/ExecutionManifestArtifact.js";
import type { ExecutionIdentityArtifact } from "../execution/ExecutionIdentityArtifact.js";
import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";

/**
 * PROD-LU-ADMISSION-01B — CAP_26_I1 (the canonical validator this kernel claims to gate on)
 * already treats "capability_resolution" and "CAPABILITY_DEFINITION" as equivalent capability
 * artifacts. RuntimeAdmissionKernel's own pre-check was stricter, silently denying any caller
 * (e.g. LU) whose manifest declares CAPABILITY_DEFINITION. This proves the kernel now matches
 * the rule it enforces, and still denies artifact types that are neither.
 */

const identity: ExecutionIdentityArtifact = {
  artifact_id: "identity-1",
  artifact_type: "execution_identity",
  content_hash: { algorithm: "sha256", value: "h-identity" },
  references: [],
  actor_ref: { artifact_id: "actor-1", artifact_type: "execution_identity" },
  capability_ref: { artifact_id: "cap-1", artifact_type: "CAPABILITY_DEFINITION" },
  signature_envelope_ref: { artifact_id: "sig-1", artifact_type: "execution_identity" },
};

function manifestFor(capability_resolution_artifact_type: string): ExecutionManifestArtifact {
  return {
    artifact_id: "manifest-1",
    artifact_type: "execution_manifest",
    content_hash: { algorithm: "sha256", value: "h-manifest" },
    references: [],
    execution_identity_ref: { artifact_id: "identity-1", artifact_type: "execution_identity" },
    capability_resolution_ref: {
      artifact_id: "cap-1",
      artifact_type: capability_resolution_artifact_type as never,
    },
    parameters: { deterministic_seed: "seed:capability-type-proof" },
  };
}

function contextWith(capabilityArtifact: ArtifactContract): FrozenCoreVerificationContext {
  const artifacts = new Map<string, ArtifactContract>([
    ["execution_identity:identity-1", identity],
    [`${capabilityArtifact.artifact_type}:cap-1`, capabilityArtifact],
  ]);
  return {
    artifactResolver: {
      resolve: (ref) => artifacts.get(`${ref.artifact_type}:${ref.artifact_id}`),
    },
    matrixResolver: { resolve: () => undefined },
    ruleRegistry: new RuleRegistrySnapshot([CAP_26_I1]),
    canonicalSerializer: { serialize: () => ({ bytes: new Uint8Array(), encoding: "identity" }) } as never,
  };
}

describe("RuntimeAdmissionKernel — capability artifact_type alignment with CAP-26-I1", () => {
  it("accepts CAPABILITY_DEFINITION, matching CAP_26_I1's own tolerance", () => {
    const capabilityArtifact: ArtifactContract = {
      artifact_id: "cap-1",
      artifact_type: "CAPABILITY_DEFINITION",
      content_hash: { algorithm: "sha256", value: "h-cap" },
      references: [],
    };
    const kernel = new RuntimeAdmissionKernel(contextWith(capabilityArtifact));
    expect(() => kernel.admit(manifestFor("CAPABILITY_DEFINITION"))).not.toThrow();
  });

  it("still accepts capability_resolution", () => {
    const capabilityArtifact: ArtifactContract = {
      artifact_id: "cap-1",
      artifact_type: "capability_resolution",
      content_hash: { algorithm: "sha256", value: "h-cap" },
      references: [],
    };
    const kernel = new RuntimeAdmissionKernel(contextWith(capabilityArtifact));
    expect(() => kernel.admit(manifestFor("capability_resolution"))).not.toThrow();
  });

  it("still denies an unrelated artifact_type", () => {
    const capabilityArtifact: ArtifactContract = {
      artifact_id: "cap-1",
      artifact_type: "execution_manifest",
      content_hash: { algorithm: "sha256", value: "h-cap" },
      references: [],
    };
    const kernel = new RuntimeAdmissionKernel(contextWith(capabilityArtifact));
    expect(() => kernel.admit(manifestFor("execution_manifest"))).toThrow(AdmissionError);
  });
});
