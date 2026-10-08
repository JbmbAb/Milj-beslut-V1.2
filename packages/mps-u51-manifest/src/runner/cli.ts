/**
 * Command-line logic of `prove-u51-canonical-manifest-01` (the file under scripts/ops is a thin shell around this).
 *
 *   --subject-repo <path>              the repository holding the subject (read through git objects, never the working tree)
 *   --commit <rev>                     the candidate commit
 *   --manifest <file>                  the stored manifest (must be canonical bytes)
 *   --expected-manifest-sha256 <hex>   the hash the submitter/owner reviewed; without it the result is NOT_EXECUTED
 *   --policy <file>                    the freeze policy JSON
 *   --policy-attestation <file>        the detached attestation over the policy hash (verified by the controller, OD-15)
 *   --evidence-dir <dir>               zero-google.json embedding.json schema.json generation.json release.json origin.json
 *   --out <file>                       where the proof evidence record is written
 *
 * None of these selects a model, provider or runtime. Any manifest/policy/attestation/evidence/out path inside the
 * subject checkout is refused (I13). Everything that touches the world arrives through `CliDeps`.
 */
import { AdapterUnavailable, proveU51CanonicalManifest, type ProverPorts, type ProverResult } from './prover';
import { refuseInsideSubject } from './paths';
import { parseStrictJsonBytes } from '../strictJson';
import path from 'node:path';
import type { Rec } from '../json';

export const EVIDENCE_FILES = {
  zero_google: { file: 'zero-google.json', wrapped: true },
  embedding: { file: 'embedding.json', wrapped: true },
  schema: { file: 'schema.json', wrapped: true },
  generation: { file: 'generation.json', wrapped: true },
  release: { file: 'release.json', wrapped: false },
  origin: { file: 'origin.json', wrapped: false },
} as const;

export interface CliDeps {
  readFile(path: string): Uint8Array;
  /** undefined when the file does not exist */
  readOptionalFile(path: string): Uint8Array | undefined;
  writeFile(path: string, bytes: Uint8Array): void;
  /** the top level of the subject checkout, for the I13 refusal */
  subjectToplevel(repo: string): string;
  /** the top level of the checkout that holds the running verifier */
  controllerToplevel(): string;
  portsFor(args: { repo: string; commit: string; policyAttestationPath: string }, observations: () => Rec): ProverPorts;
  /** same-path test for the controller/subject separation */
  samePath(a: string, b: string): boolean;
}

export interface CliOutcome {
  readonly exit_code: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly result?: ProverResult;
}

const USAGE =
  'usage: prove-u51-canonical-manifest-01 --subject-repo <path> --commit <rev> --manifest <file> --policy <file> --policy-attestation <file> --evidence-dir <dir> --out <file> [--expected-manifest-sha256 <hex>]';

function parseArgs(argv: readonly string[]): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (!flag.startsWith('--') || value === undefined) return `malformed argument list near "${flag}"`;
    if (Object.prototype.hasOwnProperty.call(out, flag.slice(2))) return `duplicate option ${flag}`;
    out[flag.slice(2)] = value;
  }
  return out;
}

const stop = (message: string): CliOutcome => ({ exit_code: 2, stdout: '', stderr: `${message}\n` });

