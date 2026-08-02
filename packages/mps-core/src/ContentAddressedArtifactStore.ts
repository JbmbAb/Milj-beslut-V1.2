import type {
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  SchemaValidator,
  SignatureVerifier,
  ContentReference,
  SignatureDescriptor,
  HashDescriptor,
} from "./types";
import { ArtifactIdentityBuilder } from "./identity";
import {
  SignatureVerificationViolation,
  HashVerificationViolation,
} from "./errors";

export interface ArtifactStorageBackend {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  exists(id: string): Promise<boolean>;
}

export class ContentAddressedArtifactStore {
  constructor(
    private readonly serializer: CanonicalArtifactSerializer,
    private readonly hashEngine: CanonicalHashEngine,
    private readonly identityBuilder: ArtifactIdentityBuilder,
    private readonly schemaValidator: SchemaValidator,
    private readonly signatureVerifier: SignatureVerifier,
    private readonly backend: ArtifactStorageBackend
  ) {}

  async get<T>(reference: ContentReference): Promise<T> {
    const bytes = await this.backend.get(reference.id);
    if (!bytes) {
      throw new Error(`Artifact not found: ${reference.id}`);
    }

    // Deserialize
    const artifact = JSON.parse(new TextDecoder().decode(bytes)) as any;

    // Verify content hash by extracting the raw envelope
    const { content_hash, signature, artifact_id, ...envelope } = artifact;
    const envelopeBytes = this.serializer.serialize(envelope);
    const computedHash = this.hashEngine.hash(envelopeBytes);
    if (
      computedHash.algorithm !== reference.content_hash.algorithm ||
      computedHash.digest !== reference.content_hash.digest
    ) {
      throw new HashVerificationViolation(
        "HASH_MISMATCH",
        "Retrieved artifact bytes do not match expected content hash",
        reference
      );
    }

    // Verify signature if present
    if (artifact.signature) {
      const ok = await this.signatureVerifier.verify(
        reference.content_hash,
        artifact.signature
      );
      if (!ok) {
        throw new SignatureVerificationViolation(
          "SIGNATURE_INVALID",
          "Artifact signature does not verify",
          reference
        );
      }
    }

    // Validate schema
    this.schemaValidator.validate(artifact);

    return artifact as T;
  }

  async has(reference: ContentReference): Promise<boolean> {
    return this.backend.exists(reference.id);
  }

  async put<TEnvelope>(
    envelope: TEnvelope
  ): Promise<
    ContentReference & {
      artifact: TEnvelope & {
        content_hash: HashDescriptor;
        signature: SignatureDescriptor;
        artifact_id: string;
      };
    }
  > {
    const artifact = await this.identityBuilder.build(envelope);
    this.schemaValidator.validate(artifact);

    const bytes = this.serializer.serialize(artifact);
    await this.backend.put(artifact.artifact_id, bytes);

    return {
      id: artifact.artifact_id,
      content_hash: artifact.content_hash,
      schema_ref: (envelope as any).schema_ref,
      artifact,
    };
  }
}
