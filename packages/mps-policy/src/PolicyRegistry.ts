import type { PolicySetArtifact } from "./PolicyTypes";

export interface PolicyRegistry {
  readonly policy_set: PolicySetArtifact;

  getPolicyContent(policy_id: string): Uint8Array | null;
}
