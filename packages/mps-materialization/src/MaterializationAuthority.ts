/**
 * MIMER-MAT-I01 — Materialization Authority Boundary (FROZEN)
 *
 * Only Materialization Pipeline MAY create DecisionImpactArtifact authority state.
 * Retrieval, UI, AI, and runtime components SHALL NOT create or mutate Decision Truth artifacts.
 *
 * Forbidden: Chat Agent → DecisionImpactArtifact (create/mutate)
 * Allowed:   Chat Agent → DecisionImpactArtifact (read) → Answer
 */

export const MIMER_MAT_I01 = "MIMER-MAT-I01" as const;

/** Components that MAY create DecisionImpact authority. */
export const MATERIALIZATION_AUTHORITY_CREATORS = Object.freeze([
  "MaterializationPipeline",
  "mps-materialization",
] as const);

/** Components that MUST NOT create or mutate Decision Truth. */
export const MATERIALIZATION_AUTHORITY_FORBIDDEN = Object.freeze([
  "ChatAgent",
  "LLM",
  "Retrieval",
  "QueryPlanner",
  "UI",
  "Runtime",
  "mps-retrieval",
] as const);

export type AuthorityActor =
  | (typeof MATERIALIZATION_AUTHORITY_CREATORS)[number]
  | (typeof MATERIALIZATION_AUTHORITY_FORBIDDEN)[number]
  | string;

export class MaterializationAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MaterializationAuthorityError";
  }
}

/**
 * Gate for any write path into Decision Truth CAS.
 * Call before putImpact / putEvidenceSet from non-pipeline surfaces.
 */
export function assertMaterializationAuthority(actor: AuthorityActor): void {
  const allowed = (MATERIALIZATION_AUTHORITY_CREATORS as readonly string[]).includes(
    actor,
  );
  if (!allowed) {
    throw new MaterializationAuthorityError(
      "MIMER_MAT_I01_VIOLATION",
      `${MIMER_MAT_I01}: actor '${actor}' SHALL NOT create or mutate Decision Truth artifacts`,
    );
  }
}
