import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";

/**
 * LU-EXECUTION-IDENTITY-SCOPE-V2 (OWNER FREEZE 2026-08-21).
 *
 * V1 scoped `ExecutionIdentityArtifact.artifact_id` by `site_id` alone
 * (`"lu-identity-" + site_id`) -- invalidated by a demonstrated WORM collision during
 * LU-SPATIAL-COORDINATE-ORDER-CORRECTION-01: the same site legitimately needs a new immutable
 * execution identity whenever the canonical execution context it was issued against
 * (`project_context_binding_ref`) or the product release it executed under changes, and V1 could
 * mint only one identity per site, ever.
 *
 * V2 scopes identity by the full canonical execution subject instead. This is a distinct axis
 * from `execution_contract_version` (the LU business execution contract's own version, e.g.
 * "lu-execution-identity-v1" -- see LuExecutionIdentitySeed.ts) which is carried INSIDE the V2
 * subject as one of its fields; do not confuse the two similarly-named things.
 */
export const LU_EXECUTION_IDENTITY_SCOPE_V1 = "lu-execution-identity-scope-v1" as const;
export const LU_EXECUTION_IDENTITY_SCOPE_V2 = "lu-execution-identity-scope-v2" as const;

export type ExecutionIdentityScopeVersion =
  | typeof LU_EXECUTION_IDENTITY_SCOPE_V1
  | typeof LU_EXECUTION_IDENTITY_SCOPE_V2
  | typeof LU_EXECUTION_IDENTITY_SCOPE_V3;

export interface ExecutionIdentitySubjectV2 {
  readonly site_id: string;
  readonly project_context_binding_ref: ArtifactReference;
  readonly product_release_ref: ArtifactReference;
  readonly execution_contract_version: string;
}

/**
 * Deterministic derivation only -- never current time, a UUID, a process id, random bytes,
 * insertion order, or a caller-selected suffix. Reuses the repo's one canonical hash pipeline
 * (RFC8785 -> UTF-8 -> SHA-256, `sha256ContentHash`), not a competing canonicalization format.
 *
 * `same site + same binding + same release + same execution contract -> same artifact_id`,
 * because this is a pure function of exactly those four inputs and nothing else.
 */
export function computeExecutionIdentityArtifactIdV2(subject: ExecutionIdentitySubjectV2): string {
  const hash = sha256ContentHash({
    contract: LU_EXECUTION_IDENTITY_SCOPE_V2,
    site_id: subject.site_id,
    project_context_binding_ref: subject.project_context_binding_ref,
    product_release_ref: subject.product_release_ref,
    execution_contract_version: subject.execution_contract_version,
  });
  return `lu-identity-v2-${hash.value}`;
}

/** The legacy V1 derivation, kept only so verification can recognize a genuine V1 artifact_id. */
export function computeExecutionIdentityArtifactIdV1(site_id: string): string {
  return `lu-identity-${site_id}`;
}

/**
 * LU-MANIFEST-WORM-IDEMPOTENCY-01 (OWNER FREEZE 2026-08-22).
 *
 * `FrozenExecutionManifestIdentity.manifest_id` was scoped by `site_id` alone
 * (`"lu-manifest-" + site_id`, see LuExecutionKernelClient.ts) -- the exact same defect V2 already
 * fixed for ExecutionIdentity above, just never carried over to the manifest. A manifest's
 * `content_hash` is (correctly) a function of the full execution subject via
 * `deriveLuExecutionSeed`, including `project_context_binding_ref` and `product_release_ref` --
 * so a legitimate binding supersession or release change produces a different `content_hash`
 * under the SAME site-only `manifest_id`, and CAS's WORM guard (correctly) refuses the second
 * write as a collision rather than silently accepting drifted content under one id.
 *
 * Scoping `manifest_id` by the same four-field V2 subject as ExecutionIdentity makes the two
 * axes agree: same subject -> same manifest_id -> same content_hash (idempotent, no WORM
 * violation); a legitimately different subject (new binding, new release) -> a different
 * manifest_id, so it simply never collides with the old one. The old, now-orphaned manifest
 * under the previous id remains exactly as it was -- this never rewrites or removes it.
 */
export function computeExecutionManifestIdV2(subject: ExecutionIdentitySubjectV2): string {
  const hash = sha256ContentHash({
    contract: "lu-manifest-scope-v2",
    site_id: subject.site_id,
    project_context_binding_ref: subject.project_context_binding_ref,
    product_release_ref: subject.product_release_ref,
    execution_contract_version: subject.execution_contract_version,
  });
  return `lu-manifest-v2-${hash.value}`;
}

/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 (OWNER FREEZE 2026-08-22).
 *
 * V2 scoped identity by property + project + release + contract version -- but `site_id` there is,
 * in every real production caller, the PROPERTY's own cadastral identity
 * (`property_identity`), never a specific location within or beyond it. This conflated "which
 * property" with "what is actually being assessed": the same property legitimately needs a new
 * immutable execution identity whenever the explicit location being assessed
 * (`localization_geometry_ref`) changes, exactly the same reasoning V2 already applied to binding
 * and release changes -- and V2 could mint only one identity per (property, binding, release,
 * contract) tuple, ever, regardless of where on/near the property the user actually meant.
 *
 * V3 adds `localization_geometry_ref` as a fifth axis alongside V2's four, never replacing or
 * modifying them (V1 and V2 stay exactly as frozen). `same property + same binding + same release
 * + same contract + DIFFERENT localization point -> DIFFERENT identity`, by construction: a moved
 * point can never silently reuse the old identity/manifest/evidence/assessment just because the
 * underlying property is unchanged.
 */
export const LU_EXECUTION_IDENTITY_SCOPE_V3 = "lu-execution-identity-scope-v3" as const;

export interface ExecutionIdentitySubjectV3 extends ExecutionIdentitySubjectV2 {
  readonly localization_geometry_ref: ArtifactReference;
}

/**
 * `same property + same binding + same release + same contract + same localization point ->
 * same artifact_id`, because this is a pure function of exactly those five inputs and nothing
 * else -- same determinism guarantee as V2's derivation.
 */
export function computeExecutionIdentityArtifactIdV3(subject: ExecutionIdentitySubjectV3): string {
  const hash = sha256ContentHash({
    contract: LU_EXECUTION_IDENTITY_SCOPE_V3,
    site_id: subject.site_id,
    project_context_binding_ref: subject.project_context_binding_ref,
    product_release_ref: subject.product_release_ref,
    execution_contract_version: subject.execution_contract_version,
    localization_geometry_ref: subject.localization_geometry_ref,
  });
  return `lu-identity-v3-${hash.value}`;
}

/** Same reasoning as computeExecutionManifestIdV2 -- manifest_id must scope by the same subject as content_hash. */
export function computeExecutionManifestIdV3(subject: ExecutionIdentitySubjectV3): string {
  const hash = sha256ContentHash({
    contract: "lu-manifest-scope-v3",
    site_id: subject.site_id,
    project_context_binding_ref: subject.project_context_binding_ref,
    product_release_ref: subject.product_release_ref,
    execution_contract_version: subject.execution_contract_version,
    localization_geometry_ref: subject.localization_geometry_ref,
  });
  return `lu-manifest-v3-${hash.value}`;
}
