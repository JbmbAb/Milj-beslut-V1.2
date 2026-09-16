import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import type { ArtifactReference } from "../artifacts/ArtifactReference";
import type { ContentHash } from "../artifacts/ContentHash";

export const ACT_21_I3: ValidationRule = {
  rule_id: "ACT-21-I3",
  implementation_hash: "act-21-i3-trust-domain-closure-v2",
  description: "Actor belongs to a resolvable trust domain with a bound trust-anchor root",

  validate(context: ValidationContext) {
    const actors = context.artifacts.filter((artifact) => artifact.artifact_type === "actor");

    const observations = actors.map((actor) => {
      const shapedActor = actor as typeof actor & {
        readonly trust_domain_ref?: ArtifactReference;
      };
      const domain = shapedActor.trust_domain_ref
        ? context.resolve(shapedActor.trust_domain_ref)
        : undefined;
      const shapedDomain = domain as
        | (typeof domain & { readonly anchor_ref?: ArtifactReference })
        | undefined;
      const anchor = shapedDomain?.anchor_ref
        ? context.resolve(shapedDomain.anchor_ref)
        : undefined;
      const shapedAnchor = anchor as
        | (typeof anchor & {
            readonly root_actor_ref?: ArtifactReference;
            readonly root_actor_hash?: ContentHash;
          })
        | undefined;
      const rootActor = shapedAnchor?.root_actor_ref
        ? context.resolve(shapedAnchor.root_actor_ref)
        : undefined;

      const ok =
        Boolean(shapedActor.trust_domain_ref) &&
        domain?.artifact_type === "trust_domain" &&
        Boolean(shapedDomain?.anchor_ref) &&
        anchor?.artifact_type === "trust_anchor" &&
        Boolean(shapedAnchor?.root_actor_ref) &&
        Boolean(shapedAnchor?.root_actor_hash) &&
        rootActor?.artifact_type === "actor" &&
        rootActor?.content_hash.algorithm === shapedAnchor?.root_actor_hash?.algorithm &&
        rootActor?.content_hash.value === shapedAnchor?.root_actor_hash?.value;

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
            ? "actor resolves through trust_domain to trust_anchor and hash-bound root actor"
            : "actor trust-domain/anchor/root closure is missing, unresolved, mistyped, or hash-mismatched",
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