export function runProverCli(argv: readonly string[], deps: CliDeps): CliOutcome {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') return stop(`${parsed}\n${USAGE}`);
  const required = ['subject-repo', 'commit', 'manifest', 'policy', 'policy-attestation', 'evidence-dir', 'out'];
  const missing = required.filter((k) => parsed[k] === undefined);
  if (missing.length > 0) return stop(`missing --${missing.join(', --')}\n${USAGE}`);
  const known = new Set([...required, 'expected-manifest-sha256']);
  const unknown = Object.keys(parsed).filter((k) => !known.has(k));
  if (unknown.length > 0) return stop(`unknown option --${unknown.join(', --')}\n${USAGE}`);

  const repo = parsed['subject-repo']!;
  const manifestPath = parsed.manifest!;
  const policyPath = parsed.policy!;
  const attestationPath = parsed['policy-attestation']!;
  const evidenceDir = parsed['evidence-dir']!;
  const outPath = parsed.out!;

  // ---- I13 and the controller/subject separation (before anything is read)
  let toplevel: string;
  try {
    toplevel = deps.subjectToplevel(repo);
  } catch (error) {
    return stop(`cannot resolve the subject checkout: ${error instanceof Error ? error.message : String(error)}`);
  }
  const refusal = refuseInsideSubject(toplevel, {
    '--manifest': manifestPath,
    '--policy': policyPath,
    '--policy-attestation': attestationPath,
    '--evidence-dir': evidenceDir,
    '--out': outPath,
  });
  if (refusal !== undefined) return stop(refusal);
  if (deps.samePath(deps.controllerToplevel(), toplevel)) {
    return stop('refusing to run the verifier from the subject checkout: a verifier inside the tree it judges cannot vouch for itself (D6, 11.4)');
  }

  // ---- inputs
  let manifestBytes: Uint8Array;
  let policy: unknown;
  try {
    manifestBytes = deps.readFile(manifestPath);
    const policyRead = parseStrictJsonBytes(deps.readFile(policyPath));
    if (policyRead.ok === false) return stop(`the policy file is not strict JSON: ${policyRead.problem}`);
    policy = policyRead.value;
    deps.readFile(attestationPath); // must exist; its verification is the controller's (OD-15)
  } catch (error) {
    return stop(`cannot read an input file: ${error instanceof Error ? error.message : String(error)}`);
  }

  const observations = (): Rec => {
    const out: Rec = {};
    for (const [key, spec] of Object.entries(EVIDENCE_FILES)) {
      const bytes = deps.readOptionalFile(path.join(evidenceDir, spec.file));
      if (bytes === undefined) continue;
      const read = parseStrictJsonBytes(bytes);
      if (read.ok === false) throw new AdapterUnavailable(`${spec.file} is not strict JSON: ${read.problem}`);
      out[key] = spec.wrapped ? { payload: read.value } : read.value;
    }
    return out;
  };

  const ports = deps.portsFor({ repo, commit: parsed.commit!, policyAttestationPath: attestationPath }, observations);
  const expected = parsed['expected-manifest-sha256'];
  const result = proveU51CanonicalManifest({ manifest_bytes: manifestBytes, policy, ...(expected !== undefined ? { expected_manifest_sha256: expected } : {}) }, ports);

  // ---- C10: persist the record (outside the subject, checked above)
  let stderr = result.message !== undefined ? `${result.message}\n` : '';
  if (result.document !== undefined) {
    try {
      deps.writeFile(outPath, Buffer.from(`${JSON.stringify(result.document, null, 2)}\n`, 'utf8'));
    } catch (error) {
      return { exit_code: 2, stdout: '', stderr: `${stderr}the evidence record could not be written: ${error instanceof Error ? error.message : String(error)}\n`, result };
    }
  }
  const summary = {
    state: result.state,
    exit_code: result.exit_code,
    result: result.evaluation?.result ?? 'NOT_EXECUTED',
    failure_code: result.evidence?.identity.failure_code ?? null,
    manifest_sha256: result.evaluation?.manifest_sha256 ?? null,
    evidence_sha256: result.evidence?.evidence_sha256 ?? null,
    negative_probes: result.probes === undefined ? null : { rejected: result.probes.rejected, not_rejected: result.probes.not_rejected, not_applicable: result.probes.not_applicable },
    note: 'FREEZE_ELIGIBLE is not FROZEN and not VERIFIED; this runner cannot freeze.',
  };
  return { exit_code: result.exit_code, stdout: `${JSON.stringify(summary, null, 2)}\n`, stderr, result };
}
