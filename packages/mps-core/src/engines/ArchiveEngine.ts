import type {
  ContentReference,
  ArchivePayloadMetadata,
  DecisionClock,
  UniqueIdGenerator,
  EngineObservability,
  ArtifactResult,
  HashDescriptor,
  SignatureDescriptor,
} from "../types";
import { ArtifactIdentityBuilder } from "../identity";

export interface ArchiveManifestEnvelope {
  readonly schema_ref: { readonly schema_id: string; readonly schema_version: string };
  readonly metadata: ArchivePayloadMetadata;
  readonly provenance_ref: ContentReference;
  readonly archive_id: string; // Unique non-binding ID
}

export interface ArchiveManifestArtifact extends ArchiveManifestEnvelope {
  readonly content_hash: HashDescriptor;
  readonly signature: SignatureDescriptor;
  readonly artifact_id: string;
}

export interface ArchiveObservability extends EngineObservability {
  readonly archived_at: string; // Observability only, non-binding
}

export class ArchiveEngine {
  constructor(
    private readonly identityBuilder: ArtifactIdentityBuilder,
    private readonly idGenerator: UniqueIdGenerator,
    private readonly clock: DecisionClock,
    private readonly version: string
  ) {}

  async archive(
    provenance: ContentReference,
    metadata: ArchivePayloadMetadata
  ): Promise<ArtifactResult<ArchiveManifestArtifact, ArchiveObservability>> {
    const t0 = performance.now();

    const envelope: ArchiveManifestEnvelope = {
      schema_ref: { schema_id: "archive-manifest-schema", schema_version: "1.0.0" },
      metadata,
      provenance_ref: provenance,
      archive_id: this.idGenerator.generate(), // unique non-binding ID
    };

    const artifact = await this.identityBuilder.build(envelope);
    const evaluation_duration_ms = performance.now() - t0;

    const observability: ArchiveObservability = {
      engine_version: this.version,
      identity_profile: "MPS-SECURE-V1",
      verification_profile: "STRICT",
      schema_validation_profile: "STRICT-JSON",
      evaluation_duration_ms,
      archived_at: this.clock.now().toISOString(), // non-binding
    };

    return {
      artifact,
      observability,
    };
  }
}
