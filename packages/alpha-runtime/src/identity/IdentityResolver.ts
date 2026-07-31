import { ArtifactEnvelope, ArtifactIdentity } from "../types";
import { JsonCanonicalizer } from "../runtime/engines/SimpleCanonicalizer";
import { Sha256HashEngine } from "../runtime/engines/Sha256HashEngine";

export class IdentityResolver {
  private canonicalizer = new JsonCanonicalizer();
  private hasher = new Sha256HashEngine();

  async createEnvelope<T>(
    logicalId: string,
    payload: T,
    context: any
  ): Promise<ArtifactEnvelope<T>> {
    // Determine content hash (just the payload)
    const payloadBytes = this.canonicalizer.serialize(payload);
    const content_hash = await this.hasher.hash(payloadBytes, "sha256-v1");

    // Determine input hash (context + specific metadata from payload)
    const executionId = (payload as any).execution_id;
    const actor = (payload as any).actor;
    const inputContext = {
      ...context,
      logical_id: logicalId,
      execution_id: executionId,
      actor,
      content_hash: content_hash.digest
    };
    const inputBytes = this.canonicalizer.serialize(inputContext);
    const input_hash = await this.hasher.hash(inputBytes, "sha256-v1");

    return {
      identity: {
        logical_id: logicalId,
        input_hash,
        content_hash,
        schema_ref: { id: "unknown", version: "unknown", content_hash: { algorithm: "sha256-v1", digest: "unknown", bit_length: 256 } },
        created_at: context.created_at || new Date().toISOString()
      },
      payload,
      schema_ref: { id: "unknown", version: "unknown", content_hash: { algorithm: "sha256-v1", digest: "unknown", bit_length: 256 } }
    };
  }

  async deriveArtifactIdentity<T>(envelope: ArtifactEnvelope<T>): Promise<ArtifactIdentity> {
    return envelope.identity;
  }
}
