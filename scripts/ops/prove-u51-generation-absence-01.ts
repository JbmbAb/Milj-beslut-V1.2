/**
 * U51-GENERATION-ABSENCE-PROOF-01 -- the static half of the DECLARED_ABSENT proof, run against a COMMIT.
 *
 * Reads the subject tree from the git object database, takes the static census of contract 2d937d63 (5.3) and
 * derives the production entrypoint set from the composition-bound deploy/onprem/entrypoints.json using D's
 * fail-closed consistency rules. It does NOT boot anything and it NEVER reports PASS: the DECLARED_ABSENT proof
 * still needs a side-effect-safe execution probe of every derived entrypoint. It selects no model or runtime,
 * registers nothing and writes nothing into the subject.
 *
 * Exit codes follow scripts/devgov/invariant-packs.mjs: 1 = FAIL (runtime registration discovered),
 * 2 = NOT_EXECUTED (the proof could not run to completion). There is no 0 in this version.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-u51-generation-absence-01.ts --repo <path> --commit <rev> [--out <file>]
 * --out must lie outside the subject repository (the evidence never lives inside the tree it describes).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LaunchSurfaceObserver,
  StaticCensusAccumulator,
  deriveEntrypointSet,
  iterateTreeEntries,
  resolveSubject,
} from '../../packages/mps-u51-generation-absence/src/index';

const CONTRACT_COMMIT = '2d937d6336d73ab11d428af7d56afc6fdb38d0ee';
const OD3_RECORD = 'docs/architecture/U51-OD-3-GENERATION-REQUIREMENT-OWNER-DECISION-2026-10-08.md';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const repo = arg('repo');
const rev = arg('commit');
const out = arg('out');
if (!repo || !rev) fail('usage: --repo <path> --commit <rev> [--out <file>]');

const top = spawnSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
if (out && top) {
  const rel = path.relative(path.resolve(top), path.resolve(out));
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) fail(`refusing --out inside the subject repository: ${out}`);
}

const subject = resolveSubject(repo, rev);
const entries = [...iterateTreeEntries(repo, subject.tree_sha)];
const census = new StaticCensusAccumulator();
const surfaces = new LaunchSurfaceObserver();
for (const entry of entries) {
  census.add(entry);
  surfaces.add(entry);
}
const detail = census.result();
const derivability = deriveEntrypointSet(entries);

const registration = detail.census.registration_identifier_files;
const nonliteral = detail.census.nonliteral_dynamic_imports;
const result = registration > 0 ? 'FAIL' : 'NOT_EXECUTED';
const proofBlocker = derivability.status === 'DERIVED' ? 'BOOT_PROBE_NOT_IMPLEMENTED' : derivability.blocker;

const report = {
  proof_unit: 'U51-GENERATION-ABSENCE-PROOF-01',
  contract_commit: CONTRACT_COMMIT,
  od3: { decision: 'ABSENT_ADMISSIBLE', record: OD3_RECORD },
  subject,
  static_census: detail.census,
  census_requirements: {
    registration_identifier_files_equals_0: registration === 0,
    nonliteral_dynamic_imports_equals_0: nonliteral === 0,
  },
  census_audit: {
    registration_identifier_paths: detail.registration_identifier_paths,
    test_registration_paths: detail.test_registration_paths,
    documentation_identifier_paths: detail.documentation_identifier_paths,
    nonliteral_dynamic_import_sites: detail.nonliteral_dynamic_import_sites,
    // U51-OD-17: sites in an exact-path + exact-content-hash vendored exception; listed here, never counted
    exempt_nonliteral_dynamic_import_sites: detail.exempt_nonliteral_dynamic_import_sites,
    composition_marker_paths: detail.composition_marker_paths,
    code_files_parsed: detail.code_files_parsed,
    files_seen: detail.files_seen,
  },
  entrypoint_set: derivability,
  observed_launch_surfaces_not_a_derivation: surfaces.result(),
  boot_probe: {
    status: 'NOT_EXECUTED',
    reason:
      derivability.status === 'DERIVED'
        ? 'the production entrypoint set is derived from the composition, but a side-effect-safe execution probe of every real entrypoint is not implemented in this unit'
        : 'no derived production entrypoint set; a probe over a hand-picked subset is not accepted',
  },
  generation_evidence: 'NOT_PRODUCED',
  manifest_posture: 'NOT_WRITTEN',
  result,
  blockers: [
    ...(registration > 0 ? ['RUNTIME_REGISTRATION_DISCOVERED'] : []),
    ...(nonliteral > 0 ? ['NONLITERAL_DYNAMIC_IMPORTS_PRESENT_OD17_OPEN'] : []),
    proofBlocker,
  ],
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (out) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, json, 'utf8');
}
process.stdout.write(json);
process.exit(result === 'FAIL' ? 1 : 2);
