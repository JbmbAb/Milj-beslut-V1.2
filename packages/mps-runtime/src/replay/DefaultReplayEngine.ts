import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { FrozenReplayArtifact } from "../contracts/freeze/FrozenIdentities.js";
import type { RuntimeState } from "../kernel/RuntimeState.js";
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

    const replay: FrozenReplayArtifact = {
      artifact_id: `replay-${manifest_ref.artifact_id}-${attempt.attempt_id}`,
      artifact_type: "REPLAY",
      manifest_ref,
      replayed_outcome_ref: {
        artifact_id: `outcome-${attempt.attempt_id}`,
        artifact_type: "execution_outcome",
      },
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
}
