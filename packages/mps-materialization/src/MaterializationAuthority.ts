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

/**
 * MAT-I05 — Single Materialization Authority (FROZEN)
 *
 * Only registered MaterializationPipeline implementations SHALL create
 * DecisionImpactArtifact authority.
 *
 * MIMER-MAT-I01 answers "which actor may write". MAT-I05 answers the deeper
 * question "which code path is allowed to exist as a truth producer at all".
 */
export const MAT_I05 = "MAT-I05" as const;

export type MaterializationAuthorityRegistration = {
  /** Stable implementation id used at every write boundary. */
  readonly id: string;
  readonly package: string;
  /** Adding a truth producer is an architectural act and requires an ADR. */
  readonly adr: string;
};

export const CANONICAL_MATERIALIZATION_AUTHORITY: MaterializationAuthorityRegistration =
  Object.freeze({
    id: "MaterializationPipeline",
    package: "mps-materialization",
    adr: "ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY",
  });

const REGISTERED_AUTHORITIES = new Map<string, MaterializationAuthorityRegistration>([
  [CANONICAL_MATERIALIZATION_AUTHORITY.id, CANONICAL_MATERIALIZATION_AUTHORITY],
]);

export function registerMaterializationAuthority(
  registration: MaterializationAuthorityRegistration,
): void {
  if (!registration.adr || registration.adr.trim().length === 0) {
    throw new MaterializationAuthorityError(
      "MAT_I05_UNDOCUMENTED_AUTHORITY",
      `${MAT_I05}: registering '${registration.id}' as a truth producer requires an ADR reference`,
    );
  }

  const existing = REGISTERED_AUTHORITIES.get(registration.id);
  if (existing && existing.package !== registration.package) {
    throw new MaterializationAuthorityError(
      "MAT_I05_AUTHORITY_CONFLICT",
      `${MAT_I05}: '${registration.id}' is already registered by ${existing.package}`,
    );
  }

  REGISTERED_AUTHORITIES.set(registration.id, Object.freeze({ ...registration }));
}

export function listMaterializationAuthorities(): readonly MaterializationAuthorityRegistration[] {
  return Object.freeze([...REGISTERED_AUTHORITIES.values()]);
}

export function isRegisteredMaterializationAuthority(id: string | undefined): boolean {
  return id !== undefined && REGISTERED_AUTHORITIES.has(id);
}

/**
 * Gate for every write path that produces DecisionImpactArtifact authority,
 * including paths that live outside mps-materialization.
 */
export function assertSingleMaterializationAuthority(id: string | undefined): void {
  if (isRegisteredMaterializationAuthority(id)) return;

  throw new MaterializationAuthorityError(
    "MAT_I05_UNREGISTERED_AUTHORITY",
    `${MAT_I05}: '${id ?? "anonymous"}' is not a registered materialization authority; ` +
      `Decision Truth SHALL be created only by ${[...REGISTERED_AUTHORITIES.keys()].join(", ")}`,
  );
}
