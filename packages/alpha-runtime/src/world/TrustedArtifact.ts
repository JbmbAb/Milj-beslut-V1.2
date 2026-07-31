import { RegistryReference } from "../types";

export interface TrustedArtifact<T = unknown> {
  reference: RegistryReference;
  payload: T;
  verification: {
    verified: boolean;
    hash: boolean;
    signature: boolean;
    provenance: boolean;
    lineage: boolean;
  };
}
