/**
 * RetrievalPolicyRegistry — versionable policy catalog.
 */

import type { QueryType } from "./ArtifactAccessRules.js";
import { RetrievalGovernanceError } from "./ArtifactAccessRules.js";
import {
  buildRetrievalPolicy,
  RETRIEVAL_POLICY_VERSION,
  type RetrievalPolicy,
} from "./RetrievalPolicy.js";

export type RetrievalPolicyRegistration = {
  readonly policy_id: string;
  readonly policy_version: string;
  readonly query_type: QueryType;
  readonly policy: RetrievalPolicy;
};

export interface RetrievalPolicyRegistry {
  readonly registry_version: string;
  resolve(query_type: QueryType): RetrievalPolicy;
  resolveById(policy_id: string): RetrievalPolicyRegistration;
  list(): readonly RetrievalPolicyRegistration[];
}

const DEFAULT_QUERY_TYPES: readonly QueryType[] = [
  "GENERAL",
  "DECISION_SUMMARY",
  "EVIDENCE_EXPANSION",
  "PROVENANCE_AUDIT",
];

export function createRetrievalPolicyRegistry(
  policy_version: string = RETRIEVAL_POLICY_VERSION,
  query_types: readonly QueryType[] = DEFAULT_QUERY_TYPES,
): RetrievalPolicyRegistry {
  const regs: RetrievalPolicyRegistration[] = query_types.map((query_type) => {
    const policy = buildRetrievalPolicy(query_type, policy_version);
    return Object.freeze({
      policy_id: `${policy_version}:${query_type}`,
      policy_version,
      query_type,
      policy,
    });
  });

  const byType = new Map(regs.map((r) => [r.query_type, r]));
  const byId = new Map(regs.map((r) => [r.policy_id, r]));

  return Object.freeze({
    registry_version: policy_version,
    resolve(query_type: QueryType): RetrievalPolicy {
      const found = byType.get(query_type);
      if (!found) {
        throw new RetrievalGovernanceError(
          "RETRIEVAL_POLICY_UNKNOWN",
          `No policy for query_type=${query_type}`,
        );
      }
      return found.policy;
    },
    resolveById(policy_id: string): RetrievalPolicyRegistration {
      const found = byId.get(policy_id);
      if (!found) {
        throw new RetrievalGovernanceError(
          "RETRIEVAL_POLICY_UNKNOWN",
          `Unknown policy_id=${policy_id}`,
        );
      }
      return found;
    },
    list(): readonly RetrievalPolicyRegistration[] {
      return Object.freeze([...regs]);
    },
  });
}

export const defaultRetrievalPolicyRegistry = createRetrievalPolicyRegistry();
