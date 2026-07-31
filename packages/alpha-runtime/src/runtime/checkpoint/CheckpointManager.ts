import { CheckpointArtifact, CheckpointArtifactPayload } from "./CheckpointArtifact";
import { RuntimeExecutionResult } from "../execution/RuntimeExecutionResult";
import { ReplayFingerprintFactory } from "../fingerprint/ReplayFingerprintArtifact";
import { RegistryReferenceCanonicalizer } from "../canonicalization/RegistryReferenceCanonicalizer";
import { JsonCanonicalizer } from "../engines/SimpleCanonicalizer";
import { Sha256HashEngine } from "../engines/Sha256HashEngine";

export class CheckpointManager {
  async createCheckpointFromExecution(result: RuntimeExecutionResult): Promise<CheckpointArtifact> {
    const fingerprintArtifact = await ReplayFingerprintFactory.create({
      execution_identity_hash: result.execution_identity_hash,
      execution_plan_hash: result.execution_plan_hash,
      dependency_graph_hash: result.dependency_resolution.graph_hash,
      completed_steps: result.completed_steps,
      output_references: result.output_references.map(
        RegistryReferenceCanonicalizer.toCanonical
      ),
    });

    const payload: CheckpointArtifactPayload = {
      execution_identity_hash: result.execution_identity_hash,
      execution_plan_hash: result.execution_plan_hash,
      dependency_graph_hash: result.dependency_resolution.graph_hash,
      deterministic_seed: result.deterministic_seed,
      completed_steps: result.completed_steps,
      produced_outputs: result.output_references,
      replay_fingerprint: fingerprintArtifact.fingerprint,
      created_at_iso: result.completed_at_iso,
    };

    const canonicalizer = new JsonCanonicalizer();
    const hasher = new Sha256HashEngine();
    
    const canonical = canonicalizer.serialize(payload);
    const identity_hash = await hasher.hash(canonical, "sha256-v1");

    return {
      identity_hash,
      payload,
    };
  }
}
