import {
  ArtifactEnvelope,
  VerificationResult,
  RegistryReference,
  ProvenanceRecord,
  SignatureDescriptor
} from "../types";
import { ProvenanceGraph } from "../provenance/ProvenanceTypes";
import { RegistryEntry } from "./RegistryStore";

export interface RegistryEntryBuilderOptions {
  registryId: string;
}

export class RegistryEntryBuilder {
  constructor(private opts: RegistryEntryBuilderOptions) {}

  build<T>(
    envelope: ArtifactEnvelope<T>,
    verification: VerificationResult,
    provenance: ProvenanceGraph
  ): RegistryEntry {
    if (!verification.verified) {
      throw new Error(
        `Artifact cannot enter registry: ${verification.errors.join(",") || "unverified"}`
      );
    }

    const reference: RegistryReference = {
      id: envelope.identity.logical_id,
      version: envelope.schema_ref.version,
      content_hash: envelope.identity.content_hash,
      schema_ref: envelope.schema_ref
    };

    return {
      reference,
      content: envelope.payload,
      signature: envelope.signature,
      provenance,
      lifecycle: {
        state: "admitted",
        transition_history: []
      },
      metadata: {
        registry_id: this.opts.registryId,
        ...envelope.metadata
      }
    };
  }
}
