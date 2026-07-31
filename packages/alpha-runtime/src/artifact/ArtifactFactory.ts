import {
  ArtifactEnvelope,
  ArtifactIdentity,
  RegistryReference,
  KeyDescriptor
} from "../types";

import { IdentityResolver } from "../identity/IdentityResolver";
import { ArtifactValidator } from "./ArtifactValidator";
import { SignatureProvider } from "../crypto/SignatureProvider";
import { JsonCanonicalizer } from "../runtime/engines/SimpleCanonicalizer";

export interface ArtifactFactoryOptions {
  validator?: ArtifactValidator;
  signer?: SignatureProvider;
}

export class ArtifactFactory {
  private identityResolver = new IdentityResolver();

  constructor(private opts: ArtifactFactoryOptions = {}) {}

  // Backwards compatible signature + new signature support
  async create<T>(
    logicalIdOrParams: string | any,
    payload?: T,
    context?: any
  ): Promise<ArtifactEnvelope<T>> {
    let logicalId = "";
    let actualPayload: any;
    let actualContext: any = {};
    let schemaRef: RegistryReference = { id: "unknown", version: "unknown", content_hash: { algorithm: "sha256-v1", digest: "unknown", bit_length: 256 } };
    let signingKey: KeyDescriptor | undefined;
    let metadata: any;

    if (typeof logicalIdOrParams === "string") {
      logicalId = logicalIdOrParams;
      actualPayload = payload;
      actualContext = context || {};
    } else {
      logicalId = logicalIdOrParams.logicalId;
      actualPayload = logicalIdOrParams.artifact || logicalIdOrParams.payload;
      schemaRef = logicalIdOrParams.schemaRef;
      signingKey = logicalIdOrParams.signingKey;
      metadata = logicalIdOrParams.metadata;
    }

    if (this.opts.validator && schemaRef.id !== "unknown") {
      const schemaValidation = await this.opts.validator.validateSchema(actualPayload, schemaRef);
      if (!schemaValidation.valid) throw new Error(schemaValidation.errors.join(","));

      const refValidation = await this.opts.validator.validateReferences(actualPayload);
      if (!refValidation.valid) throw new Error(refValidation.errors.join(","));
    }

    const envelope = await this.identityResolver.createEnvelope(logicalId, actualPayload, actualContext);
    
    // Override schema_ref if provided from legacy signature
    if (schemaRef.id !== "unknown") {
      envelope.schema_ref = schemaRef;
      envelope.identity.schema_ref = schemaRef;
    }
    
    if (metadata) {
      envelope.metadata = metadata;
    }

    if (this.opts.signer && signingKey) {
      const bytes = new JsonCanonicalizer().serialize(actualPayload);
      envelope.signature = await this.opts.signer.sign(bytes, signingKey);
    }

    return envelope;
  }
}
