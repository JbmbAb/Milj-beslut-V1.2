export interface HashDescriptor {
  algorithm: string;
  digest: string;
  encoding?: "hex" | "base64" | string;
  bit_length: number;
}

export interface RegistryReference {
  id: string;
  version: string;
  content_hash: HashDescriptor;
  schema_ref?: RegistryReference;
}

export interface ProvenanceRecord {
  artifact_hash: HashDescriptor;
  created_by: RegistryReference;
  created_at: string;
  parent?: RegistryReference;
  operation:
    | "created"
    | "mutated"
    | "promoted"
    | "deprecated"
    | "restored";
  metadata?: Record<string, unknown>;
}

export interface ProvenanceGraph {
  root: ProvenanceRecord | null;
  chain: ProvenanceRecord[];
  merkle_root: HashDescriptor;
}

export interface ArtifactIdentity {
  logical_id: string;
  input_hash: HashDescriptor;
  content_hash: HashDescriptor;
  schema_ref: RegistryReference;
  created_at: string;
}

export interface KeyDescriptor {
  key_id: string;
  public_key?: string;
  algorithm: string;
  metadata?: Record<string, unknown>;
}

export interface SignatureDescriptor {
  algorithm: string;
  key_id: string;
  signature: string;
  encoding: "base64" | "hex";
  created_at: string;
}

export interface ArtifactEnvelope<T = unknown> {
  identity: ArtifactIdentity;
  payload: T;
  schema_ref: RegistryReference;
  signature?: SignatureDescriptor;
  metadata?: Record<string, unknown>;
}

export interface VerificationResult {
  verified: boolean;
  hash_valid: boolean;
  signature_status: "valid" | "invalid" | "missing" | "untrusted";
  schema_valid: boolean;
  policy_valid: boolean;
  errors: string[];
}
