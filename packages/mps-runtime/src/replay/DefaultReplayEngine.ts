import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import {
  validateFrozenExecutionOutcomeIdentity,
  type FrozenExecutionAttemptIdentity,
  type FrozenExecutionOutcomeIdentity,
  type FrozenReplayArtifact,
} from "../contracts/freeze/FrozenIdentities.js";
import { createEmptyRuntimeState, type RuntimeState } from "../kernel/RuntimeState.js";
import type { ReplayEnginePort, ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";

/**
 * ReplayEngine — separate from CAS. Reads artifacts via repository; never embeds store logic.
 */
export class DefaultReplayEngine implements ReplayEnginePort {
  constructor(private readonly repository: ArtifactRepositoryPort) {}

  async replay(manifest_ref: ArtifactReference, state: RuntimeState): Promise<FrozenReplayArtifact> {
    const manifest = await this.repository.resolve<unknown>(manifest_ref);
    const attempt = state.attempt;
    if (!attempt) {
      throw new Error("Replay requires attempt on RuntimeState");
    }

    const equivalence_proof = sha256ContentHash({
      manifest,
      attempt_id: attempt.attempt_id,
      attempt_hash: attempt.content_hash.value,
    });

    const persistedOutcome = state.execution_graph.nodes.find((node) => node.kind === "outcome")?.ref;
    const replayed_outcome_ref = persistedOutcome ?? {
      artifact_id: `outcome-${attempt.attempt_id}`,
      artifact_type: "execution_outcome" as const,
    };
    const replay: FrozenReplayArtifact = {
      artifact_id: `replay-${manifest_ref.artifact_id}-${attempt.attempt_id}`,
      artifact_type: "REPLAY",
      manifest_ref,
      replayed_outcome_ref,
      equivalence_proof,
      content_hash: sha256ContentHash({
        manifest_ref: manifest_ref.artifact_id,
        attempt: attempt.attempt_id,
        proof: equivalence_proof.value,
      }),
    };

    await this.repository.put({
      artifact_id: replay.artifact_id,
      content_hash: replay.content_hash,
      body: replay,
    });

    return replay;
  }

  /**
   * LU-REPLAY-COLD-VERIFY-V1.
   *
   * `replay()` above is unchanged -- same signature, same semantics, same REPLAY artifact shape.
   * This is an additive entry point for the exact gap the recon found: `replay()` requires the
   * caller to already hold `state.attempt` in memory, which a genuinely fresh process (nothing but
   * a manifest_id string, no RuntimeState carried over from the original execution) cannot supply.
   *
   * The attempt is already durable in CAS under a deterministic id (`attempt-${manifest_id}-1`,
   * ExecutionKernel.ts) -- this resolves it from there instead of demanding it in memory, then
   * delegates to the exact same `replay()` logic. It also closes a second gap the recon flagged:
   * `replay()` never checked that the manifest and attempt it was handed actually belonged to each
   * other. This does, before ever computing an equivalence_proof.
   *
   * No PostGIS, no network, no "current" release/geometry/binding resolver, no process.env, no
   * clock -- only content-addressed CAS resolves.
   */
  async replayFromManifestId(manifestId: string): Promise<FrozenReplayArtifact> {
    const manifest_ref: ArtifactReference = { artifact_id: manifestId, artifact_type: "execution_manifest" };
    const attempt_ref: ArtifactReference = { artifact_id: `attempt-${manifestId}-1`, artifact_type: "execution_attempt" };

    const attempt = await this.repository.resolve<FrozenExecutionAttemptIdentity>(attempt_ref);
    if (attempt.manifest_ref.artifact_id !== manifestId || attempt.manifest_ref.artifact_type !== "execution_manifest") {
      throw new Error(
        `REJECT_REPLAY_COLD_VERIFY: attempt ${attempt_ref.artifact_id}'s own manifest_ref (${attempt.manifest_ref.artifact_id}) does not match the requested manifest_id (${manifestId})`,
      );
    }

    const legacyOutcomeRef: ArtifactReference = {
      artifact_id: `outcome-${attempt.attempt_id}`,
      artifact_type: "execution_outcome",
    };
    const v2OutcomeRef: ArtifactReference = {
      artifact_id: `outcome-v2-${attempt.attempt_id}`,
      artifact_type: "execution_outcome",
    };
    let outcomeRef = legacyOutcomeRef;
    let v2Outcome: FrozenExecutionOutcomeIdentity | null = null;
    try {
      v2Outcome = await this.repository.resolve<FrozenExecutionOutcomeIdentity>(v2OutcomeRef);
    } catch {
      // No V2 locator means this is a historical V1 execution.
    }
    if (v2Outcome) {
      validateFrozenExecutionOutcomeIdentity(v2Outcome);
      outcomeRef = v2OutcomeRef;
    }
    const state: RuntimeState = {
      ...createEmptyRuntimeState(),
      attempt,
      execution_graph: { nodes: [{ node_id: "outcome-0", kind: "outcome", ref: outcomeRef }], edges: [] },
    };
    return this.replay(manifest_ref, state);
  }
}
