import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface RegistryStateEntry {
  readonly subject_ref: ContentReference;
  readonly state_metadata: unknown;
}

export interface RegistryStateArtifact extends CanonicalArtifact {
  readonly artifact_type: "REGISTRY_STATE_ARTIFACT";

  // REG-STATE-24-16-I4: State Lineage
  readonly previous_state_ref?: ContentReference;
  
  // REG-STATE-24-16-I5: State Transition Authority
  readonly mutation_execution_ref?: ContentReference;
  
  readonly state_version: string;
  
  // REG-STATE-24-16-I1, I2: Entries must be deterministically ordered
  readonly entries: readonly RegistryStateEntry[];
}
