import { HashDescriptor, RegistryReference, SignatureDescriptor } from "../types";

export interface ArtifactIdentity {
  logical_id: string;

  // Hash of the canonical input envelope (context + logical_id + schema_ref)
  input_hash: HashDescriptor;

  // Hash of the canonical payload (artifact bytes)
  content_hash: HashDescriptor;

  schema_ref?: RegistryReference;

  created_at: string;

  version?: string; // semantic or registry version
}

export interface CanonicalIdentityEnvelope<T = unknown> {
  identity: {
    logical_id: string;
    input_hash: HashDescriptor;
    schema_ref?: RegistryReference;
    created_at: string;
  };
  payload: T;
}

export interface ArtifactEnvelope<T = unknown> {
  identity: ArtifactIdentity;
  payload: T;
  signature?: SignatureDescriptor;
}
