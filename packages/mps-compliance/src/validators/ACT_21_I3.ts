import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import type { ArtifactReference } from "../artifacts/ArtifactReference";
import type { ContentHash } from "../artifacts/ContentHash";

function sameRef(
  left: { readonly artifact_id: string; readonly artifact_type: string } | undefined,
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return Boolean(
    left &&
      left.artifact_id === right.artifact_id &&
      left.artifact_type === right.artifact_type,
  );
}

export const ACT_21_I3: ValidationRule = {
  rule_id: "ACT-21-I3",
  implementation_hash: "act-21-i3-trust-domain-participation-v3",
  description:
    "Trust-domain participation is explicit; trust-anchor root actors are bound through their domain anchor",

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
        readonly trust_domain_ref?: ArtifactReference;
      };

      const isBoundRootActor = domains.some((domain) => {
        const shapedDomain = domain as typeof domain & {
          readonly anchor_ref?: ArtifactReference;
        };
        const anchor = shapedDomain.anchor_ref
          ? context.resolve(shapedDomain.anchor_ref)
          : undefined;
        const shapedAnchor = anchor as
          | (typeof anchor & {
              readonly root_actor_ref?: ArtifactReference;
              readonly root_actor_hash?: ContentHash;
            })
          | undefined;

        return Boolean(
          anchor?.artifact_type === "trust_anchor" &&
            sameRef(shapedAnchor?.root_actor_ref, actor) &&
            shapedAnchor?.root_actor_hash &&
            actor.content_hash.algorithm === shapedAnchor.root_actor_hash.algorithm &&
            actor.content_hash.value === shapedAnchor.root_actor_hash.value,
        );
      });

      const domain = shapedActor.trust_domain_ref
        ? context.resolve(shapedActor.trust_domain_ref)
        : undefined;

      const participatesThroughDomain =
        Boolean(shapedActor.trust_domain_ref) &&
        domain?.artifact_type === "trust_domain";

      const ok = isBoundRootActor || participatesThroughDomain;

      return {
        ok,
        evidence: {
          evidence_id: `evidence-ACT-21-I3-${actor.artifact_id}`,
          rule_id: "ACT-21-I3",
          artifact_ref: {
            artifact_id: actor.artifact_id,
            artifact_type: actor.artifact_type,
          },
          observation: isBoundRootActor
            ? "actor participates as a hash-bound trust-anchor root"
            : participatesThroughDomain
              ? "actor explicitly references one resolvable trust domain in the current representation"
              : "actor neither references a resolvable trust domain nor participates as a hash-bound trust-anchor root",
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
