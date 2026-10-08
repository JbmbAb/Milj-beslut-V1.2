/**
 * The pure verifier core `evaluateU51Manifest` (contract 11.1): C0..C8, no IO.
 *
 * The first failing check ends evaluation; every later check is NOT_EXECUTED (7.2). A comparison that could not be
 * made because a caller-supplied input is absent (the expected manifest hash) is NOT_EXECUTED and the overall result
 * is NOT_EXECUTED, never PASS. A core PASS is NOT "freeze eligible": that needs the runner's C9 and C10.
 */
import { bytesEqual, canonicalizeManifest, hashJcs } from './canonical';
import { checkBinding } from './checks/binding';
import { checkEmbedding } from './checks/embedding';
import { checkGeneration } from './checks/generation';
import { checkSchemaParity } from './checks/schemaParity';
import { checkZeroGoogle } from './checks/zeroGoogle';
import type { StageContext } from './checks/context';
import { validateManifestSchema } from './manifestSchema';
import { parseFreezePolicy, verifierAccepted, type FreezePolicy } from './policy';
import { parseStrictJsonBytes } from './strictJson';
import { HEX64, hasExactKeys, isRecord, type Rec } from './json';
import type { CheckRecord, EvaluateInput, Evaluation, Manifest } from './types';
import { CORE_STAGES, FAILURE, type CheckVerdict, type CoreStageId } from './vocabulary';

export { canonicalizeManifest };

type StageOutcome = { readonly verdict: 'PASS' } | { readonly verdict: 'FAIL'; readonly code: string } | { readonly verdict: 'NOT_EXECUTED' };

const pass = (): StageOutcome => ({ verdict: 'PASS' });
const fail = (code: string): StageOutcome => ({ verdict: 'FAIL', code });
const fromCode = (code: string | undefined): StageOutcome => (code === undefined ? pass() : fail(code));

interface State {
  policy?: FreezePolicy;
  parsed?: unknown;
  manifest?: Manifest;
  regenerated?: { bytes: Uint8Array; sha256: string };
}

function policyAuthenticated(authentication: unknown, policy: FreezePolicy): boolean {
  if (!isRecord(authentication) || !hasExactKeys(authentication, ['policy_sha256', 'verified', 'trust_root_ref'])) return false;
  return (
    authentication.verified === true &&
    typeof authentication.trust_root_ref === 'string' &&
    authentication.trust_root_ref.length > 0 &&
    typeof authentication.policy_sha256 === 'string' &&
    authentication.policy_sha256 === hashJcs(policy)
  );
}

/** C0 -- policy valid, authenticated; verifier accepted; strict byte intake (in this order). */
function stageC0(input: EvaluateInput, state: State): StageOutcome {
  const policy = parseFreezePolicy(input.policy);
  if (policy === undefined) return fail(FAILURE.policy_invalid);
  state.policy = policy;
  if (!policyAuthenticated(input.policy_authentication, policy)) return fail(FAILURE.policy_unauthenticated);
  if (!verifierAccepted(policy, input.verifier)) return fail(FAILURE.verifier_identity_unaccepted);
  const parsed = parseStrictJsonBytes(input.manifest_bytes);
  if (!parsed.ok) return fail(FAILURE.canonicalization_failure);
  state.parsed = parsed.value;
  return pass();
}

function stageC1(state: State): StageOutcome {
  const result = validateManifestSchema(state.parsed, state.policy!.forbidden_identity_patterns);
  if (result.ok === false) return fail(result.code);
  state.manifest = result.manifest as unknown as Manifest;
  return pass();
}

function contextOf(input: EvaluateInput, state: State): StageContext | undefined {
  if (!isRecord(input.observations)) return undefined;
  return { manifest: state.manifest!, policy: state.policy!, observations: input.observations as Rec };
}

/** C7 -- the stored form IS the canonical form. */
function stageC7(input: EvaluateInput, state: State): StageOutcome {
  state.regenerated = canonicalizeManifest(state.parsed);
  return bytesEqual(state.regenerated.bytes, input.manifest_bytes) ? pass() : fail(FAILURE.canonicalization_failure);
}

/** C8 -- the regenerated hash against the hash the submitter/owner reviewed (or the frozen hash on re-verification). */
function stageC8(input: EvaluateInput, state: State): StageOutcome {
  const expected = input.expected_manifest_sha256;
  if (expected === undefined) return { verdict: 'NOT_EXECUTED' };
  if (typeof expected !== 'string' || !HEX64.test(expected) || expected !== state.regenerated!.sha256) return fail(FAILURE.manifest_hash_mismatch);
  return pass();
}

export function evaluateU51Manifest(input: EvaluateInput): Evaluation {
  const state: State = {};
  const checks: CheckRecord[] = [];
  const flow = { stopped: false, failureCode: undefined as string | undefined, notExecuted: false };

  const run = (id: CoreStageId, stage: () => StageOutcome): void => {
    if (flow.stopped) {
      checks.push({ id, result: 'NOT_EXECUTED' });
      return;
    }
    const outcome = stage();
    if (outcome.verdict === 'PASS') {
      checks.push({ id, result: 'PASS' });
    } else if (outcome.verdict === 'FAIL') {
      checks.push({ id, result: 'FAIL', code: outcome.code });
      flow.failureCode = outcome.code;
      flow.stopped = true;
    } else {
      checks.push({ id, result: 'NOT_EXECUTED' });
      flow.notExecuted = true;
      flow.stopped = true;
    }
  };

  const observed = (check: (ctx: StageContext) => string | undefined): StageOutcome => {
    const ctx = contextOf(input, state);
    // observations that are not an object carry nothing: the same denial as an observation that is absent
    return ctx === undefined ? fail(FAILURE.evidence_schema_invalid) : fromCode(check(ctx));
  };

  run('C0', () => stageC0(input, state));
  run('C1', () => stageC1(state));
  run('C2', () => observed(checkBinding));
  run('C3', () => observed(checkZeroGoogle));
  run('C4', () => observed(checkEmbedding));
  run('C5', () => observed(checkSchemaParity));
  run('C6', () => observed(checkGeneration));
  run('C7', () => stageC7(input, state));
  run('C8', () => stageC8(input, state));

  const failureCode = flow.failureCode;
  const verdict: CheckVerdict = failureCode !== undefined ? 'FAIL' : flow.notExecuted ? 'NOT_EXECUTED' : 'PASS';
  // the regenerated hash is reported once the manifest has been judged canonical (C0..C7 passed)
  const c7 = checks.find((c) => c.id === 'C7');
  const hash = c7?.result === 'PASS' ? state.regenerated!.sha256 : undefined;
  return {
    result: verdict,
    ...(failureCode !== undefined ? { failure_code: failureCode } : {}),
    ...(hash !== undefined ? { manifest_sha256: hash } : {}),
    checks,
  };
}

export { CORE_STAGES };
