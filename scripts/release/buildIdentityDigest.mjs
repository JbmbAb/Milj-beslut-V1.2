/**
 * W-U42 (U42a) -- the ONE algorithm behind the measured release identity (contract product-release-v3).
 *
 * "Mätning, inte deklaration" (U40-U50B-SPEC §1.6; owner decision 2026-10-02 row 4): the build measures the files it
 * delivers and writes release-identity.json (scripts/release/write-build-identity.mjs); every process re-measures the
 * same files at start (server/modules/release/productReleaseBuildIdentity.ts) and refuses to start on a deviation.
 * Both sides import THIS module, so there is exactly one definition of what is measured and how. Plain Node, no
 * dependencies: it runs in the image build (`node scripts/release/write-build-identity.mjs` in production-base) and in the product
 * processes (`node --import tsx`), and it never reads the current working directory -- every function takes the
 * delivered root explicitly (U40-A2 finding R8).
 *
 * What is measured (W-U42C, owner decisions Round 22 ÄF-U42B-2 and Round 26 Ä4/Ä5): EVERYTHING under the delivered
 * root, recursively -- server/, src/, packages/, prisma/, dist/, services/, scripts/ (this measuring code included),
 * app/, config/, types/, stubs/, the root *.ts, tsconfig.json, the three V1/V2 files and node_modules as bytes at any
 * depth (the generated Prisma client included) -- except the top-level names in DELIVERED_ROOT_EXCLUSIONS, each with
 * its written reason. A file production-base delivers later is therefore measured without changing this module.
 *
 * Listing form (pinned by tests/unit/productReleaseBuildIdentity.test.ts): one line per entry, sorted by its
 * posix-relative path in BYTE order -- a regular file as `<path>\0<sha256 hex of the bytes>\n`, a symbolic link (also a
 * directory junction) as `<path>\0symlink:<link target text, unchanged>\n`; the digest is the sha256 of the concatenated
 * lines. A link is never followed (its target's bytes are measured where they lie in the root, or nowhere), never
 * silently skipped, and a link that points out of the delivered root is refused: the bytes it would run lie outside
 * the measurement. Any other entry type (FIFO, socket, device) is refused as well.
 *
 * What this does NOT do: the measuring code is inside what it measures (scripts/release/), but a measurer cannot vouch
 * for itself against someone who can change it -- a changed measurer can report the expected digest. The coverage
 * catches accidental or incomplete manipulation and drift of the delivered files; the protection against a changed
 * measurer is that the delivered runtime is not writable by the process user (Dockerfile production-base, W-U42C IN-5)
 * plus the image's own identity. It is a reproducibility/identity check of the deployment, nothing more.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The name of the file the build writes next to package.json and the processes read from their own root. */
export const RELEASE_IDENTITY_FILE_NAME = 'release-identity.json';
/** The contract the identity file is written for; the TypeScript contract pins the same literal. */
export const RELEASE_IDENTITY_CONTRACT_VERSION = 'product-release-v3';

/**
 * The ONLY top-level names under the delivered root that are not part of `source_digest_sha256`, each with its reason.
 * Top-level names only: a nested directory with one of these names is measured. Pinned by tests; the Dockerfile tests
 * pin that production-base delivers nothing into them.
 */
export const DELIVERED_ROOT_EXCLUSIONS = Object.freeze({
  '.git':
    "a checkout's version-control state: it changes with every git command, and the build takes the commit and tree " +
    'from git and refuses a dirty checkout instead; production-base never copies a .git into the image',
  [RELEASE_IDENTITY_FILE_NAME]: 'the identity itself, written after the measurement it records',
  storage:
    'the one writable runtime directory (W-U42C IN-5): uploads, drafts, temporary and ingest files the web process ' +
    'writes under its working directory; data, never code -- created empty by production-base, owned by the process ' +
    'user, and nothing resolves modules from it',
});
/**
 * The composition manifest: the recipe and its context rules. The image build streams them in the context, but
 * production-base does not copy them into the delivered /app, so there the value is declared by the build.
 */
