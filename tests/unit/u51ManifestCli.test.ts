/**
 * prove-u51-canonical-manifest-01 -- command line: I13 path refusal (matrix attack 18), controller/subject
 * separation, input handling, and one subprocess smoke run of the production wiring.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAILURE, evidenceIsSelfConsistent, isInside, realpathLoose, refuseInsideSubject, runProverCli, type CliDeps } from '../../packages/mps-u51-manifest/src/index';
import { buildWorld, hashOf, toInput, type World } from '../../packages/mps-u51-manifest/tests/fixtures/u51Fixtures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHELL = path.join(ROOT, 'scripts', 'ops', 'prove-u51-canonical-manifest-01.ts');

const base = mkdtempSync(path.join(tmpdir(), 'u51-cli-'));
const subject = path.join(base, 'subject');
const outside = path.join(base, 'outside');
const controller = path.join(base, 'controller');
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeAll(() => {
  for (const d of [subject, outside, controller]) mkdirSync(d, { recursive: true });
});

function writeWorld(w: World, dir: string, options: { skip?: string[] } = {}) {
  const evidence = path.join(dir, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const o = w.observations;
  const files: Record<string, unknown> = {
    'zero-google.json': o.zero_google?.payload,
    'embedding.json': o.embedding?.payload,
    'schema.json': o.schema?.payload,
    'generation.json': o.generation?.payload,
    'release.json': o.release,
    'origin.json': o.origin,
  };
  for (const [name, value] of Object.entries(files)) {
    if (value !== undefined && !(options.skip ?? []).includes(name)) writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 1));
  }
  const input = toInput(w);
  writeFileSync(path.join(dir, 'manifest.json'), input.manifest_bytes);
  writeFileSync(path.join(dir, 'policy.json'), JSON.stringify(w.policy));
  writeFileSync(path.join(dir, 'policy.attestation'), 'detached-attestation-bytes');
  return { evidence, manifest: path.join(dir, 'manifest.json'), policy: path.join(dir, 'policy.json'), attestation: path.join(dir, 'policy.attestation'), expected: hashOf(w.manifest) };
}

function depsFor(w: World, over: Partial<CliDeps> = {}): CliDeps {
  return {
    readFile: (f) => readFileSync(f),
    readOptionalFile: (f) => (existsSync(f) ? readFileSync(f) : undefined),
    writeFile: (f, bytes) => {
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, bytes);
    },
    subjectToplevel: () => subject,
    controllerToplevel: () => controller,
    samePath: (a, b) => path.resolve(a) === path.resolve(b),
    portsFor: (_args, observations) => ({
      subject: () => ({ commit_sha: w.observations.subject.commit_sha, commit_tree_sha: w.observations.subject.commit_tree_sha }),
      observations,
      policyAuthentication: () => ({ ...w.policy_authentication }),
      verifier: () => ({ ...w.verifier }) as never,
      now: () => '2026-10-08T00:00:00.000Z',
    }),
    ...over,
  };
}

const args = (f: ReturnType<typeof writeWorld>, out: string, extra: string[] = []): string[] => [
  '--subject-repo', subject, '--commit', 'HEAD', '--manifest', f.manifest, '--policy', f.policy, '--policy-attestation', f.attestation,
  '--evidence-dir', f.evidence, '--out', out, '--expected-manifest-sha256', f.expected, ...extra,
];
const flagIndex = (a: string[], flag: string): number => a.indexOf(flag) + 1;

describe('a complete run through the real file flow', () => {
  it('reads the evidence directory, judges, probes and writes the record outside the subject: exit 0, FREEZE_ELIGIBLE', () => {
    const w = buildWorld();
    const dir = path.join(outside, 'ok');
    const f = writeWorld(w, dir);
    const out = path.join(outside, 'ok', 'record', 'evidence.json');
    const r = runProverCli(args(f, out), depsFor(w));
    expect(r.stderr).toBe('');
    expect(r.exit_code).toBe(0);
    const summary = JSON.parse(r.stdout);
    expect(summary.state).toBe('FREEZE_ELIGIBLE');
    expect(summary.negative_probes.not_rejected).toBe(0);
    const stored = JSON.parse(readFileSync(out, 'utf8'));
    expect(evidenceIsSelfConsistent(stored)).toBe(true);
    expect(stored.evidence_sha256).toBe(summary.evidence_sha256);
    expect(stored.identity.result).toBe('PASS');
  });

  it('a missing evidence file is the candidate lacking proof: FAIL (exit 1) with the *_MISSING code', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'missing'), { skip: ['zero-google.json'] });
    const r = runProverCli(args(f, path.join(outside, 'missing', 'e.json')), depsFor(w));
    expect(r.exit_code).toBe(1);
    expect(JSON.parse(r.stdout).failure_code).toBe(FAILURE.zero_google_evidence_missing);
  });

  it('no expected hash: NOT_EXECUTED (exit 2), and the record is still written', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'noexp'));
    const a = args(f, path.join(outside, 'noexp', 'e.json'));
    a.splice(flagIndex(a, '--expected-manifest-sha256') - 1, 2);
    const r = runProverCli(a, depsFor(w));
    expect(r.exit_code).toBe(2);
    expect(JSON.parse(r.stdout).state).toBe('NOT_EXECUTED');
    expect(existsSync(path.join(outside, 'noexp', 'e.json'))).toBe(true);
  });

  it('an evidence file that is not strict JSON (duplicate key) cannot be judged: exit 2', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'dup'));
    writeFileSync(path.join(f.evidence, 'schema.json'), '{"a":1,"a":2}');
    const r = runProverCli(args(f, path.join(outside, 'dup', 'e.json')), depsFor(w));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('schema.json');
  });

  it('a policy file that is not strict JSON cannot be judged: exit 2', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'badpolicy'));
    writeFileSync(f.policy, '{"a":1,"a":2}');
    const r = runProverCli(args(f, path.join(outside, 'badpolicy', 'e.json')), depsFor(w));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('policy');
  });

  it('an unreadable input is exit 2', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'unreadable'));
    const r = runProverCli(args({ ...f, manifest: path.join(outside, 'nope.json') }, path.join(outside, 'unreadable', 'e.json')), depsFor(w, { readFile: (p) => readFileSync(p) }));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('cannot read');
  });

  it('an evidence record that cannot be written is exit 2, not a quiet PASS', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'nowrite'));
    const r = runProverCli(args(f, path.join(outside, 'nowrite', 'e.json')), depsFor(w, { writeFile: () => { throw new Error('disk full'); } }));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('disk full');
  });
});

describe('I13: any manifest / policy / attestation / evidence / out path inside the subject checkout is refused', () => {
  const w = buildWorld();
  const f = writeWorld(w, path.join(outside, 'refuse'));
  const good = args(f, path.join(outside, 'refuse', 'e.json'));
  const inside = path.join(subject, 'nested', 'x.json');

  it.each(['--manifest', '--policy', '--policy-attestation', '--evidence-dir', '--out'])('%s inside the subject -> exit 2, nothing read or written', (flag) => {
    const a = [...good];
    a[flagIndex(a, flag)] = inside;
    let touched = false;
    const r = runProverCli(a, depsFor(w, { readFile: () => { touched = true; return Buffer.alloc(0); }, writeFile: () => { touched = true; } }));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain(`refusing ${flag} inside the subject checkout`);
    expect(touched).toBe(false);
    expect(existsSync(inside)).toBe(false);
  });

  it('a path that climbs out and back in (..) is still inside', () => {
    const a = [...good];
    a[flagIndex(a, '--out')] = path.join(outside, '..', 'subject', 'e.json');
    expect(runProverCli(a, depsFor(w)).exit_code).toBe(2);
  });

  it('a link that points into the subject is still inside (junction / symlink resolved)', () => {
    const link = path.join(outside, 'link-into-subject');
    try {
      symlinkSync(subject, link, 'junction');
    } catch {
      return; // links not creatable on this machine: nothing to prove here
    }
    const a = [...good];
    a[flagIndex(a, '--out')] = path.join(link, 'e.json');
    const r = runProverCli(a, depsFor(w));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('refusing --out');
    expect(existsSync(path.join(subject, 'e.json'))).toBe(false);
  });

  it('a sibling directory whose name merely starts with the subject name is outside', () => {
    expect(isInside(path.join(base, 'subject-other', 'x'), subject)).toBe(false);
    expect(isInside(path.join(subject, 'x'), subject)).toBe(true);
    expect(isInside(subject, subject)).toBe(true);
    expect(refuseInsideSubject(subject, { '--out': path.join(base, 'subject-other', 'x') })).toBeUndefined();
  });

  it('realpathLoose resolves the longest existing ancestor and keeps the rest', () => {
    const p = realpathLoose(path.join(subject, 'not', 'yet', 'there'));
    expect(p.endsWith(path.join('not', 'yet', 'there'))).toBe(true);
  });

  it('a verifier that runs from the subject checkout itself is refused (it cannot vouch for the tree it judges)', () => {
    const r = runProverCli(good, depsFor(w, { controllerToplevel: () => subject }));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('cannot vouch for itself');
  });

  it('an unresolvable subject checkout is exit 2', () => {
    const r = runProverCli(good, depsFor(w, { subjectToplevel: () => { throw new Error('not a git checkout'); } }));
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain('cannot resolve the subject checkout');
  });
});

describe('argument handling', () => {
  const w = buildWorld();
  const f = writeWorld(w, path.join(outside, 'argv'));
  const good = args(f, path.join(outside, 'argv', 'e.json'));
  it('missing, unknown, duplicate and dangling options are exit 2 with the usage', () => {
    expect(runProverCli(good.filter((_x, i) => i !== flagIndex(good, '--policy') - 1 && i !== flagIndex(good, '--policy')), depsFor(w)).stderr).toContain('missing --policy');
    expect(runProverCli([...good, '--model', 'x'], depsFor(w)).stderr).toContain('unknown option --model');
    expect(runProverCli([...good, '--out', 'again'], depsFor(w)).stderr).toContain('duplicate option --out');
    expect(runProverCli([...good, '--commit'], depsFor(w)).stderr).toContain('malformed argument list');
    expect(runProverCli(['positional'], depsFor(w)).exit_code).toBe(2);
    expect(runProverCli([], depsFor(w)).stderr).toContain('usage:');
  });
});

describe('the real command (production wiring, subprocess)', () => {
  const run = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', SHELL, ...a], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  const repo = path.join(base, 'git-subject');

  it('refuses an --out inside the subject repository (exit 2) before reading anything', () => {
    mkdirSync(repo, { recursive: true });
    const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    expect(git('init', '-q').status).toBe(0);
    writeFileSync(path.join(repo, 'a.txt'), 'x');
    git('add', '-A');
    expect(git('commit', '-q', '-m', 'c').status).toBe(0);
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'real'));
    const r = run('--subject-repo', repo, '--commit', 'HEAD', '--manifest', f.manifest, '--policy', f.policy, '--policy-attestation', f.attestation, '--evidence-dir', f.evidence, '--out', path.join(repo, 'evidence.json'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('refusing --out inside the subject checkout');
    expect(existsSync(path.join(repo, 'evidence.json'))).toBe(false);
  });

  it('with valid inputs it still ends NOT_EXECUTED (exit 2): no policy-authentication authority exists yet (OD-15), and it says so', () => {
    const w = buildWorld();
    const f = writeWorld(w, path.join(outside, 'real2'));
    const r = run('--subject-repo', repo, '--commit', 'HEAD', '--manifest', f.manifest, '--policy', f.policy, '--policy-attestation', f.attestation, '--evidence-dir', f.evidence, '--out', path.join(outside, 'real2', 'e.json'), '--expected-manifest-sha256', f.expected);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no policy-authentication adapter');
    expect(existsSync(path.join(outside, 'real2', 'e.json'))).toBe(false);
  });
});

