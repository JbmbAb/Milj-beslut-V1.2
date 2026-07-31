import { HashDescriptor, RegistryReference } from '../types';
import { ExecutionManifest } from './ExecutionManifest';

export interface CanonicalIdentityEnvelope {
  envelope_schema_ref: RegistryReference;
  identity_schema_ref: RegistryReference;
  execution_manifest_ref: RegistryReference; // Reference to the content-addressed ExecutionManifest
  resolved_inputs: Record<string, unknown>;
  dependency_artifact_ids: RegistryReference[];
  world_state_reference: RegistryReference;
  planner_context: Record<string, unknown>;
  policy_context: Record<string, unknown>;
  feature_flags: Record<string, unknown>;
  execution_semantics: string;
  input_hash: HashDescriptor; // The hash of this entire envelope
}
