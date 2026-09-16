import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import type { ArtifactReference } from "../artifacts/ArtifactReference";

function refKey(ref: { readonly artifact_id: string; readonly artifact_type: string }): string {
  return `${ref.artifact_type}\u0000${ref.artifact_id}`;
}

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

type DelegationShape = {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly from_actor_ref?: ArtifactReference;
  readonly to_actor_ref?: ArtifactReference;
  readonly domain_ref?: ArtifactReference;
  readonly authority_scope?: string;
  readonly valid_from?: string;
  readonly valid_until?: string;
};

function intervalIsWellFormed(delegation: DelegationShape): boolean {
  if (!delegation.valid_from) return false;
  const from = Date.parse(delegation.valid_from);
  if (Number.isNaN(from)) return false;
  if (delegation.valid_until === undefined) return true;
  const until = Date.parse(delegation.valid_until);
  return !Number.isNaN(until) && until > from;
}

export const ACT_21_I5: ValidationRule = {
  rule_id: "ACT-21-I5",
  implementation_hash: "act-21-i5-deterministic-delegation-v2",
  description: "Trust delegation graph is deterministic: resolvable, acyclic and unambiguous",

  validate(context: ValidationContext) {
    const domains = context.artifacts.filter(
      (artifact) => artifact.artifact_type === "trust_domain",
    );
    const delegations = context.artifacts.filter(
      (artifact) => artifact.artifact_type === "trust_delegation",
    ) as readonly (typeof context.artifacts[number] & DelegationShape)[];

    const evidence: Array<{
      ok: boolean;
      value: {
        evidence_id: string;
        rule_id: string;
        artifact_ref: ArtifactReference;
        observation: string;
        created_at: string;
      };
    }> = [];

    for (const domain of domains) {
      const shapedDomain = domain as typeof domain & {
        readonly anchor_ref?: ArtifactReference;
      };
      const anchor = shapedDomain.anchor_ref
        ? context.resolve(shapedDomain.anchor_ref)
        : undefined;
      const shapedAnchor = anchor as
        | (typeof anchor & { readonly root_actor_ref?: ArtifactReference })
        | undefined;
      const rootRef = shapedAnchor?.root_actor_ref;
      const rootActor = rootRef ? context.resolve(rootRef) : undefined;

      const domainDelegations = delegations.filter(
        (delegation) =>
          delegation.domain_ref && sameRef(delegation.domain_ref, domain),
      );
      const scopes = [...new Set(
        domainDelegations
          .map((delegation) => delegation.authority_scope)
          .filter((scope): scope is string => typeof scope === "string" && scope.length > 0),
      )].sort();

      if (
        anchor?.artifact_type !== "trust_anchor" ||
        !rootRef ||
        rootActor?.artifact_type !== "actor"
      ) {
        evidence.push({
          ok: false,
          value: {
            evidence_id: `evidence-ACT-21-I5-${domain.artifact_id}-root`,
            rule_id: "ACT-21-I5",
            artifact_ref: {
              artifact_id: domain.artifact_id,
              artifact_type: domain.artifact_type,
            },
            observation: "trust domain lacks a resolvable trust-anchor root actor",
            created_at: "",
          },
        });
        continue;
      }

      if (scopes.length === 0) {
        evidence.push({
          ok: true,
          value: {
            evidence_id: `evidence-ACT-21-I5-${domain.artifact_id}-empty`,
            rule_id: "ACT-21-I5",
            artifact_ref: {
              artifact_id: domain.artifact_id,
              artifact_type: domain.artifact_type,
            },
            observation: "trust domain has no delegation edges; graph is trivially deterministic",
            created_at: "",
          },
        });
        continue;
      }

      for (const scope of scopes) {
        const edges = domainDelegations
          .filter((delegation) => delegation.authority_scope === scope)
          .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));

        let graphValid = true;
        let failure = "";

        for (const edge of edges) {
          if (
            !edge.from_actor_ref ||
            !edge.to_actor_ref ||
            !intervalIsWellFormed(edge) ||
            context.resolve(edge.from_actor_ref)?.artifact_type !== "actor" ||
            context.resolve(edge.to_actor_ref)?.artifact_type !== "actor"
          ) {
            graphValid = false;
            failure = "delegation edge is unresolved or has an invalid validity interval";
            break;
          }
        }

        const adjacency = new Map<string, typeof edges>();
        if (graphValid) {
          for (const edge of edges) {
            const key = refKey(edge.from_actor_ref!);
            const current = adjacency.get(key) ?? [];
            current.push(edge);
            adjacency.set(key, current);
          }

          const rootKey = refKey(rootRef);
          const pathCounts = new Map<string, number>();
          const walk = (
            actorKey: string,
            visited: ReadonlySet<string>,
          ): void => {
            if (!graphValid) return;
            for (const edge of adjacency.get(actorKey) ?? []) {
              const nextKey = refKey(edge.to_actor_ref!);
              if (visited.has(nextKey)) {
                graphValid = false;
                failure = "delegation graph contains a reachable cycle";
                return;
              }
              const count = (pathCounts.get(nextKey) ?? 0) + 1;
              pathCounts.set(nextKey, count);
              if (count > 1) {
                graphValid = false;
                failure = "delegation graph contains multiple paths to the same actor";
                return;
              }
              walk(nextKey, new Set([...visited, nextKey]));
              if (!graphValid) return;
            }
          };
          walk(rootKey, new Set([rootKey]));
        }

        evidence.push({
          ok: graphValid,
          value: {
            evidence_id: `evidence-ACT-21-I5-${domain.artifact_id}-${scope}`,
            rule_id: "ACT-21-I5",
            artifact_ref: {
              artifact_id: domain.artifact_id,
              artifact_type: domain.artifact_type,
            },
            observation: graphValid
              ? `delegation graph for scope '${scope}' is resolvable, acyclic and has at most one root path per actor`
              : failure,
            created_at: "",
          },
        });
      }
    }

    return {
      rule_id: "ACT-21-I5",
      passed: evidence.every((entry) => entry.ok),
      evidence: evidence.map((entry) => entry.value),
    };
  },
};
