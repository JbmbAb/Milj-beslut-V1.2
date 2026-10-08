/**
 * The proof runner `prove-u51-canonical-manifest-01` (contract 11.2) -- orchestration, no IO of its own.
 *
 * It gathers the adapter facts through injected ports, runs the pure core (C0..C8), then C9 (negative probes) and
 * emits C10 (the evidence record). Exit codes follow scripts/devgov/invariant-packs.mjs:
 *
 *   0  PASS           core PASS + C9 PASS + C10   -> state FREEZE_ELIGIBLE (never FROZEN: the freeze is a human gate)
 *   1  FAIL           a failure code (core, or negative_probe_not_rejected)
 *   2  NOT_EXECUTED   the core result is NOT_EXECUTED, an adapter was unavailable, or the run errored
 *
 * Production wiring contains no fake adapter; tests inject fakes through the ports.
 */
import { evaluateU51Manifest } from '../evaluate';
import { buildProofEvidence, evidenceDocument, evidenceIsSelfConsistent, type ProofEvidence } from '../proofEvidence';
import { isRecord, type Rec } from '../json';
import { parseStrictJsonBytes } from '../strictJson';
import type { CheckRecord, EvaluateInput, Evaluation } from '../types';
import { FAILURE, type CheckVerdict } from '../vocabulary';
import { PROBES, runNegativeProbes, type Probe, type ProbeReport } from './probes';

/** An adapter that could not run (tool missing, entrypoint not bootable, no authority configured). Never a payload, exit 2. */
export class AdapterUnavailable extends Error {}

export interface SubjectObservation {
  readonly commit_sha: string;
  readonly commit_tree_sha: string;
}
export interface PolicyAuthentication {
  readonly policy_sha256: string;
  readonly verified: boolean;
  readonly trust_root_ref: string;
}
export interface ControllerIdentity {
  readonly verifier_version: string;
  readonly implementation_tree_sha1: string;
  /** audit only (not hashed) */
  readonly controller_commit_sha?: string;
}

export interface ProverPorts {
  /** git adapter: the commit and its tree, read from git objects */
  readonly subject: () => SubjectObservation;
  /** the other observations: release, origin and the four derivation payloads, as `{payload}` wrappers where applicable */
  readonly observations: () => Rec;
  /** the controller's verdict on the policy attestation (OD-15); adapter-asserted */
  readonly policyAuthentication: (policy: unknown) => PolicyAuthentication;
  readonly verifier: () => ControllerIdentity;
  readonly now: () => string;
}

export interface ProverInput {
  readonly manifest_bytes: Uint8Array;
  readonly policy: unknown;
  readonly expected_manifest_sha256?: string;
}

export type ProverState = 'FREEZE_ELIGIBLE' | 'REJECTED' | 'NOT_EXECUTED';

export interface ProverResult {
  readonly exit_code: 0 | 1 | 2;
  readonly state: ProverState;
  readonly message?: string;
  readonly evaluation?: Evaluation;
  readonly probes?: ProbeReport;
  readonly evidence?: ProofEvidence;
  /** the record to persist (identity, audit, evidence_sha256) */
  readonly document?: Rec;
}

const notExecuted = (message: string): ProverResult => ({ exit_code: 2, state: 'NOT_EXECUTED', message });

/** Test seam only: the probe list the runner attacks the baseline with. Production uses PROBES. */
export interface ProverOptions {
  readonly probes?: readonly Probe[];
}

export function proveU51CanonicalManifest(input: ProverInput, ports: ProverPorts, options: ProverOptions = {}): ProverResult {
  // ---- adapters (the only code that touches git, registries, authorities)
  let subject: SubjectObservation;
  let others: Rec;
  let authentication: PolicyAuthentication;
  let controller: ControllerIdentity;
  try {
    subject = ports.subject();
    others = ports.observations();
    authentication = ports.policyAuthentication(input.policy);
    controller = ports.verifier();
  } catch (error) {
    if (error instanceof AdapterUnavailable) return notExecuted(`adapter unavailable: ${error.message}`);
    return notExecuted(`adapter error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(others) || Object.prototype.hasOwnProperty.call(others, 'subject')) {
    return notExecuted('adapter error: the observations port must return an object without a subject (the subject comes from git only)');
  }
  const observations: Rec = { ...others, subject: { commit_sha: subject.commit_sha, commit_tree_sha: subject.commit_tree_sha } };
  const verifier = { verifier_version: controller.verifier_version, implementation_tree_sha1: controller.implementation_tree_sha1 };

  const coreInput: EvaluateInput = {
    manifest_bytes: input.manifest_bytes,
    policy: input.policy,
    policy_authentication: authentication,
    verifier,
    observations,
    ...(input.expected_manifest_sha256 !== undefined ? { expected_manifest_sha256: input.expected_manifest_sha256 } : {}),
  };

  // ---- C0..C8
  const evaluation = evaluateU51Manifest(coreInput);

  // ---- C9 (only a core PASS has a baseline to attack)
  let probes: ProbeReport | undefined;
  let c9: CheckRecord = { id: 'C9', result: 'NOT_EXECUTED' };
  let overall: CheckVerdict = evaluation.result;
  let overallCode = evaluation.failure_code;
  if (evaluation.result === 'PASS') {
    const parsed = parseStrictJsonBytes(input.manifest_bytes);
    if (parsed.ok === false || !isRecord(parsed.value)) return notExecuted('internal error: a core PASS manifest could not be re-parsed for the negative probes');
    probes = runNegativeProbes(coreInput, parsed.value, evaluateU51Manifest, options.probes ?? PROBES);
    if (probes.not_rejected === 0 && probes.rejected > 0) {
      c9 = { id: 'C9', result: 'PASS' };
    } else {
      c9 = { id: 'C9', result: 'FAIL', code: FAILURE.negative_probe_not_rejected };
      overall = 'FAIL';
      overallCode = FAILURE.negative_probe_not_rejected;
    }
  }

  // ---- C10: the record is complete and its hash is the hash of its identity
  const c10: CheckRecord = { id: 'C10', result: 'PASS' };
  let evidence: ProofEvidence;
  try {
    evidence = buildProofEvidence({
      evaluation,
      runnerChecks: [c9, c10],
      overallResult: overall,
      ...(overallCode !== undefined ? { overallFailureCode: overallCode } : {}),
      subject: { commit_sha: subject.commit_sha, tree_sha: subject.commit_tree_sha },
      policy: input.policy,
      policyTrustRootRef: authentication.trust_root_ref,
      observations,
      verifier,
      audit: {
        observed_at: ports.now(),
        runtime: `node ${process.version}`,
        controller_commit_sha: controller.controller_commit_sha ?? null,
        underlying_codes: [],
        state_note: 'PASS is not VERIFIED. FROZEN needs the human freeze gate bound to a trust root (contract 7.5); this runner cannot reach it.',
        negative_probes: probes?.outcomes ?? [],
      },
    });
  } catch (error) {
    return notExecuted(`evidence could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
  const document = evidenceDocument(evidence);
  if (!evidenceIsSelfConsistent(document)) return notExecuted('internal error: the evidence record is not self-consistent');

  const common = { evaluation, ...(probes !== undefined ? { probes } : {}), evidence, document };
  if (overall === 'PASS') return { exit_code: 0, state: 'FREEZE_ELIGIBLE', ...common };
  if (overall === 'FAIL') return { exit_code: 1, state: 'REJECTED', ...common };
  return { exit_code: 2, state: 'NOT_EXECUTED', message: 'the core result is NOT_EXECUTED (a comparison could not be made)', ...common };
}
