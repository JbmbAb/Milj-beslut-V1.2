/**
 * Static adapter `subject` (contract 11.3): everything about the subject is read from the git OBJECT database,
 * never from the working tree, so a dirty or differently checked-out copy cannot change a fact.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveSubject } from '../../../mps-u51-generation-absence/src/index';
import { AdapterUnavailable, type SubjectObservation } from '../runner/prover';

export const gitBlobSha1 = (bytes: Uint8Array): string =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function git(repo: string, args: readonly string[]): { status: number | null; stdout: Buffer; stderr: string } {
  const run = spawnSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 30 });
  if (run.error !== undefined) throw new AdapterUnavailable(`git could not be run: ${run.error.message}`);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr?.toString('utf8').trim() ?? '' };
}

/** The commit and its tree. Throws AdapterUnavailable when the revision does not resolve to a commit. */
export function subjectObservation(repo: string, rev: string): SubjectObservation {
  try {
    const subject = resolveSubject(repo, rev);
    return { commit_sha: subject.commit_sha, commit_tree_sha: subject.tree_sha };
  } catch (error) {
    throw new AdapterUnavailable(`the subject could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The top level of the checkout that contains `repo` (for the I13 refusal). */
export function gitToplevel(repo: string): string {
  const run = git(repo, ['rev-parse', '--show-toplevel']);
  if (run.status !== 0) throw new Error(`not a git checkout: ${repo} (${run.stderr})`);
  return run.stdout.toString('utf8').trim();
}

/** Bytes of `path` in `tree`, or undefined when the tree has no such blob. */
export function readBlobAtTree(repo: string, tree: string, path: string): Buffer | undefined {
  const run = git(repo, ['cat-file', 'blob', `${tree}:${path}`]);
  return run.status === 0 ? run.stdout : undefined;
}
