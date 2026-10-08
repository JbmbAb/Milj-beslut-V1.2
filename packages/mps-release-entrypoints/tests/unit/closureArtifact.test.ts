import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildClosureArtifact, censusTree, checkEntrypointComposition, computeClosure, gitTreeReader, isTestPath, memoryTreeReader } from '../../src/index';
import type { TreeReader } from '../../src/index';
import { baseFiles } from './fixtures';

function artifactFor(tree: TreeReader, commit: string, treeId: string, watch: readonly string[] = []) {
  const check = checkEntrypointComposition(tree);
  if (check.outcome !== 'consistent') throw new Error('fixture is not consistent');
  const entryFiles = check.file.entries.map((e) => e.entry_file);
  const closure = computeClosure(tree, entryFiles);
  const census = censusTree(tree, closure.union_all);
  return buildClosureArtifact({
    commit,
    tree: treeId,
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
    watch_files: watch,
  });
}

const files = (): Record<string, string> => ({ 'tsconfig.json': '{}', ...baseFiles() });
const COMMIT_A = 'a'.repeat(40);
const TREE_A = '1'.repeat(40);

describe('closure artifact: deterministic and bound to the commit and tree', () => {
  it('is identical on two runs over the same tree, whatever the order the files were given in', () => {
    const one = artifactFor(memoryTreeReader(files()), COMMIT_A, TREE_A);
    const reversed = Object.fromEntries(Object.entries(files()).reverse());
    const two = artifactFor(memoryTreeReader(reversed), COMMIT_A, TREE_A);
    expect(two.sha256).toBe(one.sha256);
    expect(JSON.stringify(two.artifact)).toBe(JSON.stringify(one.artifact));
  });
  it('names the commit and the tree, and a different commit or tree gives a different artifact', () => {
    const base = artifactFor(memoryTreeReader(files()), COMMIT_A, TREE_A);
    expect(base.artifact.subject).toEqual({ commit: COMMIT_A, tree: TREE_A });
    expect(artifactFor(memoryTreeReader(files()), 'b'.repeat(40), TREE_A).sha256).not.toBe(base.sha256);
    expect(artifactFor(memoryTreeReader(files()), COMMIT_A, '2'.repeat(40)).sha256).not.toBe(base.sha256);
  });
  it('changes when the closure changes (a new import in a root)', () => {
    const base = artifactFor(memoryTreeReader(files()), COMMIT_A, TREE_A);
    const changed = { ...files(), 'server/index.ts': files()['server/index.ts'] + "import './extra';\n", 'server/extra.ts': '' };
    expect(artifactFor(memoryTreeReader(changed), COMMIT_A, TREE_A).sha256).not.toBe(base.sha256);
  });
  it('reports, per root, whether a watched file is in the closure', () => {
    const { artifact } = artifactFor(memoryTreeReader(files()), COMMIT_A, TREE_A, ['server/workers/bootstrap.ts', 'server/app.ts', 'server/not-there.ts']);
    expect(artifact.watched).toEqual([
      { file: 'server/app.ts', in_union_all: true, in_union_value: true, roots_all: ['server/index.ts'], roots_value: ['server/index.ts'] },
      { file: 'server/not-there.ts', in_union_all: false, in_union_value: false, roots_all: [], roots_value: [] },
      { file: 'server/workers/bootstrap.ts', in_union_all: true, in_union_value: true, roots_all: ['server/workers/a-worker.ts'], roots_value: ['server/workers/a-worker.ts'] },
    ]);
  });
  it('carries no timestamp, absolute path, machine name or user name', () => {
    const text = JSON.stringify(artifactFor(memoryTreeReader(files()), COMMIT_A, TREE_A).artifact);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(text).not.toContain(os.hostname());
    expect(text).not.toContain(os.userInfo().username);
  });
});

describe('git object reader (the working directory is never consulted)', () => {
  it('reads the committed bytes, not later edits, and gives the same closure as the in-memory tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u51-d-git-'));
    try {
      const git = (...args: string[]): string => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' }).trim();
      git('init', '-q');
      const all = files();
      for (const [p, content] of Object.entries(all)) {
        fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
        fs.writeFileSync(path.join(dir, p), content);
      }
      git('add', '-A');
      git('commit', '-q', '-m', 'fixture');
      const commit = git('rev-parse', 'HEAD');
      const treeId = git('rev-parse', 'HEAD^{tree}');
      // edit the working tree AFTER the commit: the reader must not see it
      fs.writeFileSync(path.join(dir, 'server/index.ts'), "import './not-committed';\n");
      const run = (args: readonly string[], input?: Uint8Array): Uint8Array => {
        const r = spawnSync('git', ['-C', dir, ...args], { input, maxBuffer: 1 << 28 });
        if (r.status !== 0) throw new Error(String(r.stderr));
        return r.stdout;
      };
      const fromGit = artifactFor(gitTreeReader(run, treeId), commit, treeId);
      const fromMemory = artifactFor(memoryTreeReader(all), commit, treeId);
      expect(fromGit.sha256).toBe(fromMemory.sha256);
      expect(fromGit.artifact.union_all).not.toContain('server/not-committed.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
