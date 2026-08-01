import type {
  ArtifactIdentityStrategy,
  CanonicalHashEngine,
  HashDescriptor,
  SignatureDescriptor,
  Signer,
  CanonicalArtifactSerializer,
} from "./types";

export interface SignedArtifactIdentity<TEnvelope> {
  readonly content_hash: HashDescriptor;
  readonly signature: SignatureDescriptor;
  readonly artifact_id: string;
  readonly envelope: TEnvelope; // kept for debugging, but not used by engines
}

export class ArtifactIdentityBuilder {
  constructor(
    private readonly serializer: CanonicalArtifactSerializer,
    private readonly hashEngine: CanonicalHashEngine,
    private readonly signer: Signer,
    private readonly identityStrategy: ArtifactIdentityStrategy
  ) {}

  async build<TEnvelope>(envelope: TEnvelope): Promise<
    TEnvelope & {
      content_hash: HashDescriptor;
      signature: SignatureDescriptor;
      artifact_id: string;
    }
  > {
    const bytes = this.serializer.serialize(envelope);
    const content_hash = this.hashEngine.hash(bytes);
    const signature = await this.signer.sign(content_hash);
    const artifact_id = this.identityStrategy.createArtifactId(content_hash);

    return {
      ...envelope,
      content_hash,
      signature,
      artifact_id,
    };
  }
}

export async function createSignedArtifactIdentity<TEnvelope>(
  envelope: TEnvelope,
  builder: ArtifactIdentityBuilder
) {
  return builder.build(envelope);
}
