/**
 * C6 -- generation posture (contract 5.3), fixed order:
 *   1. observation (absent = unresolved), evidence hash, strict payload, same tree
 *   2. common: no non-literal dynamic import, the booted entrypoint set is the derived set, at least one entrypoint,
 *      every entrypoint booted under the production profile
 *   3. DECLARED_ABSENT: the owner policy must admit absence; no registration identifier in non-test source; no
 *      entrypoint registered after boot; every attempt failed closed with exactly the port's status
 *   4. BOUND: port blob, a registration site, a registered entrypoint, every registered runtime equals the manifest on
 *      all seven identity fields, every other entrypoint failed closed; then the mock/test deny patterns; then the
 *      closed registry (empty = unresolved, no equal entry = mismatch)
 *
 * Test and mock registrations are never counted (`test_registration_files` is audit only).
 */
import { FAILURE, GENERATION_FAIL_CLOSED_STATUS } from '../vocabulary';
import { tryHashJcs } from '../canonical';
import { RUNTIME_IDENTITY_FIELDS, validateGenerationDerivation, type BootEntrypoint, type GenerationDerivation, type RuntimeIdentity } from '../evidenceSchemas';
import { looksLikeMockRuntime } from '../identityScan';
import { unwrapPayload, type StageContext } from './context';

const failedClosed = (e: BootEntrypoint): boolean => e.generate_attempt.outcome === 'FAIL_CLOSED' && e.generate_attempt.code === GENERATION_FAIL_CLOSED_STATUS;

const sameRuntime = (a: RuntimeIdentity, b: RuntimeIdentity): boolean => RUNTIME_IDENTITY_FIELDS.every((f) => a[f] === b[f]);

export function checkGeneration(ctx: StageContext): string | undefined {
  const { manifest, policy, observations } = ctx;
  const claim = manifest.generation;

  // 1.
  const found = unwrapPayload(observations, 'generation');
  if (found.kind === 'absent') return FAILURE.generation_identity_unresolved;
  if (found.kind === 'malformed') return FAILURE.evidence_schema_invalid;
  const payload = found.payload;
  const hash = tryHashJcs(payload);
  if (hash === undefined) return FAILURE.evidence_schema_invalid;
  if (hash !== claim.evidence_sha256) return FAILURE.manifest_hash_mismatch;
  if (!validateGenerationDerivation(payload)) return FAILURE.evidence_schema_invalid;
  const d: GenerationDerivation = payload;
  if (d.subject.tree_sha !== manifest.candidate.tree_sha) return FAILURE.tree_binding_mismatch;

  // 2.
  const entrypoints = d.boot_probe.entrypoints;
  if (
    d.static_census.nonliteral_dynamic_imports !== 0 ||
    d.entrypoint_set.claimed_sha256 !== d.entrypoint_set.derived_sha256 ||
    entrypoints.length === 0 ||
    !entrypoints.every((e) => e.node_env === 'production')
  ) {
    return FAILURE.generation_identity_mismatch;
  }

  // 3.
  if (claim.posture === 'DECLARED_ABSENT') {
    if (policy.generation_requirement === 'BOUND_REQUIRED') return FAILURE.generation_identity_unresolved;
    if (d.static_census.registration_identifier_files !== 0) return FAILURE.generation_identity_mismatch;
    if (entrypoints.some((e) => e.registered_after_boot)) return FAILURE.generation_identity_mismatch;
    if (!entrypoints.every(failedClosed)) return FAILURE.generation_identity_mismatch;
    return undefined;
  }

  // 4.
  if (d.port.source_blob_sha1 !== claim.port_source_blob_sha1 || d.static_census.registration_identifier_files < 1) {
    return FAILURE.generation_identity_mismatch;
  }
  const registered = entrypoints.filter((e) => e.registered_after_boot);
  if (registered.length === 0) return FAILURE.generation_identity_mismatch;
  const bound: RuntimeIdentity = {
    runtime_id: claim.runtime_id,
    runtime_implementation_sha256: claim.runtime_implementation_sha256,
    runtime_config_sha256: claim.runtime_config_sha256,
    model_id: claim.model_id,
    model_version: claim.model_version,
    model_snapshot_manifest_sha256: claim.model_snapshot_manifest_sha256,
    generation_contract_version: claim.generation_contract_version,
  };
  if (!registered.every((e) => e.runtime !== undefined && sameRuntime(e.runtime, bound))) return FAILURE.generation_identity_mismatch;
  if (!entrypoints.filter((e) => !e.registered_after_boot).every(failedClosed)) return FAILURE.generation_identity_mismatch;
  // a hostile or mistaken registry entry must not launder a test runtime: deny patterns come before the registry
  if (looksLikeMockRuntime(claim.runtime_id) || looksLikeMockRuntime(claim.model_id)) return FAILURE.generation_runtime_not_production;
  if (d.registry.runtimes.length === 0) return FAILURE.generation_identity_unresolved;
  if (!d.registry.runtimes.some((r) => sameRuntime(r, bound))) return FAILURE.generation_identity_mismatch;
  return undefined;
}
