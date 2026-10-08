/**
 * Subject identity from the git object database. A dirty worktree or a HEAD that is not the
 * requested commit cannot supply boot evidence.
 */
import { spawnSync } from 'node:child_process';
import { resolveSubject, type Subject } from '../gitTree.js';

function git(repo: string, args: string[]): string {
  const run = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 16 << 20 });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${run.status}): ${run.stderr.trim()}`);
  }
  return run.stdout;
}

export type ExactCheckout =
  | { readonly ok: true; readonly subject: Subject }
  | { readonly ok: false; readonly blocker: 'HEAD_IS_NOT_SUBJECT' | 'DIRTY_SUBJECT' | 'GIT_REV_NOT_READ' };

export function assertExactCheckout(repo: string, rev: string): ExactCheckout {
  let subject: Subject;
  let head: string;
  try {
    subject = resolveSubject(repo, rev);
    head = git(repo, ['rev-parse', 'HEAD']).trim();
  } catch {
    return { ok: false, blocker: 'GIT_REV_NOT_READ' };
  }
  if (head !== subject.commit_sha) return { ok: false, blocker: 'HEAD_IS_NOT_SUBJECT' };
  let porcelain: string;
  try {
    porcelain = git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);
  } catch {
    return { ok: false, blocker: 'GIT_REV_NOT_READ' };
  }
  if (porcelain.trim() !== '') return { ok: false, blocker: 'DIRTY_SUBJECT' };
  return { ok: true, subject };
}

/** Blob id of `commit:path`, or undefined when the path is not in that tree. */
export function blobIdAt(repo: string, commit: string, path: string): string | undefined {
  const run = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', `${commit}:${path}`], { encoding: 'utf8' });
  if (run.status !== 0) return undefined;
  const sha = run.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}
