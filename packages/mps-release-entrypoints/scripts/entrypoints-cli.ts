/**
 * Evidence CLI for the entrypoint composition (U51-RELEASE-V3-RECONCILIATION-01, D).
 *
 *   tsx entrypoints-cli.ts check --repo <dir> --treeish <rev> [--out <file>]
 *   tsx entrypoints-cli.ts reach --repo <dir> --treeish <rev> --out <file>
 *
 * Both read GIT OBJECTS of <rev> (never the working directory). `check` runs the consistency rules and prints the
 * derived hashes. `reach` runs the check, then the fail-closed closure from exactly the entries[] files and the
 * whole-tree census, and writes the closure artifact (canonical JSON; the file's sha256 under RFC 8785 is printed).
 * Exit code: 0 consistent (and, for reach, no blocker); 2 not executed or blocking findings.
 * It does NOT feed any proof runner: its output is evidence for review only.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  buildClosureArtifact,
  censusTree,
  checkEntrypointComposition,
  computeClosure,
  gitTreeReader,
  isTestPath,
} from '../src/index';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const command = process.argv[2];
  const repo = arg('repo');
  const treeish = arg('treeish');
  const out = arg('out');
  if ((command !== 'check' && command !== 'reach') || repo === undefined || treeish === undefined) {
    console.error('usage: entrypoints-cli.ts <check|reach> --repo <dir> --treeish <rev> [--out <file>]');
    return 2;
  }
  const git = (args: readonly string[], input?: Uint8Array): Uint8Array => {
    const r = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr)}`);
    return r.stdout;
  };
  const commit = Buffer.from(git(['rev-parse', '--verify', `${treeish}^{commit}`])).toString('utf8').trim();
  const tree = Buffer.from(git(['rev-parse', '--verify', `${treeish}^{tree}`])).toString('utf8').trim();
  const reader = gitTreeReader(git, tree);

  const check = checkEntrypointComposition(reader);
  if (check.outcome !== 'consistent') {
    console.log(JSON.stringify({ commit, tree, outcome: check.outcome, problems: check.problems }, null, 2));
    return 2;
  }
  const entryFiles = check.file.entries.map((e) => e.entry_file);
  const summary = {
    commit,
    tree,
    outcome: check.outcome,
    derived_sha256: check.derived_sha256,
    entrypoints_file_jcs_sha256: check.file_jcs_sha256,
    entrypoints_file_bytes_sha256: check.file_bytes_sha256,
    launched_by: check.launched_by,
  };
  if (command === 'check') {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  if (out === undefined) {
    console.error('reach needs --out');
    return 2;
  }

  const closure = computeClosure(reader, entryFiles);
  const census = censusTree(reader, closure.union_all);
  const { artifact, sha256 } = buildClosureArtifact({
    commit,
    tree,
    entrypoints: {
      derived_sha256: check.derived_sha256,
      file_jcs_sha256: check.file_jcs_sha256,
      file_bytes_sha256: check.file_bytes_sha256,
      entry_files: entryFiles,
      not_production_files: check.file.not_production.map((n) => n.entry_file),
    },
    closure,
    census,
    test_files_in_union: closure.union_all.filter(isTestPath),
  });
  fs.writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        ...summary,
        closure_artifact_sha256_jcs: sha256,
        per_root: artifact.per_root,
        union_all: artifact.union_all.length,
        union_value: artifact.union_value_count,
        unresolved_count: artifact.unresolved_count,
        test_files_in_union: artifact.test_files_in_union.length,
        census: { ...census, hits: undefined },
      },
      null,
      2,
    ),
  );
  return artifact.unresolved_count === 0 ? 0 : 2;
}

process.exitCode = main();
