/**
 * Static adapter, dependency-manifest scan (contract 6.3, profile GUARD_PLUS_DEPENDENCY_MANIFESTS; OD-5a).
 *
 * The DESIGN is the contract's: list the policy's manifests with their git blob sha1, hash the forbidden-package
 * pattern list, digest the manifest set, count hits. The forbidden-package pattern VALUES are the owner's (OD-5a)
 * and arrive through the policy; nothing here knows a provider name.
 *
 * Mechanism chosen here (the contract leaves it open): a pattern matches a PACKAGE NAME case-insensitively as a
 * substring. For package.json and package-lock.json the names are read structurally (every dependency section,
 * alias targets of `npm:` specifiers, every `packages` / `dependencies` entry of a lockfile); any other manifest is
 * scanned line by line as text. A hit is counted once per (manifest, name).
 */
import { createHash } from 'node:crypto';
import { hashJcs } from '../canonical';
import { compareBytewise, isRecord, type Rec } from '../json';
import { gitBlobSha1 } from './gitObjects';

export interface DependencyScanPolicy {
  readonly manifests: readonly string[];
  readonly forbidden_package_patterns: readonly string[];
}
export interface ManifestFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}
export interface DependencyScanFacts {
  readonly manifests: readonly { readonly path: string; readonly blob_sha1: string }[];
  readonly forbidden_patterns_sha256: string;
  readonly derived_digest_sha256: string;
  readonly hits_count: number;
  /** audit only */
  readonly hits: readonly { readonly manifest: string; readonly name: string; readonly pattern: string }[];
}

/** SHA-256 over lines `path\0blob_sha1\n` in bytewise path order (the digest basis of contract 6.3). */
export function filesetDigest(files: readonly { readonly path: string; readonly blob_sha1: string }[]): string {
  const sorted = [...files].sort((a, b) => compareBytewise(a.path, b.path));
  const hash = createHash('sha256');
  for (const f of sorted) hash.update(`${f.path}\0${f.blob_sha1}\n`, 'utf8');
  return hash.digest('hex');
}

const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions'] as const;

function namesFromPackageJson(json: Rec, into: Set<string>): void {
  const addSpecifier = (name: string, spec: unknown): void => {
    into.add(name);
    if (typeof spec === 'string' && spec.startsWith('npm:')) {
      const target = spec.slice(4);
      into.add(target.startsWith('@') ? `@${target.slice(1).split('@')[0]}` : target.split('@')[0]!);
    }
  };
  const walk = (section: unknown): void => {
    if (!isRecord(section)) return;
    for (const [name, spec] of Object.entries(section)) {
      addSpecifier(name, spec);
      if (isRecord(spec)) walk(spec);
    }
  };
  for (const key of SECTIONS) walk(json[key]);
  if (Array.isArray(json.bundledDependencies)) for (const b of json.bundledDependencies) if (typeof b === 'string') into.add(b);
}

function namesFromLockfile(json: Rec, into: Set<string>): void {
  if (isRecord(json.packages)) {
    for (const [key, value] of Object.entries(json.packages)) {
      const at = key.lastIndexOf('node_modules/');
      if (at >= 0) into.add(key.slice(at + 'node_modules/'.length));
      if (isRecord(value)) {
        if (typeof value.name === 'string') into.add(value.name);
        namesFromPackageJson(value, into);
      }
    }
  }
  const legacy = (tree: unknown): void => {
    if (!isRecord(tree)) return;
    for (const [name, entry] of Object.entries(tree)) {
      into.add(name);
      if (isRecord(entry)) legacy(entry.dependencies);
    }
  };
  legacy(json.dependencies);
}

function namesOf(file: ManifestFile): { names: string[]; textual: boolean } {
  const base = file.path.split('/').pop() ?? file.path;
  const text = Buffer.from(file.bytes).toString('utf8');
  if (base === 'package.json' || base === 'package-lock.json' || base === 'npm-shrinkwrap.json') {
    try {
      const json: unknown = JSON.parse(text);
      if (isRecord(json)) {
        const names = new Set<string>();
        if (base === 'package.json') namesFromPackageJson(json, names);
        else {
          namesFromLockfile(json, names);
          namesFromPackageJson(json, names);
        }
        return { names: [...names], textual: false };
      }
    } catch {
      /* fall through: scan as text, which is stricter, not looser */
    }
  }
  return { names: text.split(/\r?\n/), textual: true };
}

/**
 * `files` are the policy's manifests as found in the subject tree (the caller reads them from git objects). A manifest
 * the policy names but the tree lacks is the caller's AdapterUnavailable: the scan cannot be made.
 */
export function scanDependencyManifests(files: readonly ManifestFile[], policy: DependencyScanPolicy): DependencyScanFacts {
  const wanted = new Set(policy.manifests);
  const seen = new Set(files.map((f) => f.path));
  if (files.some((f) => !wanted.has(f.path)) || policy.manifests.some((m) => !seen.has(m))) {
    throw new Error('the files given are not exactly the manifests of the policy');
  }
  const hits: { manifest: string; name: string; pattern: string }[] = [];
  const listed = files.map((f) => ({ path: f.path, blob_sha1: gitBlobSha1(f.bytes) }));
  for (const file of [...files].sort((a, b) => compareBytewise(a.path, b.path))) {
    const { names, textual } = namesOf(file);
    const unique = textual ? names : [...new Set(names)];
    for (const name of unique) {
      const lower = name.toLowerCase();
      const pattern = policy.forbidden_package_patterns.find((p) => p.length > 0 && lower.includes(p.toLowerCase()));
      if (pattern !== undefined) hits.push({ manifest: file.path, name: textual ? name.trim() : name, pattern });
    }
  }
  return {
    manifests: [...listed].sort((a, b) => compareBytewise(a.path, b.path)),
    forbidden_patterns_sha256: hashJcs(policy.forbidden_package_patterns),
    derived_digest_sha256: filesetDigest(listed),
    hits_count: hits.length,
    hits,
  };
}
