/**
 * W-U42 (U42a) -- the ONE algorithm behind the measured release identity (contract product-release-v3).
 *
 * "Mätning, inte deklaration" (U40-U50B-SPEC §1.6; owner decision 2026-10-02 row 4): the build measures the files it
 * delivers and writes release-identity.json (scripts/release/write-build-identity.mjs); every process re-measures the
 * same files at start (server/modules/release/productReleaseBuildIdentity.ts) and refuses to start on a deviation.
 * Both sides import THIS module, so there is exactly one definition of what is measured and how. Plain Node, no
 * dependencies: it runs in the image builder (`node scripts/release/write-build-identity.mjs`) and in the product
 * processes (`node --import tsx`), and it never reads the current working directory -- every function takes the
 * delivered root explicitly (U40-A2 finding R8).
 *
 * Listing form (pinned by tests/unit/productReleaseBuildIdentity.test.ts): for the regular files under the roots,
 * sorted by their posix-relative path in BYTE order, one line each `<path>\0<sha256 hex of the bytes>\n`; the digest
 * is the sha256 of the concatenated lines. `node_modules` directories are skipped wherever they occur, and symbolic
 * links (also directory junctions) are never followed nor counted.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The name of the file the build writes next to package.json and the processes read from their own root. */
export const RELEASE_IDENTITY_FILE_NAME = 'release-identity.json';
/** The contract the identity file is written for; the TypeScript contract pins the same literal. */
export const RELEASE_IDENTITY_CONTRACT_VERSION = 'product-release-v3';

/** The delivered roots whose files form `source_digest_sha256`, in the order they are listed as present. */
export const SOURCE_DIGEST_ROOTS = Object.freeze(['server', 'src', 'packages', 'prisma', 'components', 'dist']);
/** Directory names skipped at any depth: installed dependencies are identified by the lock file, not by their bytes. */
export const DIGEST_EXCLUDED_DIR_NAMES = Object.freeze(['node_modules']);
/** The composition manifest: the recipe and its context rules. Not delivered inside the image (dockerignored). */
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

/** @param {string} absoluteDir @param {string} relDir @param {string[]} out */
function walk(absoluteDir, relDir, out) {
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (DIGEST_EXCLUDED_DIR_NAMES.includes(entry.name)) continue;
      walk(path.join(absoluteDir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

/**
 * Every regular file under the given posix-relative roots (a root may be a file or a directory; an absent root lists
 * nothing), as posix-relative paths sorted in byte order.
 * @param {string} root @param {readonly string[]} relRoots @returns {string[]}
 */
export function listDeliveredFiles(root, relRoots) {
  /** @type {string[]} */
  const out = [];
  for (const rel of relRoots) {
    const abs = absolute(root, rel);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) out.push(rel);
    else if (stat.isDirectory()) walk(abs, rel, out);
  }
  out.sort(compareBytes);
  return out;
}

/**
 * The listing digest over already-sorted posix-relative paths (see the module header for the form).
 * @param {string} root @param {readonly string[]} relPaths @returns {{ digest: string; file_count: number }}
 */
export function digestListing(root, relPaths) {
  const hash = createHash('sha256');
  for (const rel of relPaths) {
    hash.update(rel, 'utf8');
    hash.update('\0');
    hash.update(sha256File(absolute(root, rel)), 'utf8');
    hash.update('\n');
  }
  return { digest: hash.digest('hex'), file_count: relPaths.length };
}

/** @param {string} abs */
function isDirectory(abs) {
  try {
    return fs.lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} abs */
function exists(abs) {
  try {
    fs.lstatSync(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * `source_digest_sha256` over the delivered source roots that exist under `root`.
 * @param {string} root
 * @returns {{ source_digest_sha256: string; file_count: number; roots_present: string[] }}
 */
export function measureSourceDigest(root) {
  const rootsPresent = SOURCE_DIGEST_ROOTS.filter((rel) => isDirectory(absolute(root, rel)));
  const files = listDeliveredFiles(root, rootsPresent);
  const { digest, file_count } = digestListing(root, files);
  return { source_digest_sha256: digest, file_count, roots_present: rootsPresent };
}

/**
 * `composition_manifest_sha256` when ALL composition paths are delivered under `root`; null otherwise (inside the
 * image they are dockerignored, so there the value can only be declared by the build, never measured).
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
