import type {
  ContentReference,
  GovernancePayloadMetadata,
  GovernanceRule,
  DecisionClock,
  EngineObservability,
  ArtifactResult,
  HashDescriptor,
  SignatureDescriptor,
} from "../types";
import { ArtifactIdentityBuilder } from "../identity";

export interface GovernanceDecisionEnvelope {
  readonly schema_ref: { readonly schema_id: string; readonly schema_version: string };
  readonly metadata: GovernancePayloadMetadata;
  readonly provenance_ref: ContentReference;
  readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  readonly rules_evaluated: readonly GovernanceRule[];
  readonly reason?: string;
}

export interface GovernanceDecisionArtifact extends GovernanceDecisionEnvelope {
  readonly content_hash: HashDescriptor;
  readonly signature: SignatureDescriptor;
  readonly artifact_id: string;
}

export interface GovernanceObservability extends EngineObservability {
  readonly decision_timestamp: string; // Observability only, non-binding
}

export class GovernanceEngine {
  constructor(
    private readonly identityBuilder: ArtifactIdentityBuilder,
    private readonly clock: DecisionClock,
    private readonly version: string
  ) {}

  async evaluate(
    provenance: ContentReference,
    _payloadToEvaluate: unknown, // evaluateRules gets only payloads
    rules: readonly GovernanceRule[],
    metadata: GovernancePayloadMetadata
  ): Promise<ArtifactResult<GovernanceDecisionArtifact, GovernanceObservability>> {
    const t0 = performance.now();

    // Evaluate rules (dummy implementation or simple logic)
    let decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" = "ALLOW";
    let reason = "All rules passed";

    for (const rule of rules) {
      if (rule.severity === "CRITICAL") {
        decision = "DENY";
        reason = `Failed critical rule: ${rule.description}`;
        break;
      } else if (rule.severity === "HIGH") {
        decision = "REQUIRE_APPROVAL";
        reason = `Triggered review on rule: ${rule.description}`;
      }
    }

    const envelope: GovernanceDecisionEnvelope = {
      schema_ref: { schema_id: "governance-decision-schema", schema_version: "1.0.0" },
      metadata,
      provenance_ref: provenance,
      decision,
      rules_evaluated: rules,
      reason,
    };

    const artifact = await this.identityBuilder.build(envelope);
    const evaluation_duration_ms = performance.now() - t0;

    const observability: GovernanceObservability = {
      engine_version: this.version,
      identity_profile: "MPS-SECURE-V1",
      verification_profile: "STRICT",
      schema_validation_profile: "STRICT-JSON",
      evaluation_duration_ms,
      decision_timestamp: this.clock.now().toISOString(), // non-binding
    };

    return {
      artifact,
      observability,
    };
  }
}
