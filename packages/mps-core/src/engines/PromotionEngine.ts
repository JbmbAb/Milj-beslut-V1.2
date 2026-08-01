import type {
  ContentReference,
  PromotionPayloadMetadata,
  DecisionClock,
  EngineObservability,
  ArtifactResult,
  HashDescriptor,
  SignatureDescriptor,
} from "../types";
import { PromotionPolicyViolation } from "../errors";
import { ArtifactIdentityBuilder } from "../identity";
import { GovernanceDecisionArtifact } from "./GovernanceEngine";

export interface PromotionEnvelope {
  readonly schema_ref: { readonly schema_id: string; readonly schema_version: string };
  readonly metadata: PromotionPayloadMetadata;
  readonly governance_ref: ContentReference;
  readonly provenance_ref: ContentReference;
}

export interface PromotionArtifact extends PromotionEnvelope {
  readonly content_hash: HashDescriptor;
  readonly signature: SignatureDescriptor;
  readonly artifact_id: string;
}

export interface PromotionObservability extends EngineObservability {
  readonly promoted_at: string; // Observability only, non-binding
}

export class PromotionEngine {
  constructor(
    private readonly identityBuilder: ArtifactIdentityBuilder,
    private readonly clock: DecisionClock,
    private readonly version: string
  ) {}

  async promote(
    provenance: ContentReference,
    governanceDecision: GovernanceDecisionArtifact,
    governanceRef: ContentReference,
    metadata: PromotionPayloadMetadata
  ): Promise<ArtifactResult<PromotionArtifact, PromotionObservability>> {
    const t0 = performance.now();

    // Promotion MUST only proceed when GovernanceDecisionArtifact decision === "ALLOW"
    if (governanceDecision.decision !== "ALLOW") {
      throw new PromotionPolicyViolation(
        "PROMOTION_DENIED",
        `Promotion denied: governance decision is ${governanceDecision.decision}`,
        governanceRef
      );
    }

    const envelope: PromotionEnvelope = {
      schema_ref: { schema_id: "promotion-schema", schema_version: "1.0.0" },
      metadata,
      governance_ref: governanceRef,
      provenance_ref: provenance,
    };

    const artifact = await this.identityBuilder.build(envelope);
    const evaluation_duration_ms = performance.now() - t0;

    const observability: PromotionObservability = {
      engine_version: this.version,
      identity_profile: "MPS-SECURE-V1",
      verification_profile: "STRICT",
      schema_validation_profile: "STRICT-JSON",
      evaluation_duration_ms,
      promoted_at: this.clock.now().toISOString(), // non-binding
    };

    return {
      artifact,
      observability,
    };
  }
}
