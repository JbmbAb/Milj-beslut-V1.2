import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import type { ContentHash } from "../artifacts/ContentHash";
import type { ArtifactReference } from "../artifacts/ArtifactReference";

/**
 * ADR-24-21 ACT-21-I1 — Canonical Actor Identity.
 *
 * This rule is deliberately structural/deterministic. Cryptographic authority
 * verification belongs to the async authority boundary in mps-governance-runtime;
 * this conformance rule proves that an actor cannot enter that boundary without
 * an explicit, resolvable, content-bound identity.
 */
export const ACT_21_I1: ValidationRule = {
  rule_id: "ACT-21-I1",
  implementation_hash: "act-21-i1-canonical-actor-identity-v2",
  description: "Every actor SHALL have a canonical, content-addressed identity",

  validate(context: ValidationContext) {
    const actors = context.artifacts.filter((artifact) => artifact.artifact_type === "actor");

    const evidence = actors.map((actor) => {
      const shaped = actor as typeof actor & {
        readonly identity_ref?: ArtifactReference;
        readonly identity_hash?: ContentHash;
      };
      const resolved = shaped.identity_ref ? context.resolve(shaped.identity_ref) : undefined;
      const identityMatches =
        Boolean(shaped.identity_ref?.artifact_id) &&
        Boolean(shaped.identity_hash?.value) &&
        Boolean(resolved) &&
        resolved!.artifact_id === shaped.identity_ref!.artifact_id &&
        resolved!.artifact_type === shaped.identity_ref!.artifact_type &&
        resolved!.content_hash.algorithm === shaped.identity_hash!.algorithm &&
        resolved!.content_hash.value === shaped.identity_hash!.value;

      return {
        ok: identityMatches,
        evidence: {
          evidence_id: `evidence-ACT-21-I1-${actor.artifact_id}`,
          rule_id: "ACT-21-I1",
          artifact_ref: {
            artifact_id: actor.artifact_id,
            artifact_type: actor.artifact_type,
          },
          observation: identityMatches
            ? "actor identity resolves and matches the pinned identity hash"
            : "actor identity is missing, unresolved, or hash-mismatched",
          created_at: "",
        },
      };
    });

    return {
      rule_id: "ACT-21-I1",
      passed: evidence.every((entry) => entry.ok),
      evidence: evidence.map((entry) => entry.evidence),
    };
  },
};
