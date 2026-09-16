import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import type { ArtifactReference } from "../artifacts/ArtifactReference";
import type { ArtifactContract } from "../artifacts/ArtifactContract";
import type { ContentHash } from "../artifacts/ContentHash";

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

type TimeInterval = {
  readonly start: number;
  readonly end: number;
};

function delegationInterval(delegation: DelegationShape): TimeInterval | null {
  if (!delegation.valid_from) return null;
  const start = Date.parse(delegation.valid_from);
  if (Number.isNaN(start)) return null;

  const end =
    delegation.valid_until === undefined
      ? Number.POSITIVE_INFINITY
      : Date.parse(delegation.valid_until);

  if (Number.isNaN(end) || end <= start) return null;
  return { start, end };
}

function intersectIntervals(
  left: TimeInterval,
  right: TimeInterval,
): TimeInterval | null {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start < end ? { start, end } : null;
}

function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

/**
 * ACT-21-I5 has no evaluation timestamp in ValidationContext. This validator
 * therefore proves the stronger time-parametric invariant:
 *
 *   for every instant at which authority could be resolved, the active
 *   root-reachable graph has no cycle and at most one root path per actor.
 *
 * Non-overlapping historical/future delegations are not ambiguous, because no
 * single T_decision can activate both paths. Runtime authorization still
 * evaluates the concrete T_decision.
 */
export const ACT_21_I5: ValidationRule = {
  rule_id: "ACT-21-I5",
  implementation_hash: "act-21-i5-temporal-deterministic-closure-v3",
  description:
    "Trust delegation is deterministic at every evaluation instant: resolvable, temporally acyclic and unambiguous",

  validate(context: ValidationContext) {
    const domains = context.artifacts.filter(
      (artifact) => artifact.artifact_type === "trust_domain",
    );
    const delegations = context.artifacts.filter(
      (artifact) => artifact.artifact_type === "trust_delegation",
    ) as readonly (ArtifactContract & DelegationShape)[];

    if (domains.length === 0) {
      return {
        rule_id: "ACT-21-I5",
        passed: false,
        evidence: [],
      };
    }

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

    for (const delegation of delegations) {
      if (
        !delegation.from_actor_ref ||
        !delegation.to_actor_ref ||
        !delegation.domain_ref ||
        typeof delegation.authority_scope !== "string" ||
        delegation.authority_scope.length === 0 ||
        !delegationInterval(delegation) ||
        context.resolve(delegation.from_actor_ref)?.artifact_type !== "actor" ||
        context.resolve(delegation.to_actor_ref)?.artifact_type !== "actor" ||
        context.resolve(delegation.domain_ref)?.artifact_type !== "trust_domain"
      ) {
        evidence.push({
          ok: false,
          value: {
            evidence_id: `evidence-ACT-21-I5-${delegation.artifact_id}-shape`,
            rule_id: "ACT-21-I5",
            artifact_ref: {
              artifact_id: delegation.artifact_id,
              artifact_type: delegation.artifact_type,
            },
            observation:
              "delegation edge is unresolved, references a missing trust domain, lacks scope, or has an invalid validity interval",
            created_at: "",
          },
        });
      }
    }

    for (const domain of domains) {
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
      const rootRef = shapedAnchor?.root_actor_ref;
      const rootActor = rootRef ? context.resolve(rootRef) : undefined;

      if (
        anchor?.artifact_type !== "trust_anchor" ||
        !rootRef ||
        !shapedAnchor?.root_actor_hash ||
        rootActor?.artifact_type !== "actor" ||
        rootActor.content_hash.algorithm !== shapedAnchor.root_actor_hash.algorithm ||
        rootActor.content_hash.value !== shapedAnchor.root_actor_hash.value
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
            observation:
              "trust domain lacks exactly one resolvable, hash-bound trust-anchor root actor",
            created_at: "",
          },
        });
        continue;
      }

      const domainDelegations = delegations.filter(
        (delegation) =>
          delegation.domain_ref &&
          sameRef(delegation.domain_ref, domain) &&
          delegationInterval(delegation) !== null,
      );
      const scopes = [
        ...new Set(
          domainDelegations
            .map((delegation) => delegation.authority_scope)
            .filter(
              (scope): scope is string =>
                typeof scope === "string" && scope.length > 0,
            ),
        ),
      ].sort();

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
            observation:
              "trust domain has no valid delegation edges; root-only closure is deterministic",
            created_at: "",
          },
        });
        continue;
      }

      for (const scope of scopes) {
        const edges = domainDelegations
          .filter((delegation) => delegation.authority_scope === scope)
          .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));

        const adjacency = new Map<string, typeof edges>();
        for (const edge of edges) {
          const key = refKey(edge.from_actor_ref!);
          const current = adjacency.get(key) ?? [];
          current.push(edge);
          adjacency.set(key, current);
        }

        let graphValid = true;
        let failure = "";
        const rootKey = refKey(rootRef);
        const reached = new Map<string, TimeInterval[]>();

        const walk = (
          actorKey: string,
          activeInterval: TimeInterval,
          pathActors: ReadonlySet<string>,
        ): void => {
          if (!graphValid) return;

          for (const edge of adjacency.get(actorKey) ?? []) {
            const interval = delegationInterval(edge)!;
            const pathInterval = intersectIntervals(activeInterval, interval);
            if (!pathInterval) {
              continue;
            }

            const nextKey = refKey(edge.to_actor_ref!);
            if (pathActors.has(nextKey)) {
              graphValid = false;
              failure =
                "delegation graph contains a root-reachable cycle active at some evaluation instant";
              return;
            }

            const priorPaths = reached.get(nextKey) ?? [];
            if (priorPaths.some((prior) => intervalsOverlap(prior, pathInterval))) {
              graphValid = false;
              failure =
                "delegation graph contains multiple root paths to the same actor active at the same evaluation instant";
              return;
            }
            reached.set(nextKey, [...priorPaths, pathInterval]);

            walk(
              nextKey,
              pathInterval,
              new Set([...pathActors, nextKey]),
            );
            if (!graphValid) return;
          }
        };

        walk(
          rootKey,
          {
            start: Number.NEGATIVE_INFINITY,
            end: Number.POSITIVE_INFINITY,
          },
          new Set([rootKey]),
        );

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
              ? `delegation graph for scope '${scope}' is deterministic for every evaluation instant`
              : failure,
            created_at: "",
          },
        });
      }
    }

    return {
      rule_id: "ACT-21-I5",
      passed: evidence.length > 0 && evidence.every((entry) => entry.ok),
      evidence: evidence.map((entry) => entry.value),
    };
  },
};
