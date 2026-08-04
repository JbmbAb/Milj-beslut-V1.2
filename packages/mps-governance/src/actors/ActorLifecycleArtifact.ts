import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";

export type ActorLifecycleState =
  "pending" | "active" | "suspended" | "retired";

export interface ActorLifecycleArtifact extends ArtifactContract {
  readonly state: ActorLifecycleState;
  readonly effective_from: string;
  readonly effective_to?: string;
}
