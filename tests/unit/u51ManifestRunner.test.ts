/**
 * U51-CANONICAL-MANIFEST-CONTRACT-01 -- the proof runner: C9 negative probes, C10 evidence, exit codes 0/1/2.
 * Fakes are injected through the ports here; production wiring contains none (asserted below).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_FAILURE_CODES,
  AdapterUnavailable,
  FAILURE,
  PROBES,
  buildProofEvidence,
  canonicalizeManifest,
  evaluateU51Manifest,
  evidenceDocument,
  evidenceIsSelfConsistent,
  parseStrictJsonBytes,
  proveU51CanonicalManifest,
  runNegativeProbes,
  type Evaluation,
  type ProverPorts,
} from '../../packages/mps-u51-manifest/src/index';
import { productionCliDeps } from '../../packages/mps-u51-manifest/src/runner/productionWiring';
import { buildAbsentGenerationWorld, buildWorld, clone, hashOf, syn40, toInput, type Obj, type World } from '../../packages/mps-u51-manifest/tests/fixtures/u51Fixtures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'packages', 'mps-u51-manifest', 'src');

function portsFor(w: World, now = '2026-10-08T00:00:00.000Z'): ProverPorts {
  return {
    subject: () => ({ commit_sha: w.observations.subject.commit_sha, commit_tree_sha: w.observations.subject.commit_tree_sha }),
    observations: () => {
      const { subject: _subject, ...rest } = clone(w.observations);
      return rest;
    },
    policyAuthentication: () => ({ ...w.policy_authentication }),
    verifier: () => ({ ...w.verifier, controller_commit_sha: syn40('controller-commit') } as never),
    now: () => now,
  };
}
const inputFor = (w: World, withExpected = true) => {
  const { manifest_bytes, expected_manifest_sha256 } = toInput(w);
  return { manifest_bytes, policy: w.policy, ...(withExpected ? { expected_manifest_sha256 } : {}) };
};

describe('a candidate that passes everything reaches FREEZE_ELIGIBLE, never FROZEN', () => {
  it('BOUND world: core PASS, C9 all rejected, C10 emitted, exit 0', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w));
    expect(r.exit_code).toBe(0);
    expect(r.state).toBe('FREEZE_ELIGIBLE');
    expect(r.evaluation?.result).toBe('PASS');
    expect(r.evidence?.identity.checks.map((c) => `${c.id}:${c.result}`)).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'].map((id) => `${id}:PASS`));
    expect(r.probes?.not_rejected).toBe(0);
    expect(r.probes?.rejected).toBeGreaterThan(40);
    expect(r.probes?.not_applicable).toBe(PROBES.filter((p) => p.applies !== undefined && !p.applies(workOf(w))).length);
    expect(r.evidence?.identity.result).toBe('PASS');
    expect(r.evidence?.identity.failure_code).toBeUndefined();
    expect(evidenceIsSelfConsistent(r.document)).toBe(true);
  });

  it('DECLARED_ABSENT world: the bound-only probes are listed as not applicable, the absent-only ones run', () => {
    const w = buildAbsentGenerationWorld();
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w));
    expect(r.exit_code).toBe(0);
    const by = (id: string) => r.probes?.outcomes.find((o) => o.probe === id)?.outcome;
    expect(by('bound-mock-named-runtime')).toBe('NOT_APPLICABLE');
    expect(by('bound-runtime-differs-from-the-booted-one')).toBe('NOT_APPLICABLE');
    expect(by('absent-but-an-entrypoint-registered')).toBe('REJECTED');
    expect(by('absent-but-an-attempt-succeeded')).toBe('REJECTED');
    expect(r.probes?.not_rejected).toBe(0);
  });

  it('origin probes follow the policy: not applicable when origin is not required', () => {
    const w = buildWorld();
    w.policy.origin_requirement = 'NOT_REQUIRED';
    w.policy_authentication.policy_sha256 = hashOf(w.policy);
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w));
    expect(r.exit_code).toBe(0);
    expect(r.probes?.outcomes.find((o) => o.probe === 'candidate-not-on-origin')?.outcome).toBe('NOT_APPLICABLE');
  });

  it('the evidence identity is deterministic and the audit part is not hashed', () => {
    const w = buildWorld();
    const a = proveU51CanonicalManifest(inputFor(w), portsFor(w, '2026-10-08T00:00:00.000Z'));
    const b = proveU51CanonicalManifest(inputFor(w), portsFor(w, '2031-01-01T12:34:56.000Z'));
    expect(a.evidence?.evidence_sha256).toBe(b.evidence?.evidence_sha256);
    expect((a.evidence?.audit as Obj).observed_at).not.toBe((b.evidence?.audit as Obj).observed_at);
    expect(Object.keys(a.evidence!.identity).sort()).toEqual(['checks', 'contract_version', 'inputs', 'manifest_contract_version', 'manifest_sha256', 'policy_sha256', 'policy_trust_root_ref', 'result', 'subject', 'verifier']);
    expect(a.evidence?.evidence_sha256).toBe(hashOf(a.evidence?.identity));
  });

  it('the evidence identity binds manifest, subject, policy, verifier and every input hash', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w));
    const id = r.evidence!.identity;
    expect(id.manifest_sha256).toBe(hashOf(w.manifest));
    expect(id.subject).toEqual({ commit_sha: w.observations.subject.commit_sha, tree_sha: w.observations.subject.commit_tree_sha });
    expect(id.policy_sha256).toBe(hashOf(w.policy));
    expect(id.policy_trust_root_ref).toBe('fixture-trust-root');
    expect(id.verifier).toEqual(w.verifier);
    expect(id.inputs).toEqual({
      zero_google_evidence_sha256: hashOf(w.observations.zero_google.payload),
      embedding_evidence_sha256: hashOf(w.observations.embedding.payload),
      schema_evidence_sha256: hashOf(w.observations.schema.payload),
      generation_evidence_sha256: hashOf(w.observations.generation.payload),
      release_resolution_sha256: hashOf(w.observations.release),
      origin_observation_sha256: hashOf(w.observations.origin),
    });
  });

  it('a different candidate gives a different evidence hash (the hash is not a constant)', () => {
    const a = buildWorld();
    const b = buildAbsentGenerationWorld();
    expect(proveU51CanonicalManifest(inputFor(a), portsFor(a)).evidence?.evidence_sha256).not.toBe(proveU51CanonicalManifest(inputFor(b), portsFor(b)).evidence?.evidence_sha256);
  });
});

// a Work-shaped view used only to count the probes that do not apply (mirrors what the runner does)
function workOf(w: World) {
  return { manifest: clone(w.manifest), policy: clone(w.policy), policyAuthentication: {}, verifier: {}, observations: {}, expected: 'AUTO' as const };
}

describe('exit codes follow scripts/devgov/invariant-packs.mjs: 0 PASS, 1 FAIL, 2 NOT_EXECUTED / could not run', () => {
  it('a failure code is exit 1 with state REJECTED; C9 is NOT_EXECUTED; the record is still emitted', () => {
    const w = buildWorld();
    w.policy_authentication.verified = false;
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w));
    expect(r.exit_code).toBe(1);
    expect(r.state).toBe('REJECTED');
    expect(r.evidence?.identity.failure_code).toBe(FAILURE.policy_unauthenticated);
    expect(r.evidence?.identity.checks.find((c) => c.id === 'C0')).toEqual({ id: 'C0', result: 'FAIL', code: FAILURE.policy_unauthenticated });
    expect(r.evidence?.identity.checks.find((c) => c.id === 'C9')?.result).toBe('NOT_EXECUTED');
    expect(r.probes).toBeUndefined();
    expect(evidenceIsSelfConsistent(r.document)).toBe(true);
  });

  it('no expected hash: the core result is NOT_EXECUTED, so exit 2 -- never 0', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w, false), portsFor(w));
    expect(r.exit_code).toBe(2);
    expect(r.state).toBe('NOT_EXECUTED');
    expect(r.evaluation?.result).toBe('NOT_EXECUTED');
    expect(r.evidence?.identity.checks.find((c) => c.id === 'C8')?.result).toBe('NOT_EXECUTED');
    expect(r.evidence?.identity.checks.find((c) => c.id === 'C9')?.result).toBe('NOT_EXECUTED');
  });

  it('an adapter that could not run produces no payload and no evidence: exit 2', () => {
    const w = buildWorld();
    for (const broken of ['subject', 'observations', 'policyAuthentication', 'verifier'] as const) {
      const ports = { ...portsFor(w), [broken]: () => { throw new AdapterUnavailable(`${broken} is unavailable`); } } as ProverPorts;
      const r = proveU51CanonicalManifest(inputFor(w), ports);
      expect(r.exit_code, broken).toBe(2);
      expect(r.state, broken).toBe('NOT_EXECUTED');
      expect(r.evidence, broken).toBeUndefined();
      expect(r.message).toContain('unavailable');
    }
  });

  it('an unexpected adapter error is exit 2, not a FAIL and not a PASS', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), { ...portsFor(w), subject: () => { throw new Error('boom'); } });
    expect(r.exit_code).toBe(2);
    expect(r.message).toContain('boom');
  });

  it('the subject comes from git only: an observations port that delivers one is refused', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), { ...portsFor(w), observations: () => clone(w.observations) });
    expect(r.exit_code).toBe(2);
    expect(r.message).toContain('subject');
  });

  it('a subject (git) that disagrees with the manifest is FAIL tree_binding_mismatch (exit 1)', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), { ...portsFor(w), subject: () => ({ commit_sha: syn40('another'), commit_tree_sha: syn40('another-tree') }) });
    expect(r.exit_code).toBe(1);
    expect(r.evidence?.identity.failure_code).toBe(FAILURE.tree_binding_mismatch);
  });
});

describe('C9: the harness can fail (a probe harness that cannot fail proves nothing)', () => {
  const baseline = () => {
    const w = buildWorld();
    const input = toInput(w);
    const parsed = parseStrictJsonBytes(input.manifest_bytes);
    if (!parsed.ok) throw new Error('fixture manifest must parse');
    return { w, input, manifest: parsed.value as Obj };
  };

  it('a core that accepts everything rejects nothing: every applicable probe is NOT_REJECTED', () => {
    const { input, manifest } = baseline();
    const alwaysPass = (): Evaluation => ({ result: 'PASS', checks: [] });
    const report = runNegativeProbes(input, manifest, alwaysPass);
    expect(report.rejected).toBe(0);
    expect(report.not_rejected).toBe(PROBES.length - report.not_applicable);
  });

  it('a core that fails with the WRONG code or at the WRONG stage is not accepted as a rejection', () => {
    const { input, manifest } = baseline();
    const real = evaluateU51Manifest;
    const wrongCode = (i: Parameters<typeof real>[0]): Evaluation => {
      const e = real(i);
      return e.result === 'FAIL' ? { ...e, failure_code: FAILURE.policy_invalid } : e;
    };
    const r1 = runNegativeProbes(input, manifest, wrongCode);
    expect(r1.not_rejected).toBeGreaterThan(30);
    const wrongStage = (i: Parameters<typeof real>[0]): Evaluation => {
      const e = real(i);
      return e.result === 'FAIL' ? { ...e, checks: e.checks.map((c) => (c.id === 'C1' ? { ...c, result: 'FAIL' as const, code: e.failure_code } : c)) } : e;
    };
    expect(runNegativeProbes(input, manifest, wrongStage).not_rejected).toBeGreaterThan(30);
  });

  it('a core that lets a later check run after a failure is not accepted (later checks must be NOT_EXECUTED)', () => {
    const { input, manifest } = baseline();
    const real = evaluateU51Manifest;
    const sloppy = (i: Parameters<typeof real>[0]): Evaluation => {
      const e = real(i);
      return e.result === 'FAIL' ? { ...e, checks: e.checks.map((c) => (c.result === 'NOT_EXECUTED' ? { ...c, result: 'PASS' as const } : c)) } : e;
    };
    const report = runNegativeProbes(input, manifest, sloppy);
    expect(report.not_rejected).toBeGreaterThan(30);
  });

  it('a probe whose mutation cannot be applied is NOT_REJECTED with its reason, never silently skipped', () => {
    const { w, manifest } = baseline();
    const input = toInput(w) as unknown as Obj;
    input.observations = { ...clone(w.observations) };
    delete input.observations.release;
    const report = runNegativeProbes(input as never, manifest);
    const hit = report.outcomes.find((o) => o.probe === 'release-hash-differs');
    expect(hit?.outcome).toBe('SURVIVED');
    expect((hit as { why: string }).why).toContain('could not be applied');
  });

  it('the runner turns a surviving probe into FAIL negative_probe_not_rejected (exit 1) and still emits the record', () => {
    const w = buildWorld();
    const survivor = { id: 'survivor', matrix_row: '0', expect: { code: FAILURE.policy_invalid, stage: 'C0' as const }, mutate: () => undefined };
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w), { probes: [survivor] });
    expect(r.exit_code).toBe(1);
    expect(r.state).toBe('REJECTED');
    expect(r.evaluation?.result).toBe('PASS');
    expect(r.evidence?.identity.failure_code).toBe(FAILURE.negative_probe_not_rejected);
    expect(r.evidence?.identity.checks.find((c) => c.id === 'C9')).toEqual({ id: 'C9', result: 'FAIL', code: FAILURE.negative_probe_not_rejected });
    expect(r.evidence?.identity.result).toBe('FAIL');
  });

  it('an empty probe list proves nothing and is not a PASS', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w), { probes: [] });
    expect(r.exit_code).toBe(1);
  });

  it('probes do not touch the runner inputs (they work on copies)', () => {
    const w = buildWorld();
    const before = JSON.stringify(w);
    proveU51CanonicalManifest(inputFor(w), portsFor(w));
    expect(JSON.stringify(w)).toBe(before);
  });

  it('every probe names a taxonomy code, is unique, and the matrix rows of section 8 are covered (18 is the runner path refusal)', () => {
    const ids = PROBES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROBES) {
      if ('code' in p.expect) expect(ALL_FAILURE_CODES).toContain(p.expect.code);
    }
    const rows = new Set(PROBES.map((p) => Number(p.matrix_row)));
    for (const row of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]) {
      expect(rows.has(row), `matrix row ${row}`).toBe(true);
    }
  });
});

describe('evidence record helpers', () => {
  it('buildProofEvidence demands the checks C0..C10 in fixed order', () => {
    const w = buildWorld();
    const evaluation = evaluateU51Manifest(toInput(w) as never);
    const common = { evaluation, overallResult: 'PASS' as const, subject: { commit_sha: syn40('a'), tree_sha: syn40('b') }, policy: w.policy, policyTrustRootRef: null, observations: w.observations, verifier: w.verifier as never, audit: {} };
    expect(() => buildProofEvidence({ ...common, runnerChecks: [] })).toThrow();
    expect(() => buildProofEvidence({ ...common, runnerChecks: [{ id: 'C10', result: 'PASS' }, { id: 'C9', result: 'PASS' }] })).toThrow();
    const ok = buildProofEvidence({ ...common, runnerChecks: [{ id: 'C9', result: 'PASS' }, { id: 'C10', result: 'PASS' }] });
    expect(ok.identity.policy_trust_root_ref).toBeNull();
  });
  it('a stored record whose identity was edited is no longer self-consistent', () => {
    const w = buildWorld();
    const r = proveU51CanonicalManifest(inputFor(w), portsFor(w));
    const doc = clone(evidenceDocument(r.evidence!)) as Obj;
    expect(evidenceIsSelfConsistent(doc)).toBe(true);
    doc.identity.result = 'FAIL';
    expect(evidenceIsSelfConsistent(doc)).toBe(false);
    expect(evidenceIsSelfConsistent(null)).toBe(false);
  });
  it('the canonical bytes the runner judged are the manifest it reports', () => {
    const w = buildWorld();
    expect(canonicalizeManifest(w.manifest).sha256).toBe(proveU51CanonicalManifest(inputFor(w), portsFor(w)).evidence?.identity.manifest_sha256);
  });
});

describe('production wiring contains no fake adapter', () => {
  it('policy authentication is unavailable (OD-15 open): the production port refuses instead of answering', () => {
    const ports = productionCliDeps(ROOT).portsFor({ repo: ROOT, commit: 'HEAD', policyAttestationPath: 'x' }, () => ({}));
    expect(() => ports.policyAuthentication({})).toThrow(AdapterUnavailable);
  });
  it('the runner and wiring sources name no fake, stub, mock or dummy adapter', () => {
    for (const f of ['runner/prover.ts', 'runner/cli.ts', 'runner/productionWiring.ts', 'adapters/controller.ts', 'adapters/gitObjects.ts']) {
      const code = readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/fake|stub|mock|dummy|noop/i);
    }
  });
  it('the runner cannot produce FROZEN: no state or exit path carries it', () => {
    const code = ['runner/prover.ts', 'runner/cli.ts'].map((f) => readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
    expect(code).not.toMatch(/['"]FROZEN['"]/);
  });
});