export const COMPOSITION_MANIFEST_PATHS = Object.freeze(['Dockerfile', '.dockerignore', 'deploy/onprem']);
/** Build-time variables baked into dist/ (e.g. VITE_DEMO_LOGIN, U40-U50B-SPEC §1.6). */
export const BUILD_ARGS_PREFIXES = Object.freeze(['VITE_']);
/** The three V1/V2 identity files, now MEASURED over the delivered tree instead of read from the working directory. */
export const LEGACY_IDENTITY_FILES = Object.freeze({
  package_lock_sha256: 'package-lock.json',
  package_manifest_sha256: 'package.json',
  runtime_entrypoint_sha256: 'server/index.ts',
});

/** @param {string | Uint8Array} bytes */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} absolutePath */
export function sha256File(absolutePath) {
  return sha256Hex(fs.readFileSync(absolutePath));
}

/** @param {string} root @param {string} rel */
function absolute(root, rel) {
  return path.join(root, ...rel.split('/'));
}

/** @param {string} a @param {string} b */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** @param {string} base @param {string} candidate */
function isInside(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * A link is registered, never followed; one that points out of the delivered root is refused, judged on its target
 * text (lexically, from the link's directory) and -- when the target exists -- on where it resolves (realpath).
 * @param {{ root: string; realRoot: string | null }} ctx @param {string} abs @param {string} rel
 */
function assertLinkInsideRoot(ctx, abs, rel) {
  const target = fs.readlinkSync(abs);
  let resolved = null;
  try {
    resolved = fs.realpathSync(abs);
  } catch {
    // a dangling link: only its text can be judged
  }
  if (resolved !== null && ctx.realRoot === null) ctx.realRoot = fs.realpathSync(ctx.root);
  if (!isInside(path.resolve(ctx.root), path.resolve(path.dirname(abs), target)) || (resolved !== null && !isInside(/** @type {string} */ (ctx.realRoot), resolved))) {
    throw new Error(`REJECT_BUILD_IDENTITY_LINK_OUTSIDE_ROOT: ${rel} -> ${target} points outside the delivered root ${ctx.root}; what it would run is not measured`);
  }
}

/**
 * @param {{ root: string; realRoot: string | null }} ctx @param {string} abs @param {string} rel
 * @param {import('node:fs').Stats | import('node:fs').Dirent} kind @param {string[]} out
 */
function visit(ctx, abs, rel, kind, out) {
  if (kind.isSymbolicLink()) {
    assertLinkInsideRoot(ctx, abs, rel);
    out.push(rel);
  } else if (kind.isDirectory()) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) visit(ctx, path.join(abs, entry.name), `${rel}/${entry.name}`, entry, out);
  } else if (kind.isFile()) {
    out.push(rel);
  } else {
    throw new Error(`REJECT_BUILD_IDENTITY_UNSUPPORTED_ENTRY: ${rel} under ${ctx.root} is neither a regular file, a directory nor a symbolic link`);
  }
}

/**
 * Every regular file and every symbolic link under the given posix-relative roots (a root may be a file, a link or a
 * directory), as posix-relative paths sorted in byte order. Links are listed, not
 * followed; node_modules is listed like any other directory.
 * @param {string} root @param {readonly string[]} relRoots @returns {string[]}
 */
export function listDeliveredFiles(root, relRoots) {
  const ctx = { root, realRoot: /** @type {string | null} */ (null) };
  /** @type {string[]} */
  const out = [];
  for (const rel of relRoots) {
    const abs = absolute(root, rel);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    visit(ctx, abs, rel, stat, out);
  }
  out.sort(compareBytes);
  return out;
}

/**
 * The listing digest over already-sorted posix-relative paths (see the module header for the form); `file_count`
 * counts the regular files, `symlink_count` the links.
 * @param {string} root @param {readonly string[]} relPaths @returns {{ digest: string; file_count: number; symlink_count: number }}
 */
function digestEntries(root, relPaths) {
  const hash = createHash('sha256');
  let links = 0;
  for (const rel of relPaths) {
    const abs = absolute(root, rel);
    hash.update(rel, 'utf8');
    hash.update('\0');
    if (fs.lstatSync(abs).isSymbolicLink()) {
      links += 1;
      hash.update(`symlink:${fs.readlinkSync(abs)}`, 'utf8');
    } else {
      hash.update(sha256File(abs), 'utf8');
    }
    hash.update('\n');
  }
  return { digest: hash.digest('hex'), file_count: relPaths.length - links, symlink_count: links };
}

