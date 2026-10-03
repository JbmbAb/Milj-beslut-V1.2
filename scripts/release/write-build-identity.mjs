#!/usr/bin/env node
/**
 * W-U42 (U42a) -- the build writes the measured release identity: `release-identity.json`.
 *
 *   node scripts/release/write-build-identity.mjs [--root <dir>] [--source-commit <sha1>] [--source-tree <sha1>]
 *        [--composition-manifest-sha256 <sha256>] [--out <file>]
 *   node scripts/release/write-build-identity.mjs [--root <dir>] --print composition
 *
 * What it does (U40-U50B-SPEC §1.6 "Mätning, inte deklaration"):
 *  - measures, with the ONE algorithm (./buildIdentityDigest.mjs), the delivered source digest, the three V1/V2 file
 *    hashes, the build-time VITE_* variables and -- when Dockerfile, .dockerignore and deploy/onprem are present --
 *    the composition manifest;
 *  - takes the source commit and tree from git when the root is a checkout, and then ONLY from a clean one: a dirty
 *    checkout (modified, added, deleted or untracked paths) gets NO identity (REJECT_BUILD_IDENTITY_DIRTY_CHECKOUT);
 *    a declared --source-commit/--source-tree must then equal HEAD (REJECT_BUILD_IDENTITY_SOURCE_MISMATCH);
 *  - without a checkout (the image build from `git archive <SHA>`, which carries no .git and dockerignores the
 *    composition files) the commit, tree and composition hash MUST be declared by the caller
 *    (deploy/onprem/build-image.sh does; a plain `docker build` without them fails: nothing is guessed);
 *  - a measured composition is never overridden by a different declared value (REJECT_BUILD_IDENTITY_COMPOSITION_MISMATCH);
 *  - the root defaults to the repository this script lives in, never to the current working directory (U40-A2 R8).
 *
 * Output: `<root>/release-identity.json` in deterministic JSON (two builds of one tree give identical bytes; no
 * timestamps), plus one JSON summary line on stdout. Values of build-time variables are hashed, never printed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIGEST_EXCLUDED_DIR_NAMES,
  RELEASE_IDENTITY_CONTRACT_VERSION,
  RELEASE_IDENTITY_FILE_NAME,
  SOURCE_DIGEST_ROOTS,
  measureBuildArgs,
  measureCompositionManifest,
  measureLegacyIdentityHashes,
  measureSourceDigest,
  stableJson,
} from './buildIdentityDigest.mjs';

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** @param {string} code @param {string} detail @returns {never} */
function fail(code, detail) {
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(1);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  const known = new Set(['--root', '--source-commit', '--source-tree', '--composition-manifest-sha256', '--out', '--print']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!known.has(arg)) fail('REJECT_BUILD_IDENTITY_MALFORMED_ARGUMENT', `unknown argument ${JSON.stringify(arg)}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail('REJECT_BUILD_IDENTITY_MALFORMED_ARGUMENT', `${arg} needs a value`);
    opts[arg.slice(2)] = value;
    i += 1;
  }
  return opts;
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    fail('REJECT_BUILD_IDENTITY_GIT_UNAVAILABLE', `git ${args.join(' ')} failed under ${root}: ${result.error ? result.error.message : result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** @param {string | undefined} value @param {string} name @param {RegExp} form @param {string} formText */
function optionalHex(value, name, form, formText) {
  if (value === undefined) return undefined;
  if (!form.test(value)) fail('REJECT_BUILD_IDENTITY_MALFORMED_ARGUMENT', `${name} must be ${formText} lower-case hex characters`);
  return value;
}

const opts = parseArgs(process.argv.slice(2));
const scriptRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.resolve(opts.root ?? scriptRepoRoot);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('REJECT_BUILD_IDENTITY_ROOT_MISSING', `${root} is not a directory`);

if (opts.print !== undefined) {
  if (opts.print !== 'composition') fail('REJECT_BUILD_IDENTITY_MALFORMED_ARGUMENT', `--print accepts only "composition"`);
  const composition = measureCompositionManifest(root);
  if (!composition) fail('REJECT_BUILD_IDENTITY_COMPOSITION_UNKNOWN', `Dockerfile, .dockerignore and deploy/onprem are not all present under ${root}`);
  process.stdout.write(`${composition.composition_manifest_sha256}\n`);
  process.exit(0);
}

const declaredCommit = optionalHex(opts['source-commit'], '--source-commit', HEX40, '40');
const declaredTree = optionalHex(opts['source-tree'], '--source-tree', HEX40, '40');
const declaredComposition = optionalHex(opts['composition-manifest-sha256'], '--composition-manifest-sha256', HEX64, '64');
const outPath = path.resolve(opts.out ?? path.join(root, RELEASE_IDENTITY_FILE_NAME));
const outRelPosix = path.relative(root, outPath).split(path.sep).join('/');

// 1. Source: a clean checkout, or a declared commit/tree when there is no checkout.
/** @type {{ kind: 'git-worktree' | 'declared'; commit: string; tree: string }} */
let source;
if (fs.existsSync(path.join(root, '.git'))) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line.length > 3)
    // the file this very script writes is not a change of the source
    .filter((line) => line.slice(3).replace(/^"|"$/g, '') !== outRelPosix);
  if (dirty.length > 0) {
    fail(
      'REJECT_BUILD_IDENTITY_DIRTY_CHECKOUT',
      `${dirty.length} path(s) differ from HEAD ${head} (first: ${dirty.slice(0, 5).map((l) => l.slice(3)).join(', ')}); a dirty checkout gets no release identity`,
    );
  }
  if (declaredCommit !== undefined && declaredCommit !== head) fail('REJECT_BUILD_IDENTITY_SOURCE_MISMATCH', `--source-commit ${declaredCommit} is not HEAD ${head} of ${root}`);
  if (declaredTree !== undefined && declaredTree !== tree) fail('REJECT_BUILD_IDENTITY_SOURCE_MISMATCH', `--source-tree ${declaredTree} is not HEAD^{tree} ${tree} of ${root}`);
  source = { kind: 'git-worktree', commit: head, tree };
} else {
  if (declaredCommit === undefined || declaredTree === undefined) {
    fail(
      'REJECT_BUILD_IDENTITY_SOURCE_UNKNOWN',
      `${root} is not a git checkout and --source-commit/--source-tree were not both given: the build must declare the exact commit and tree it was made from (deploy/onprem/build-image.sh does)`,
    );
  }
  source = { kind: 'declared', commit: declaredCommit, tree: declaredTree };
}

// 2. Composition: measured when delivered, declared when not; never both in conflict.
const measuredComposition = measureCompositionManifest(root);
/** @type {{ sha256: string; source: 'measured' | 'declared'; file_count: number | null }} */
let composition;
if (measuredComposition) {
  if (declaredComposition !== undefined && declaredComposition !== measuredComposition.composition_manifest_sha256) {
    fail('REJECT_BUILD_IDENTITY_COMPOSITION_MISMATCH', `--composition-manifest-sha256 ${declaredComposition} differs from the measured ${measuredComposition.composition_manifest_sha256} under ${root}`);
  }
  composition = { sha256: measuredComposition.composition_manifest_sha256, source: 'measured', file_count: measuredComposition.file_count };
} else {
  if (declaredComposition === undefined) {
    fail(
      'REJECT_BUILD_IDENTITY_COMPOSITION_UNKNOWN',
      `Dockerfile, .dockerignore and deploy/onprem are not all delivered under ${root} (an image build from git archive excludes them) and no --composition-manifest-sha256 was given`,
    );
  }
  composition = { sha256: declaredComposition, source: 'declared', file_count: null };
}

// 3. Measurements over the delivered tree.
const sourceDigest = measureSourceDigest(root);
if (sourceDigest.roots_present.length === 0) fail('REJECT_BUILD_IDENTITY_NO_SOURCE_ROOTS', `none of ${SOURCE_DIGEST_ROOTS.join(', ')} exists under ${root}`);
const buildArgs = measureBuildArgs(process.env);
let legacy;
try {
  legacy = measureLegacyIdentityHashes(root);
} catch (error) {
  fail('REJECT_BUILD_IDENTITY_FILE_MISSING', error instanceof Error ? error.message : String(error));
}

const identity = {
  contract_version: RELEASE_IDENTITY_CONTRACT_VERSION,
  build_identity: {
    ...legacy,
    source_commit_sha: source.commit,
    source_tree_sha: source.tree,
    source_digest_sha256: sourceDigest.source_digest_sha256,
    composition_manifest_sha256: composition.sha256,
    build_args_sha256: buildArgs.build_args_sha256,
  },
  measurement: {
    source: { kind: source.kind },
    source_digest: {
      roots: [...SOURCE_DIGEST_ROOTS],
      roots_present: sourceDigest.roots_present,
      excluded_dir_names: [...DIGEST_EXCLUDED_DIR_NAMES],
      file_count: sourceDigest.file_count,
    },
    composition_manifest: { source: composition.source, file_count: composition.file_count },
    build_args: { names: buildArgs.names },
  },
};

fs.writeFileSync(outPath, `${stableJson(identity)}\n`);
process.stdout.write(
  `${JSON.stringify({
    written: outPath,
    source_kind: source.kind,
    source_commit_sha: source.commit,
    source_tree_sha: source.tree,
    source_digest_sha256: sourceDigest.source_digest_sha256,
    source_file_count: sourceDigest.file_count,
    composition_manifest_sha256: composition.sha256,
    composition_source: composition.source,
    build_args: buildArgs.names,
  })}\n`,
);
