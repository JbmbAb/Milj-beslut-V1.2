import { ReplayInvariant } from "./ReplayInvariant";
import { CheckpointArtifact } from "../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../execution/RuntimeExecutionResult";
import { ReplayVerificationResult, ReplayMismatch } from "./ReplayVerifierTypes";
import { ReplayFingerprintFactory } from "../fingerprint/ReplayFingerprintArtifact";
import { RegistryReferenceCanonicalizer } from "../canonicalization/RegistryReferenceCanonicalizer";
import { HashDescriptors } from "../../types/HashDescriptor";

export class ReplayVerifier {
  constructor(private readonly invariants: readonly ReplayInvariant[]) {}

  async verify(checkpoint: CheckpointArtifact, replay: RuntimeExecutionResult): Promise<ReplayVerificationResult> {
    const replayFingerprint = await ReplayFingerprintFactory.create({
      execution_identity_hash: replay.execution_identity_hash,
      execution_plan_hash: replay.execution_plan_hash,
      dependency_graph_hash: replay.dependency_resolution.graph_hash,
      deterministic_seed: replay.deterministic_seed,
      completed_steps: replay.completed_steps,
      output_references: replay.output_references.map(
        RegistryReferenceCanonicalizer.toCanonical
      ),
    });

    const fingerprintMatches = HashDescriptors.equals(
      replayFingerprint.fingerprint,
      checkpoint.payload.replay_fingerprint
    );

    const invariant_results = this.invariants.map(inv =>
      inv.verify(checkpoint, replay)
    );

    const mismatches: ReplayMismatch[] = invariant_results
      .filter(r => !r.passed && r.mismatch)
      .map(r => r.mismatch!);

    return {
      replay_valid: invariant_results.every(r => r.passed),
      fingerprint_valid: fingerprintMatches,
      invariant_results,
      mismatches,
    };
  }
}