/**
 * The listing digest over already-sorted posix-relative paths; `file_count` counts the regular files.
 * @param {string} root @param {readonly string[]} relPaths @returns {{ digest: string; file_count: number }}
 */
export function digestListing(root, relPaths) {
  const { digest, file_count } = digestEntries(root, relPaths);
  return { digest, file_count };
}

/** @param {string} abs */
function exists(abs) {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * `source_digest_sha256` over the whole delivered root except DELIVERED_ROOT_EXCLUSIONS (see the module header).
 * Throws REJECT_BUILD_IDENTITY_LINK_OUTSIDE_ROOT / REJECT_BUILD_IDENTITY_UNSUPPORTED_ENTRY instead of measuring around
 * an entry it cannot measure.
 * @param {string} root
 * @returns {{ source_digest_sha256: string; file_count: number; symlink_count: number }}
 */
export function measureSourceDigest(root) {
  const topLevel = fs.readdirSync(root).filter((name) => !Object.hasOwn(DELIVERED_ROOT_EXCLUSIONS, name));
  const { digest, file_count, symlink_count } = digestEntries(root, listDeliveredFiles(root, topLevel));
  return { source_digest_sha256: digest, file_count, symlink_count };
}

/**
 * `composition_manifest_sha256` when ALL composition paths are present under `root`; null otherwise (production-base
 * does not copy them into the delivered /app, so there the value can only be declared by the build, never measured).
 * @param {string} root
 * @returns {{ composition_manifest_sha256: string; file_count: number } | null}
 */
export function measureCompositionManifest(root) {
  if (!COMPOSITION_MANIFEST_PATHS.every((rel) => exists(absolute(root, rel)))) return null;
  const files = listDeliveredFiles(root, COMPOSITION_MANIFEST_PATHS);
  const { digest, file_count } = digestListing(root, files);
  return { composition_manifest_sha256: digest, file_count };
}

/**
 * `build_args_sha256`: sha256 over the sorted-key JSON of the build-time variables (names with a BUILD_ARGS_PREFIXES
 * prefix) present in `env`. Only the NAMES are reported; values enter the hash and are never printed.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ build_args_sha256: string; names: string[] }}
 */
export function measureBuildArgs(env) {
  const names = Object.keys(env)
    .filter((name) => BUILD_ARGS_PREFIXES.some((prefix) => name.startsWith(prefix)) && typeof env[name] === 'string')
    .sort(compareBytes);
  /** @type {Record<string, string>} */
  const canonical = {};
  for (const name of names) canonical[name] = /** @type {string} */ (env[name]);
  return { build_args_sha256: sha256Hex(JSON.stringify(canonical)), names };
}

/**
 * The three V1/V2 hashes, measured over the delivered files under `root`. A missing file is an error, never an
 * empty hash: an identity must cover what the contract names.
 * @param {string} root
 * @returns {{ package_lock_sha256: string; package_manifest_sha256: string; runtime_entrypoint_sha256: string }}
 */
export function measureLegacyIdentityHashes(root) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [field, rel] of Object.entries(LEGACY_IDENTITY_FILES)) {
    const abs = absolute(root, rel);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) throw new Error(`REJECT_BUILD_IDENTITY_FILE_MISSING: ${rel} is not delivered under ${root}`);
    out[field] = sha256File(abs);
  }
  return /** @type {{ package_lock_sha256: string; package_manifest_sha256: string; runtime_entrypoint_sha256: string }} */ (out);
}

/**
 * Deterministic JSON: object keys sorted (byte order), arrays in order, two-space indent, LF line ends. The identity
 * file is written with it so two builds of one tree give byte-identical files.
 * @param {unknown} value @param {string} [indent]
 * @returns {string}
 */
export function stableJson(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + '  ';
    return `[\n${value.map((v) => `${inner}${stableJson(v, inner)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value)).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    entries.sort(([a], [b]) => compareBytes(a, b));
    const inner = indent + '  ';
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stableJson(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}
