/**
 * Reads the bytes of a commit's TREE from the git object database, never from the working tree. The census is
 * a statement about the subject tree, so a dirty or differently checked-out working copy cannot change it.
 */
import { spawnSync } from 'node:child_process';
import type { TreeEntry } from './staticCensus.js';

const HEX40 = /^[0-9a-f]{40}$/;
const BATCH = 400;

export interface Subject {
  readonly commit_sha: string;
  readonly tree_sha: string;
}

function git(repo: string, args: string[], input?: Buffer): Buffer {
  const run = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: 1 << 30 });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${run.status}): ${run.stderr?.toString('utf8').trim()}`);
  }
  return run.stdout;
}

export function resolveSubject(repo: string, rev: string): Subject {
  const commit = git(repo, ['rev-parse', '--verify', `${rev}^{commit}`]).toString('utf8').trim();
  const tree = git(repo, ['rev-parse', '--verify', `${commit}^{tree}`]).toString('utf8').trim();
  if (!HEX40.test(commit) || !HEX40.test(tree)) throw new Error('subject did not resolve to 40-hex commit and tree');
  return { commit_sha: commit, tree_sha: tree };
}

interface BlobRef {
  readonly path: string;
  readonly sha: string;
}

function listBlobs(repo: string, tree: string): BlobRef[] {
  const out = git(repo, ['ls-tree', '-r', '-z', '--full-tree', tree]).toString('utf8');
  const blobs: BlobRef[] = [];
  for (const record of out.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [, type, sha] = record.slice(0, tab).split(' ');
    if (type === 'blob') blobs.push({ path: record.slice(tab + 1), sha: sha! });
  }
  return blobs;
}

/** `git cat-file --batch` framing: "<sha> blob <size>\n<bytes>\n" per object. */
function parseBatch(buf: Buffer, expected: number): Buffer[] {
  const bodies: Buffer[] = [];
  let pos = 0;
  for (let i = 0; i < expected; i += 1) {
    const nl = buf.indexOf(0x0a, pos);
    const header = buf.subarray(pos, nl).toString('utf8').split(' ');
    if (header[1] !== 'blob') throw new Error(`unexpected object in batch: ${header.join(' ')}`);
    const size = Number(header[2]);
    bodies.push(buf.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
  return bodies;
}

/** Every blob of the tree, in path order, in bounded batches. Symlinks are blobs holding their target text. */
export function* iterateTreeEntries(repo: string, tree: string): Generator<TreeEntry> {
  const blobs = listBlobs(repo, tree).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 0; i < blobs.length; i += BATCH) {
    const slice = blobs.slice(i, i + BATCH);
    const out = git(repo, ['cat-file', '--batch'], Buffer.from(slice.map((b) => b.sha).join('\n') + '\n'));
    const bodies = parseBatch(out, slice.length);
    for (let j = 0; j < slice.length; j += 1) yield { path: slice[j]!.path, bytes: bodies[j]! };
  }
}
