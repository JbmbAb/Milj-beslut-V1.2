import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import type { ArtifactReference } from "../artifacts/ArtifactReference";

export const ACT_21_I3: ValidationRule = {
  rule_id: "ACT-21-I3",
  implementation_hash: "act-21-i3-trust-domain-participation-v4",
  description:
    "Actor trust-domain participation is explicit and may contain multiple resolvable trust domains",

  validate(context: ValidationContext) {
    const actors = context.artifacts.filter((artifact) => artifact.artifact_type === "actor");
    const domains = context.artifacts.filter(
      (artifact) => artifact.artifact_type === "trust_domain",
    );

    if (actors.length === 0 || domains.length === 0) {
      return {
        rule_id: "ACT-21-I3",
        passed: false,
        evidence: [],
      };
    }

    const observations = actors.map((actor) => {
      const shapedActor = actor as typeof actor & {
        readonly trust_domain_refs?: readonly ArtifactReference[];
      };
      const refs = shapedActor.trust_domain_refs ?? [];
      const allResolve = refs.every(
        (reference) => context.resolve(reference)?.artifact_type === "trust_domain",
      );
      const unique =
        new Set(
          refs.map(
            (reference) =>
              `${reference.artifact_type}\u0000${reference.artifact_id}`,
          ),
        ).size === refs.length;
      const ok = allResolve && unique;

      return {
        ok,
        evidence: {
          evidence_id: `evidence-ACT-21-I3-${actor.artifact_id}`,
          rule_id: "ACT-21-I3",
          artifact_ref: {
            artifact_id: actor.artifact_id,
            artifact_type: actor.artifact_type,
          },
          observation: ok
            ? refs.length === 0
              ? "actor has no trust-domain participation; ACT-21-I3 permits zero or more domains"
              : `actor explicitly participates in ${refs.length} resolvable trust domain(s)`
            : "actor trust-domain participation is duplicated or unresolved",
          created_at: "",
        },
      };
    });

    return {
      rule_id: "ACT-21-I3",
      passed: observations.every((entry) => entry.ok),
      evidence: observations.map((entry) => entry.evidence),
    };
  },
};
