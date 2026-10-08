/**
 * The freeze policy `u51-freeze-policy-1` (contract 7.3): strict validation (C0). An owner-authored artifact; every
 * omission is a denial, never a default. This module only validates the SHAPE -- it contains no policy value.
 */
import {
  GENERATION_REQUIREMENTS,
  MIGRATION_CHECK_BINDINGS,
  ORIGIN_REQUIREMENTS,
  POLICY_CONTRACT_VERSION,
  RULE_SCOPES,
  SCAN_PROFILES,
} from './vocabulary';
import { HEX40, HEX64, IDENTIFIER, compareBytewise, hasExactKeys, isNonEmptyString, isRecord, isStringArray, strictlyAscending, type Rec } from './json';

export interface GuardRule {
  readonly id: string;
  readonly applies_to: string;
}
export interface RequiredTest {
  readonly file: string;
  readonly full_name: string;
}
export interface AcceptedGuard {
  readonly blob_sha1: string;
  readonly command_sha256: string;
  readonly scan_roots: readonly string[];
  readonly allow_patterns: readonly string[];
  readonly rules: readonly GuardRule[];
  readonly required_tests: readonly RequiredTest[];
}
export interface VerifierIdentity {
  readonly verifier_version: string;
  readonly implementation_tree_sha1: string;
}
export interface FreezePolicy {
  readonly contract_version: string;
  readonly accepted_guards: readonly AcceptedGuard[];
  readonly required_scan_profile: string;
  readonly dependency_scan: { readonly manifests: readonly string[]; readonly forbidden_package_patterns: readonly string[] };
  readonly generation_requirement: string;
  readonly migration_check_binding: string;
  readonly origin_requirement: string;
  readonly accepted_release_contract_versions: readonly string[];
  readonly forbidden_identity_patterns: readonly string[];
  readonly accepted_verifiers: readonly VerifierIdentity[];
}

const oneOf = (allowed: readonly string[], v: unknown): boolean => typeof v === 'string' && allowed.includes(v);
const identity = (s: string): string => s;
const sortedUniqueStrings = (v: unknown): v is string[] => isStringArray(v) && v.every(isNonEmptyString) && strictlyAscending(v, identity);

function validGuard(g: unknown): g is AcceptedGuard {
  if (!isRecord(g)) return false;
  if (!hasExactKeys(g, ['blob_sha1', 'command_sha256', 'scan_roots', 'allow_patterns', 'rules', 'required_tests'])) return false;
  if (typeof g.blob_sha1 !== 'string' || !HEX40.test(g.blob_sha1)) return false;
  if (typeof g.command_sha256 !== 'string' || !HEX64.test(g.command_sha256)) return false;
  if (!sortedUniqueStrings(g.scan_roots) || !sortedUniqueStrings(g.allow_patterns)) return false;
  if (!Array.isArray(g.rules) || !g.rules.every((r) => isRecord(r) && hasExactKeys(r, ['id', 'applies_to']) && isNonEmptyString(r.id) && oneOf(RULE_SCOPES, r.applies_to))) return false;
  if (!strictlyAscending(g.rules as Rec[], (r) => r.id as string)) return false;
  if (!Array.isArray(g.required_tests)) return false;
  if (!g.required_tests.every((t) => isRecord(t) && hasExactKeys(t, ['file', 'full_name']) && isNonEmptyString(t.file) && isNonEmptyString(t.full_name))) return false;
  const tests = g.required_tests as Rec[];
  for (let i = 1; i < tests.length; i += 1) {
    const a = tests[i - 1]!;
    const b = tests[i]!;
    const order = compareBytewise(a.file as string, b.file as string) || compareBytewise(a.full_name as string, b.full_name as string);
    if (order >= 0) return false;
  }
  return true;
}

function validVerifier(v: unknown): v is VerifierIdentity {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['verifier_version', 'implementation_tree_sha1']) &&
    typeof v.verifier_version === 'string' &&
    IDENTIFIER.test(v.verifier_version) &&
    typeof v.implementation_tree_sha1 === 'string' &&
    HEX40.test(v.implementation_tree_sha1)
  );
}

/** Returns the typed policy, or undefined when it is malformed (unknown key, unsorted/duplicate set, bad enum, missing key). */
export function parseFreezePolicy(policy: unknown): FreezePolicy | undefined {
  if (!isRecord(policy)) return undefined;
  const keys = [
    'contract_version',
    'accepted_guards',
    'required_scan_profile',
    'dependency_scan',
    'generation_requirement',
    'migration_check_binding',
    'origin_requirement',
    'accepted_release_contract_versions',
    'forbidden_identity_patterns',
    'accepted_verifiers',
  ];
  if (!hasExactKeys(policy, keys)) return undefined;
  if (policy.contract_version !== POLICY_CONTRACT_VERSION) return undefined;
  if (!Array.isArray(policy.accepted_guards) || !policy.accepted_guards.every(validGuard)) return undefined;
  if (!strictlyAscending(policy.accepted_guards as AcceptedGuard[], (g) => g.blob_sha1)) return undefined;
  if (!oneOf(SCAN_PROFILES, policy.required_scan_profile)) return undefined;
  const dep = policy.dependency_scan;
  if (!isRecord(dep) || !hasExactKeys(dep, ['manifests', 'forbidden_package_patterns'])) return undefined;
  if (!sortedUniqueStrings(dep.manifests) || !sortedUniqueStrings(dep.forbidden_package_patterns)) return undefined;
  if (!oneOf(GENERATION_REQUIREMENTS, policy.generation_requirement)) return undefined;
  if (!oneOf(MIGRATION_CHECK_BINDINGS, policy.migration_check_binding)) return undefined;
  if (!oneOf(ORIGIN_REQUIREMENTS, policy.origin_requirement)) return undefined;
  if (!sortedUniqueStrings(policy.accepted_release_contract_versions)) return undefined;
  if (!sortedUniqueStrings(policy.forbidden_identity_patterns)) return undefined;
  if (!Array.isArray(policy.accepted_verifiers) || !policy.accepted_verifiers.every(validVerifier)) return undefined;
  if (!strictlyAscending(policy.accepted_verifiers as VerifierIdentity[], (v) => v.implementation_tree_sha1)) return undefined;
  return policy as unknown as FreezePolicy;
}

export function verifierAccepted(policy: FreezePolicy, verifier: unknown): boolean {
  if (!validVerifier(verifier)) return false;
  return policy.accepted_verifiers.some(
    (a) => a.verifier_version === verifier.verifier_version && a.implementation_tree_sha1 === verifier.implementation_tree_sha1,
  );
}
