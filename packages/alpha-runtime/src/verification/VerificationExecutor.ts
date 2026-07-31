import {
  ArtifactEnvelope,
  VerificationResult,
  HashDescriptor
} from "../types";

import { Canonicalizer } from "../canonical/RFC8785Canonicalizer";
import { CanonicalizationProfile } from "../canonical/CanonicalizationProfile";
import { HashEngine } from "../crypto/HashEngine";
import { SignatureVerifier } from "../crypto/SignatureVerifier";
import { ArtifactValidator } from "../artifact/ArtifactValidator";
import { ProvenanceVerifier } from "../provenance/ProvenanceVerifier";
import { ProvenanceGraph } from "../provenance/ProvenanceTypes";

export interface VerificationExecutorOptions {
  canonicalizer: Canonicalizer;
  profile: CanonicalizationProfile;
  hashEngine: HashEngine;
  signatureVerifier: SignatureVerifier;
  validator: ArtifactValidator;
  provenanceVerifier?: ProvenanceVerifier;
  requireSignature?: boolean;
}

export class VerificationExecutor {
  constructor(private opts: VerificationExecutorOptions) {}

  async verify<T>(envelope: ArtifactEnvelope<T>): Promise<VerificationResult> {
    const errors: string[] = [];

    const bytes = this.opts.canonicalizer.serialize(envelope.payload, this.opts.profile);

    const computedHash = await this.opts.hashEngine.hash(
      bytes,
      envelope.identity.content_hash.algorithm
    );

    const hashValid =
      envelope.identity.content_hash.digest === computedHash.digest &&
      envelope.identity.content_hash.bit_length === computedHash.bit_length;

    if (!hashValid) errors.push("content_hash_mismatch");

    let signatureStatus: "missing" | "valid" | "invalid" | "untrusted" = "missing";

    if (envelope.signature) {
      signatureStatus = await this.opts.signatureVerifier.verify(bytes, envelope.signature);
    } else if (this.opts.requireSignature) {
      errors.push("signature_missing");
    }

    const schemaValidation = await this.opts.validator.validateSchema(
      envelope.payload,
      envelope.schema_ref
    );
    if (!schemaValidation.valid) errors.push(...schemaValidation.errors);

    const referenceValidation = await this.opts.validator.validateReferences(envelope.payload);
    if (!referenceValidation.valid) errors.push(...referenceValidation.errors);

    let provenanceValid = true;
    if (this.opts.provenanceVerifier && envelope.metadata?.provenance_graph) {
      const provResult = await this.opts.provenanceVerifier.verify(
        envelope.metadata.provenance_graph as ProvenanceGraph
      );
      if (!provResult.valid) {
        provenanceValid = false;
        errors.push(...provResult.errors);
      }
    }

    const verified =
      hashValid &&
      (signatureStatus === "valid" ||
        (!this.opts.requireSignature && signatureStatus === "missing")) &&
      schemaValidation.valid &&
      referenceValidation.valid &&
      provenanceValid &&
      errors.length === 0;

    return {
      verified,
      hash_valid: hashValid,
      signature_status: signatureStatus,
      schema_valid: schemaValidation.valid,
      policy_valid: true,
      errors
    };
  }
}
