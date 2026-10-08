import fs from 'node:fs';
import path from 'node:path';
import type { TreeReader } from './types';

/** An in-memory tree (tests, synthetic trees). */
export function memoryTreeReader(files: Readonly<Record<string, string>>): TreeReader {
  const map = new Map(Object.entries(files));
  return {
    read: (p) => map.get(p) ?? null,
    has: (p) => map.has(p),
    listUnder: (prefix) => [...map.keys()].filter((k) => prefix === '' || k.startsWith(`${prefix}/`)).sort(),
  };
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

/** A working directory. Reads only below `root`; never follows a path out of it. node_modules and .git are not part of the tree. */
export function fsTreeReader(root: string): TreeReader {
  const abs = (p: string): string => path.join(root, ...p.split('/'));
  const listDir = (relative: string, out: string[]): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(abs(relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (SKIPPED_DIRECTORIES.has(d.name)) continue;
      const rel = relative === '' ? d.name : `${relative}/${d.name}`;
      if (d.isDirectory()) listDir(rel, out);
      else if (d.isFile()) out.push(rel);
    }
  };
  return {
    read: (p) => {
      try {
        return fs.readFileSync(abs(p), 'utf8');
      } catch {
        return null;
      }
    },
    has: (p) => {
      try {
        return fs.statSync(abs(p)).isFile();
      } catch {
        return false;
      }
    },
    listUnder: (prefix) => {
      const out: string[] = [];
      listDir(prefix, out);
      return out.sort();
    },
  };
}

/**
 * Runs `git` with the given arguments (and optional stdin) and returns stdout. Injected so this module spawns no
 * process itself; the CLI supplies the implementation.
 */
export type GitRunner = (args: readonly string[], input?: Uint8Array) => Uint8Array;

/**
 * A git tree/commit as a TreeReader: file names from `ls-tree -r`, contents from `cat-file --batch` on the OBJECTS
 * `<treeish>:<path>`; the working directory is never consulted. Symbolic links and submodule entries are not files
 * of this reader (only regular blobs are listed).
 */
export function gitTreeReader(run: GitRunner, treeish: string): TreeReader {
  const listing = Buffer.from(run(['ls-tree', '-r', '-z', '--full-tree', treeish])).toString('utf8');
  const files = new Set<string>();
  for (const record of listing.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const meta = record.slice(0, tab).split(' ');
    if (meta[1] === 'blob' && meta[0] !== '120000') files.add(record.slice(tab + 1));
  }
  const cache = new Map<string, string | null>();

  const fetch = (paths: readonly string[]): void => {
    const wanted = paths.filter((p) => files.has(p) && !cache.has(p));
    if (wanted.length === 0) return;
    const request = Buffer.from(wanted.map((p) => `${treeish}:${p}\n`).join(''), 'utf8');
    const out = Buffer.from(run(['cat-file', '--batch'], request));
    let offset = 0;
    for (const p of wanted) {
      const eol = out.indexOf(0x0a, offset);
      if (eol < 0) throw new Error(`git cat-file --batch: truncated answer at ${p}`);
      const header = out.subarray(offset, eol).toString('utf8').split(' ');
      offset = eol + 1;
      if (header[1] !== 'blob') {
        cache.set(p, null);
        continue;
      }
      const size = Number(header[2]);
      cache.set(p, out.subarray(offset, offset + size).toString('utf8'));
      offset += size + 1;
    }
  };

  return {
    read: (p) => {
      if (!files.has(p)) return null;
      if (!cache.has(p)) fetch([p]);
      return cache.get(p) ?? null;
    },
    has: (p) => files.has(p),
    listUnder: (prefix) => [...files].filter((f) => prefix === '' || f.startsWith(`${prefix}/`)).sort(),
    prefetch: fetch,
  };
}
