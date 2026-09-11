#!/usr/bin/env node
// DEV-GOV authority capability / transport V1.
//
// Trust boundary:
//   * A candidate proof may declare ONLY `authority_requirement: { id }`.
//   * Everything else -- which bytes that id resolves to, where they come from,
//     the expected content identity, and where they are materialized -- is
//     decided by the protected catalog that ships with the controller commit.
//   * The catalog is located from this module's own path. There is deliberately
//     no CLI flag, environment variable or unit-definition field that can point
//     the resolver at a different catalog.
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256, stableJson } from './trusted-attestation.mjs';

export const AUTHORITY_CATALOG_SCHEMA = 'dev-gov-v1-authority-catalog';
export const AUTHORITY_CONTENT_DIGEST_ALGORITHM = 'dev-gov-authority-tree-sha256-v1';
export const AUTHORITY_CATALOG_RELATIVE_PATH = 'governance/devgov/authority/catalog-v1.json';

export const AUTHORITY_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  VERIFIED_READ_ONLY: 'VERIFIED_READ_ONLY',
  DENIED: 'DENIED',
});

export const AUTHORITY_DENIAL = Object.freeze({
  REQUIREMENT_INVALID: 'AUTHORITY_REQUIREMENT_INVALID',
  CATALOG_UNAVAILABLE: 'AUTHORITY_CATALOG_UNAVAILABLE',
  CATALOG_INVALID: 'AUTHORITY_CATALOG_INVALID',
  CATALOG_NOT_PROTECTED: 'AUTHORITY_CATALOG_NOT_PROTECTED',
  ID_UNKNOWN: 'AUTHORITY_ID_UNKNOWN',
  PROVIDER_UNSUPPORTED: 'AUTHORITY_PROVIDER_UNSUPPORTED',
  RETRIEVAL_UNAVAILABLE: 'AUTHORITY_RETRIEVAL_UNAVAILABLE',
  ARCHIVE_DIGEST_MISMATCH: 'AUTHORITY_ARCHIVE_DIGEST_MISMATCH',
  MATERIALIZATION_UNSAFE: 'AUTHORITY_MATERIALIZATION_UNSAFE',
  MATERIALIZATION_FAILED: 'AUTHORITY_MATERIALIZATION_FAILED',
  REQUIRED_ENTRY_MISSING: 'AUTHORITY_REQUIRED_ENTRY_MISSING',
  CONTENT_DIGEST_MISMATCH: 'AUTHORITY_CONTENT_DIGEST_MISMATCH',
  REFERENCE_DIGEST_MISMATCH: 'AUTHORITY_REFERENCE_DIGEST_MISMATCH',
  MATERIALIZATION_WRITABLE: 'AUTHORITY_MATERIALIZATION_WRITABLE',
  MATERIALIZATION_UNREADABLE: 'AUTHORITY_MATERIALIZATION_UNREADABLE',
  PROOF_IDENTITY_REQUIRED: 'AUTHORITY_PROOF_IDENTITY_REQUIRED',
  WRITABILITY_PROBE_FAILED: 'AUTHORITY_WRITABILITY_PROBE_FAILED',
  ENV_OVERRIDE_DENIED: 'AUTHORITY_ENV_OVERRIDE_DENIED',
  BINDING_MISMATCH: 'AUTHORITY_BINDING_MISMATCH',
});

const AUTHORITY_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/;
const HEX_256_PATTERN = /^[0-9a-f]{64}$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const RELEASE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

// Environment names the protected catalog may never bind, and prefixes reserved
// for the controller / runner. A catalog entry that tries to bind one of these
// is rejected before any retrieval happens.
const RESERVED_ENV_NAMES = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'PWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'IFS',
  'CDPATH',
]);
const RESERVED_ENV_PREFIXES = ['DEVGOV_', 'GITHUB_', 'ACTIONS_', 'RUNNER_', 'LD_', 'NODE_', 'NPM_'];

// Never handed to the unprivileged proof process.
export const AUTHORITY_RETRIEVAL_TOKEN_ENV = 'DEVGOV_AUTHORITY_TOKEN';
export const PROOF_ENV_DENYLIST = Object.freeze([AUTHORITY_RETRIEVAL_TOKEN_ENV, 'GITHUB_TOKEN', 'GH_TOKEN']);

function isReservedEnvName(name) {
  if (RESERVED_ENV_NAMES.has(name)) return true;
  return RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function controllerRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function protectedCatalogPath() {
  return join(controllerRoot(), ...AUTHORITY_CATALOG_RELATIVE_PATH.split('/'));
}

function posixRelative(root, target) {
  return relative(root, target).split('\\').join('/');
}

function containedIn(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (normalizedRoot === normalizedTarget) return true;
  const rel = relative(normalizedRoot, normalizedTarget);
  return rel.length > 0 && !rel.startsWith('..');
}

// ---------------------------------------------------------------------------
// Canonical content identity
// ---------------------------------------------------------------------------

// dev-gov-authority-tree-sha256-v1:
//   sha256(stableJson([[posixRelativePath, sha256(fileBytes)], ...])) over every
//   regular file in the tree, sorted by path. Symlinks and non-regular entries
//   are rejected outright rather than skipped, so a materialization cannot hide
//   content from the digest.
export function authorityTreeEntries(root) {
  const normalizedRoot = resolve(root);
  const entries = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `symbolic link is not permitted in authority materialization: ${posixRelative(normalizedRoot, absolute)}`,
        );
      }
      if (stats.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(
          `unsupported entry in authority materialization: ${posixRelative(normalizedRoot, absolute)}`,
        );
      }
      entries.push([posixRelative(normalizedRoot, absolute), sha256(readFileSync(absolute))]);
    }
  };
  walk(normalizedRoot);
  entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return entries;
}

export function authorityTreeDigest(root) {
  const entries = authorityTreeEntries(root);
  if (entries.length === 0) throw new Error('authority materialization is empty');
  return sha256(stableJson(entries));
}

// ---------------------------------------------------------------------------
// Candidate-declared requirement
// ---------------------------------------------------------------------------

// The candidate may say "I require authority capability X" and nothing else.
// Any additional key is an explicit denial, not a silently ignored field --
// otherwise a candidate could ship `expected_digest` or `source` and a later
// reader might believe it had been honoured.
export function readAuthorityRequirement(commandSpec) {
  const requirement = commandSpec?.authority_requirement;
  if (requirement === undefined || requirement === null) return { required: false, id: null, errors: [] };
  const errors = [];
  if (typeof requirement !== 'object' || Array.isArray(requirement)) {
    return { required: true, id: null, errors: ['authority_requirement must be an object'] };
  }
  for (const key of Object.keys(requirement)) {
    if (key !== 'id') {
      errors.push(`authority_requirement.${key} is candidate-controlled and forbidden; only id is permitted`);
    }
  }
  const id = requirement.id;
  if (typeof id !== 'string' || !AUTHORITY_ID_PATTERN.test(id)) {
    errors.push('authority_requirement.id must match ^[A-Z0-9][A-Z0-9-]{2,63}$');
  }
  return { required: true, id: errors.length === 0 ? id : null, errors };
}

// ---------------------------------------------------------------------------
// Protected catalog
// ---------------------------------------------------------------------------

function validateCatalogEntry(id, entry, errors) {
  const where = `authorities.${id}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${where} must be an object`);
    return;
  }
  const allowed = new Set([
    'provider',
    'source',
    'archive',
    'content',
    'reference',
    'capability_env',
    'required_entries',
    'description',
  ]);
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) errors.push(`${where}.${key} is not a recognised catalog field`);
  }
  if (!PROVIDERS.has(entry.provider)) errors.push(`${where}.provider is unsupported: ${entry.provider}`);
  if (entry.provider === 'github-release-asset') {
    const source = entry.source;
    if (!source || typeof source !== 'object') {
      errors.push(`${where}.source is required`);
    } else {
      for (const key of Object.keys(source)) {
        if (!['repository', 'release_tag', 'asset_name'].includes(key)) {
          errors.push(`${where}.source.${key} is not a recognised source field`);
        }
      }
      if (!REPOSITORY_PATTERN.test(source.repository || '')) errors.push(`${where}.source.repository is invalid`);
      if (!RELEASE_TAG_PATTERN.test(source.release_tag || '')) errors.push(`${where}.source.release_tag is invalid`);
      if (!ASSET_NAME_PATTERN.test(source.asset_name || '')) errors.push(`${where}.source.asset_name is invalid`);
    }
  }
  const archive = entry.archive;
  if (!archive || typeof archive !== 'object') {
    errors.push(`${where}.archive is required`);
  } else {
    if (archive.format !== 'tar.gz') errors.push(`${where}.archive.format must be tar.gz`);
    if (!HEX_256_PATTERN.test(archive.sha256 || '')) errors.push(`${where}.archive.sha256 must be a sha256 hex digest`);
  }
  const content = entry.content;
  if (!content || typeof content !== 'object') {
    errors.push(`${where}.content is required`);
  } else {
    if (content.digest_algorithm !== AUTHORITY_CONTENT_DIGEST_ALGORITHM) {
      errors.push(`${where}.content.digest_algorithm must be ${AUTHORITY_CONTENT_DIGEST_ALGORITHM}`);
    }
    if (!HEX_256_PATTERN.test(content.digest || '')) errors.push(`${where}.content.digest must be a sha256 hex digest`);
  }
  if (entry.reference !== undefined) {
    const reference = entry.reference;
    if (!reference || typeof reference !== 'object') {
      errors.push(`${where}.reference must be an object`);
    } else {
      if (reference.digest_algorithm !== 'sha256') errors.push(`${where}.reference.digest_algorithm must be sha256`);
      if (!HEX_256_PATTERN.test(reference.digest || '')) {
        errors.push(`${where}.reference.digest must be a sha256 hex digest`);
      }
      if (typeof reference.entry !== 'string' || reference.entry.length === 0) {
        errors.push(`${where}.reference.entry is required`);
      }
    }
  }
  const capabilityEnv = entry.capability_env;
  if (!capabilityEnv || typeof capabilityEnv !== 'object') {
    errors.push(`${where}.capability_env is required`);
  } else {
    for (const key of Object.keys(capabilityEnv)) {
      if (!['root', 'reference'].includes(key)) {
        errors.push(`${where}.capability_env.${key} is not a recognised capability`);
      }
    }
    if (!ENV_NAME_PATTERN.test(capabilityEnv.root || '')) {
      errors.push(`${where}.capability_env.root must be a valid environment variable name`);
    }
    if (capabilityEnv.reference !== undefined && !ENV_NAME_PATTERN.test(capabilityEnv.reference)) {
      errors.push(`${where}.capability_env.reference must be a valid environment variable name`);
    }
    if (capabilityEnv.reference !== undefined && entry.reference === undefined) {
      errors.push(`${where}.capability_env.reference requires ${where}.reference`);
    }
    if (capabilityEnv.reference !== undefined && capabilityEnv.reference === capabilityEnv.root) {
      errors.push(`${where}.capability_env.root and reference must differ`);
    }
    for (const name of Object.values(capabilityEnv)) {
      if (typeof name === 'string' && isReservedEnvName(name)) {
        errors.push(`${where}.capability_env binds reserved environment name ${name}`);
      }
    }
  }
  if (entry.required_entries !== undefined) {
    if (!Array.isArray(entry.required_entries)) {
      errors.push(`${where}.required_entries must be an array`);
    } else {
      for (const value of entry.required_entries) {
        if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('..')) {
          errors.push(`${where}.required_entries contains an unsafe path`);
        }
      }
    }
  }
}

export function validateAuthorityCatalog(catalog) {
  const errors = [];
  if (catalog?.schema_version !== AUTHORITY_CATALOG_SCHEMA) {
    errors.push(`schema_version must be ${AUTHORITY_CATALOG_SCHEMA}`);
  }
  for (const key of Object.keys(catalog || {})) {
    if (!['schema_version', 'authorities'].includes(key)) {
      errors.push(`${key} is not a recognised catalog field`);
    }
  }
  const authorities = catalog?.authorities;
  if (!authorities || typeof authorities !== 'object' || Array.isArray(authorities)) {
    errors.push('authorities must be an object');
    return errors;
  }
  for (const [id, entry] of Object.entries(authorities)) {
    if (!AUTHORITY_ID_PATTERN.test(id)) errors.push(`authority id is invalid: ${id}`);
    validateCatalogEntry(id, entry, errors);
  }
  return errors;
}

// Loads the catalog that ships with the protected controller commit. The path is
// derived from this module's location only. `candidateRoot`, when supplied, is a
// belt-and-braces assertion that the controller checkout is not the candidate
// checkout -- the workflow already checks them out separately.
export function loadProtectedAuthorityCatalog(options = {}) {
  const path = options.catalogPath || protectedCatalogPath();
  if (options.candidateRoot && containedIn(options.candidateRoot, path)) {
    return {
      ok: false,
      reason_code: AUTHORITY_DENIAL.CATALOG_NOT_PROTECTED,
      errors: ['authority catalog resolved inside the candidate checkout'],
      catalog: null,
      path,
    };
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      ok: false,
      reason_code: AUTHORITY_DENIAL.CATALOG_UNAVAILABLE,
      errors: [error instanceof Error ? error.message : String(error)],
      catalog: null,
      path,
    };
  }
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reason_code: AUTHORITY_DENIAL.CATALOG_INVALID,
      errors: [error instanceof Error ? error.message : String(error)],
      catalog: null,
      path,
    };
  }
  const errors = validateAuthorityCatalog(catalog);
  if (errors.length > 0) {
    return { ok: false, reason_code: AUTHORITY_DENIAL.CATALOG_INVALID, errors, catalog: null, path };
  }
  return { ok: true, reason_code: null, errors: [], catalog, path };
}

// Every environment name any catalog entry may bind. The controller scrubs all
// of them from the proof environment before adding back only the ones the
// resolved authority actually granted, so an ambient or inherited value can
// never stand in for verified authority.
export function catalogCapabilityEnvNames(catalog) {
  const names = new Set();
  for (const entry of Object.values(catalog?.authorities || {})) {
    for (const name of Object.values(entry?.capability_env || {})) {
      if (typeof name === 'string') names.add(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function retrieveGithubReleaseAsset(entry, context) {
  const { repository, release_tag: releaseTag, asset_name: assetName } = entry.source;
  const token = context.token;
  if (!token) throw new Error(`${AUTHORITY_RETRIEVAL_TOKEN_ENV} is required to retrieve a release asset`);
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation is available');
  const apiBase = context.apiBase || 'https://api.github.com';
  const headers = {
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'devgov-authority-transport-v1',
  };
  const releaseUrl = `${apiBase}/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`;
  const releaseResponse = await fetchImpl(releaseUrl, {
    headers: { ...headers, accept: 'application/vnd.github+json' },
  });
  if (!releaseResponse.ok) throw new Error(`release lookup failed with HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json();
  const asset = (release?.assets || []).find((candidate) => candidate?.name === assetName);
  if (!asset) throw new Error(`release ${releaseTag} has no asset named ${assetName}`);
  const assetResponse = await fetchImpl(asset.url, {
    headers: { ...headers, accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!assetResponse.ok) throw new Error(`asset download failed with HTTP ${assetResponse.status}`);
  const bytes = Buffer.from(await assetResponse.arrayBuffer());
  return { bytes, source_identity: `github-release-asset:${repository}@${releaseTag}/${assetName}` };
}

const PROVIDERS = new Map([['github-release-asset', { retrieve: retrieveGithubReleaseAsset }]]);

export function authorityProviderNames() {
  return [...PROVIDERS.keys()];
}

// ---------------------------------------------------------------------------
// Archive expansion
// ---------------------------------------------------------------------------

function defaultRunner(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

// tar is always invoked with a working directory and relative operands. GNU tar
// reads an absolute Windows path such as C:\... as a remote host specification,
// so absolute operands would make this module work on Linux and fail on
// Windows -- and the negative-test battery has to run on both.
function listArchiveEntries(archivePath, runner, cwd) {
  const listed = runner('tar', ['-tzf', archivePath], { cwd });
  if (listed.status !== 0) {
    throw new Error(`archive listing failed: ${(listed.stderr || '').trim() || `exit ${listed.status}`}`);
  }
  return (listed.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertSafeArchiveEntries(entries) {
  if (entries.length === 0) throw new Error('archive contains no entries');
  for (const entry of entries) {
    const normalized = entry.split('\\').join('/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      throw new Error(`archive entry is absolute: ${entry}`);
    }
    if (normalized.split('/').some((segment) => segment === '..')) {
      throw new Error(`archive entry escapes the materialization root: ${entry}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Read-only enforcement
// ---------------------------------------------------------------------------

function walkPaths(root) {
  const files = [];
  const directories = [];
  const walk = (directory) => {
    directories.push(directory);
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const stats = lstatSync(absolute);
      if (stats.isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  };
  walk(resolve(root));
  return { files, directories };
}

function applyReadOnly(root, options) {
  const { files, directories } = walkPaths(root);
  if (options.enforceOwner) {
    for (const target of [...files, ...directories]) chownSync(target, 0, 0);
  }
  for (const file of files) chmodSync(file, 0o444);
  for (const directory of [...directories].reverse()) chmodSync(directory, 0o555);
  return { files, directories };
}

// ---------------------------------------------------------------------------
// Writability probe, bound to the proof identity
// ---------------------------------------------------------------------------
//
// The property proven here is "can the identity that will execute the candidate
// proof mutate the verified authority?" -- never "can the controller?". On the
// trusted runner the controller is root and can always write through mode bits;
// that is expected and says nothing about the proof identity.
//
// Contract, fail closed:
//   * The probe is a controller-authored program launched as the proof uid/gid
//     through the same spawn mechanism as the proof itself, from an absolute
//     executable path, with an EMPTY environment: no retrieval token or other
//     credential ever reaches a process running under the candidate identity.
//   * It attempts every operation in WRITE_PROBE_OPERATIONS and prints exactly
//     one JSON report. NOT_WRITABLE is concluded only from a complete,
//     well-formed report of this very invocation (nonce, root), produced by the
//     expected uid/gid, in which reading succeeded and every mutation was
//     refused with an errno that means enforcement.
//   * Launch failure, non-zero exit, signal, timeout, missing or malformed
//     output, a missing, repeated or unknown check, an unexpected errno or any
//     allowed mutation is a denial. An absent answer is never "safe".

export const WRITE_PROBE_SCHEMA = 'dev-gov-authority-write-probe-v1';
export const WRITE_PROBE_OPERATIONS = Object.freeze([
  'read',
  'overwrite',
  'append',
  'truncate',
  'create',
  'mkdir',
  'symlink',
  'chmod',
  'rename',
  'delete',
]);
// A mutation counts as refused only with an errno that means enforcement:
//   EACCES -- discretionary access control refused it (mode bits, not the owner)
//   EPERM  -- it needs ownership or a capability the identity lacks (chmod by a
//             non-owner, sticky directories, immutable files)
//   EROFS  -- the file system itself is read-only
// Anything else (ENOENT, EIO, ...) means enforcement was not observed.
export const WRITE_PROBE_DENIAL_ERRNOS = Object.freeze(['EACCES', 'EPERM', 'EROFS']);
const WRITE_PROBE_TIMEOUT_MS = 60_000;
const WRITE_PROBE_MAX_BUFFER = 1024 * 1024;
// libuv re-inserts these into every Windows child even when it is given an
// empty environment; they carry no DEV-GOV state. POSIX children get nothing.
const WINDOWS_RUNTIME_ENV_NAMES = Object.freeze([
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]);

// The complete environment handed to the probe. Nothing is inherited or cloned.
export function writeProbeEnvironment() {
  return {};
}

export function writeProbeEnvironmentAllowlist(platform = process.platform) {
  return platform === 'win32' ? [...WINDOWS_RUNTIME_ENV_NAMES] : [];
}

// Runs INSIDE the proof identity via `node -e` (CommonJS). It is kept as source
// text, not a serialized function, so no module transform or coverage
// instrumentation can rewrite what the child executes. Any exception exits
// non-zero, which the controller treats as a failed probe. The program uses no
// template literals: it is embedded in one.
const WRITE_PROBE_PROGRAM = String.raw`
  const fs = require('node:fs');
  const path = require('node:path');
  const { constants } = fs;
  const root = process.argv[1];
  const nonce = process.argv[2];

  let envSource = 'process-env';
  let envNames = Object.keys(process.env);
  try {
    // The exact bytes any other process running as this uid could read.
    envNames = fs
      .readFileSync('/proc/self/environ', 'utf8')
      .split('\0')
      .filter(Boolean)
      .map((entry) => entry.split('=')[0]);
    envSource = 'proc-self-environ';
  } catch {
    // no procfs (e.g. Windows): the process view is the only one available
  }

  const files = [];
  const directories = [];
  const modes = new Map();
  const sizes = new Map();
  let walkError = null;
  const walk = (directory) => {
    directories.push(directory);
    modes.set(directory, fs.lstatSync(directory).mode & 0o7777);
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stats = fs.lstatSync(absolute);
      if (stats.isDirectory()) {
        walk(absolute);
      } else if (stats.isFile()) {
        files.push(absolute);
        modes.set(absolute, stats.mode & 0o7777);
        sizes.set(absolute, stats.size);
      }
    }
  };
  try {
    walk(root);
  } catch (error) {
    walkError = (error && error.code) || 'UNKNOWN';
  }
  // The directory holding the root binds the capability path: whoever can write
  // there can swap the verified tree for another one under the same name.
  const parent = path.dirname(root);
  try {
    modes.set(parent, fs.lstatSync(parent).mode & 0o7777);
  } catch {
    // parent stays out of the chmod targets; create/mkdir/symlink still try it
  }

  const relative = (target) => path.relative(root, target).split(path.sep).join('/') || '.';
  const errnoOf = (error) => (error && error.code ? String(error.code) : 'UNKNOWN');
  const checks = [];

  // read: the walk must succeed and every file must yield its first byte.
  const readErrnos = new Set();
  let readTarget = null;
  if (walkError) {
    readErrnos.add(walkError);
    readTarget = '.';
  }
  for (const file of files) {
    let handle;
    try {
      handle = fs.openSync(file, 'r');
      fs.readSync(handle, Buffer.alloc(1), 0, 1, 0);
    } catch (error) {
      readErrnos.add(errnoOf(error));
      readTarget = readTarget || relative(file);
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
  }
  const readRefused = [...readErrnos].every((errno) => errno === 'EACCES' || errno === 'EPERM');
  checks.push({
    operation: 'read',
    attempted: true,
    targets: files.length,
    result: readErrnos.size === 0 ? 'ALLOWED' : readRefused ? 'DENIED' : 'ERROR',
    errnos: [...readErrnos].sort(),
    target: readTarget,
  });

  // A mutation attempt returns an optional undo; the undo never decides the result.
  const mutation = (operation, targets, attempt) => {
    const errnos = new Set();
    let allowed = null;
    for (const target of targets) {
      let undo;
      try {
        undo = attempt(target);
      } catch (error) {
        errnos.add(errnoOf(error));
        continue;
      }
      allowed = allowed || relative(target);
      if (typeof undo === 'function') {
        try {
          undo();
        } catch {
          // the tree digest is re-verified by the controller after the probe
        }
      }
    }
    const unexpected = [...errnos].some((errno) => !denialErrnos.includes(errno));
    checks.push({
      operation,
      attempted: true,
      targets: targets.length,
      result: allowed ? 'ALLOWED' : unexpected ? 'ERROR' : 'DENIED',
      errnos: [...errnos].sort(),
      target: allowed,
    });
  };
  const containers = [...directories, parent];
  const probeName = (directory, kind) => path.join(directory, '.devgov-write-probe-' + kind + '-' + nonce);

  // Non-destructive first: nothing changes when the tree is protected, and
  // anything that does succeed is undone at once.
  mutation('overwrite', files, (file) => {
    const handle = fs.openSync(file, constants.O_WRONLY);
    return () => fs.closeSync(handle);
  });
  mutation('append', files, (file) => {
    const handle = fs.openSync(file, constants.O_WRONLY | constants.O_APPEND);
    return () => fs.closeSync(handle);
  });
  mutation('truncate', files, (file) => fs.truncateSync(file, sizes.get(file)));
  mutation('create', containers, (directory) => {
    const created = probeName(directory, 'file');
    fs.closeSync(fs.openSync(created, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600));
    return () => fs.unlinkSync(created);
  });
  mutation('mkdir', containers, (directory) => {
    const created = probeName(directory, 'dir');
    fs.mkdirSync(created);
    return () => fs.rmdirSync(created);
  });
  mutation('symlink', containers, (directory) => {
    const created = probeName(directory, 'link');
    fs.symlinkSync('.', created);
    return () => fs.unlinkSync(created);
  });
  mutation(
    'chmod',
    [...files, ...containers].filter((target) => modes.has(target)),
    (target) => fs.chmodSync(target, modes.get(target)),
  );
  // Restorable, then destructive; representative targets only.
  const first = files[0];
  mutation('rename', [first, root].filter(Boolean), (target) => {
    const moved = target + '.devgov-write-probe-' + nonce;
    fs.renameSync(target, moved);
    return () => fs.renameSync(moved, target);
  });
  mutation('delete', [first].filter(Boolean), (file) => fs.unlinkSync(file));

  process.stdout.write(
    JSON.stringify({
      schema_version: schema,
      nonce,
      root,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      gid: typeof process.getgid === 'function' ? process.getgid() : null,
      groups: typeof process.getgroups === 'function' ? process.getgroups() : null,
      env_source: envSource,
      env_names: [...new Set(envNames)].sort(),
      files: files.length,
      directories: directories.length,
      checks,
    }),
  );
`;

const WRITE_PROBE_SOURCE = [
  "'use strict';",
  `const schema = ${JSON.stringify(WRITE_PROBE_SCHEMA)};`,
  `const denialErrnos = ${JSON.stringify(WRITE_PROBE_DENIAL_ERRNOS)};`,
  WRITE_PROBE_PROGRAM,
].join('\n');

function isProofIdentityValue(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function writeProbeIdentity(options) {
  const uidSupplied = options.uid !== undefined && options.uid !== null;
  const gidSupplied = options.gid !== undefined && options.gid !== null;
  if (uidSupplied || gidSupplied) {
    if (!isProofIdentityValue(options.uid) || !isProofIdentityValue(options.gid)) {
      return {
        ok: false,
        detail: `a proof identity must be an integer uid/gid pair >= 1, got uid=${options.uid} gid=${options.gid}`,
      };
    }
    return { ok: true, mode: 'proof-identity', uid: options.uid, gid: options.gid };
  }
  // Without a proof identity the probe describes the CURRENT identity only. The
  // resolver never relies on this: it requires an explicit proof identity.
  return {
    ok: true,
    mode: 'current-identity',
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    gid: typeof process.getgid === 'function' ? process.getgid() : null,
  };
}

// Strict: anything that is not a complete positive attestation is a denial.
export function validateWriteProbeReport(report, expected) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { verdict: 'PROBE_FAILED', errors: ['probe report must be a JSON object'] };
  }
  const errors = [];
  if (report.schema_version !== WRITE_PROBE_SCHEMA) {
    errors.push(`probe report schema_version must be ${WRITE_PROBE_SCHEMA}`);
  }
  if (report.nonce !== expected.nonce) errors.push('probe report does not belong to this invocation (nonce)');
  if (report.root !== expected.root) errors.push('probe report does not describe this materialization root');
  if (report.uid !== expected.uid || report.gid !== expected.gid) {
    errors.push(
      `probe ran as uid=${report.uid} gid=${report.gid}, expected uid=${expected.uid} gid=${expected.gid}`,
    );
  }
  const windows = expected.platform === 'win32';
  const normalize = (name) => (windows ? String(name).toUpperCase() : String(name));
  const allowlist = new Set(writeProbeEnvironmentAllowlist(expected.platform).map(normalize));
  if (!Array.isArray(report.env_names) || !report.env_names.every((name) => typeof name === 'string')) {
    errors.push('probe report env_names must be an array of names');
  } else {
    const carried = report.env_names.filter((name) => !allowlist.has(normalize(name)));
    if (carried.length > 0) {
      errors.push(`probe environment carried non-allowlisted variables: ${[...carried].sort().join(', ')}`);
    }
  }
  const checks = new Map();
  if (!Array.isArray(report.checks)) {
    errors.push('probe report checks must be an array');
  } else {
    for (const check of report.checks) {
      const operation = check?.operation;
      if (!WRITE_PROBE_OPERATIONS.includes(operation)) {
        errors.push(`probe report contains an unknown check: ${operation}`);
        continue;
      }
      if (checks.has(operation)) {
        errors.push(`probe report repeats the ${operation} check`);
        continue;
      }
      checks.set(operation, check);
      if (check.attempted !== true) errors.push(`${operation} check was not attempted`);
      if (!Number.isSafeInteger(check.targets) || check.targets < 0) {
        errors.push(`${operation} check has no valid target count`);
      }
      if (!['ALLOWED', 'DENIED', 'ERROR'].includes(check.result)) {
        errors.push(`${operation} check has an invalid result`);
      }
      if (!Array.isArray(check.errnos) || !check.errnos.every((errno) => typeof errno === 'string')) {
        errors.push(`${operation} check has invalid errnos`);
      }
    }
    for (const operation of WRITE_PROBE_OPERATIONS) {
      if (!checks.has(operation)) errors.push(`probe report is missing the ${operation} check`);
    }
  }
  if (errors.length > 0) return { verdict: 'PROBE_FAILED', errors };

  const mutations = WRITE_PROBE_OPERATIONS.filter((operation) => operation !== 'read');
  const allowed = mutations.filter((operation) => checks.get(operation).result === 'ALLOWED');
  if (allowed.length > 0) {
    return {
      verdict: 'WRITABLE',
      errors: allowed.map(
        (operation) =>
          `proof identity was allowed to ${operation}: ${checks.get(operation).target ?? '<unknown>'}`,
      ),
    };
  }
  const read = checks.get('read');
  if (read.result !== 'ALLOWED' || read.targets < 1) {
    return read.result === 'DENIED'
      ? {
          verdict: 'UNREADABLE',
          errors: [
            `proof identity cannot read the authority: ${read.target ?? '.'} (${read.errnos.join(', ')})`,
          ],
        }
      : {
          verdict: 'PROBE_FAILED',
          errors: [`read check did not complete: ${read.errnos.join(', ') || read.result}`],
        };
  }
  for (const operation of mutations) {
    const check = checks.get(operation);
    const unexpected = check.errnos.filter((errno) => !WRITE_PROBE_DENIAL_ERRNOS.includes(errno));
    if (check.targets < 1) errors.push(`${operation} check had nothing to attempt`);
    else if (check.result !== 'DENIED')
      errors.push(`${operation} check did not observe enforcement: ${check.result}`);
    if (unexpected.length > 0) {
      errors.push(
        `${operation} check failed with errno(s) that do not prove enforcement: ${unexpected.join(', ')}`,
      );
    } else if (check.errnos.length === 0) {
      errors.push(`${operation} check reports a denial without an errno`);
    }
  }
  if (errors.length > 0) return { verdict: 'PROBE_FAILED', errors };
  return { verdict: 'NOT_WRITABLE', errors: [] };
}

const WRITE_PROBE_VERDICT_REASONS = Object.freeze({
  NOT_WRITABLE: null,
  WRITABLE: AUTHORITY_DENIAL.MATERIALIZATION_WRITABLE,
  UNREADABLE: AUTHORITY_DENIAL.MATERIALIZATION_UNREADABLE,
  PROBE_FAILED: AUTHORITY_DENIAL.WRITABILITY_PROBE_FAILED,
  IDENTITY_INVALID: AUTHORITY_DENIAL.PROOF_IDENTITY_REQUIRED,
});

function writeProbeOutcome(verdict, identity, errors, report = null) {
  const probes = [
    `${WRITE_PROBE_SCHEMA} ${identity ? `${identity.mode} uid=${identity.uid} gid=${identity.gid}` : 'no-identity'}`,
  ];
  for (const check of Array.isArray(report?.checks) ? report.checks : []) {
    const errnos =
      Array.isArray(check?.errnos) && check.errnos.length > 0 ? `:${check.errnos.join('|')}` : '';
    probes.push(`${check?.operation}=${check?.result}${errnos}`);
  }
  return {
    writable: verdict !== 'NOT_WRITABLE',
    verdict,
    reason_code: WRITE_PROBE_VERDICT_REASONS[verdict],
    detail: errors.length > 0 ? errors.join('; ') : null,
    errors,
    probes,
    report,
  };
}

// Real attempts, not an inspection of mode bits, performed by the identity the
// verdict is about. `writable: false` is returned for exactly one outcome: a
// complete positive attestation (verdict NOT_WRITABLE).
export function probeMaterializationWritable(root, options = {}) {
  const identity = writeProbeIdentity(options);
  if (!identity.ok) return writeProbeOutcome('IDENTITY_INVALID', null, [identity.detail]);
  const materializationRoot = resolve(root);
  const nonce = randomBytes(16).toString('hex');
  const launch = options.runner || defaultRunner;
  const spawnOptions = {
    cwd: parse(materializationRoot).root,
    env: writeProbeEnvironment(),
    encoding: 'utf8',
    maxBuffer: WRITE_PROBE_MAX_BUFFER,
    timeout: WRITE_PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...(identity.mode === 'proof-identity' ? { uid: identity.uid, gid: identity.gid } : {}),
  };
  let child;
  try {
    child = launch(process.execPath, ['-e', WRITE_PROBE_SOURCE, materializationRoot, nonce], spawnOptions);
  } catch (error) {
    return writeProbeOutcome('PROBE_FAILED', identity, [
      `writability probe could not be launched: ${error?.code || error?.message || String(error)}`,
    ]);
  }
  if (!child || typeof child !== 'object') {
    return writeProbeOutcome('PROBE_FAILED', identity, ['writability probe launcher returned no result']);
  }
  if (child.error) {
    return writeProbeOutcome('PROBE_FAILED', identity, [
      `writability probe did not complete: ${child.error.code || child.error.message}`,
    ]);
  }
  if (child.signal) {
    return writeProbeOutcome('PROBE_FAILED', identity, [
      `writability probe was terminated by ${child.signal}`,
    ]);
  }
  if (child.status !== 0) {
    return writeProbeOutcome('PROBE_FAILED', identity, [
      `writability probe exited with status ${child.status}`,
    ]);
  }
  const stdout =
    typeof child.stdout === 'string'
      ? child.stdout
      : Buffer.isBuffer(child.stdout)
        ? child.stdout.toString('utf8')
        : '';
  if (stdout.trim() === '') {
    return writeProbeOutcome('PROBE_FAILED', identity, ['writability probe produced no report']);
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return writeProbeOutcome('PROBE_FAILED', identity, ['writability probe report is not valid JSON']);
  }
  const validation = validateWriteProbeReport(report, {
    nonce,
    root: materializationRoot,
    uid: identity.uid,
    gid: identity.gid,
    platform: process.platform,
  });
  return writeProbeOutcome(validation.verdict, identity, validation.errors, report);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function denial(authorityId, reasonCode, errors) {
  return {
    status: AUTHORITY_STATUS.DENIED,
    authority_id: authorityId || '',
    content_digest: '',
    reference_digest: '',
    materialization_result: AUTHORITY_STATUS.DENIED,
    materialization_root: '',
    source_identity: '',
    capability_env: {},
    probes: [],
    reason_code: reasonCode,
    errors: Array.isArray(errors) ? errors : [String(errors)],
  };
}

export function notRequiredResolution() {
  return {
    status: AUTHORITY_STATUS.NOT_REQUIRED,
    authority_id: '',
    content_digest: '',
    reference_digest: '',
    materialization_result: AUTHORITY_STATUS.NOT_REQUIRED,
    materialization_root: '',
    source_identity: '',
    capability_env: {},
    probes: [],
    reason_code: null,
    errors: [],
  };
}

// Planning-only resolution: what identity SHOULD this authority id have,
// according to protected configuration. No retrieval, no filesystem effect.
// Used by the attestation signer and by the gate to reject substitution without
// re-downloading anything.
export function planAuthority(authorityId, catalog) {
  const entry = catalog?.authorities?.[authorityId];
  if (!entry) {
    return {
      ok: false,
      reason_code: AUTHORITY_DENIAL.ID_UNKNOWN,
      errors: [`authority id is not present in the protected catalog: ${authorityId}`],
      expected: null,
    };
  }
  return {
    ok: true,
    reason_code: null,
    errors: [],
    expected: {
      authority_id: authorityId,
      content_digest: entry.content.digest,
      reference_digest: entry.reference?.digest || '',
      materialization_result: AUTHORITY_STATUS.VERIFIED_READ_ONLY,
    },
  };
}

export async function resolveAuthorityCapability(options = {}) {
  const { authorityId, catalog } = options;
  if (!authorityId || !AUTHORITY_ID_PATTERN.test(authorityId)) {
    return denial(authorityId, AUTHORITY_DENIAL.REQUIREMENT_INVALID, ['authority id is malformed']);
  }
  const entry = catalog?.authorities?.[authorityId];
  if (!entry) {
    return denial(authorityId, AUTHORITY_DENIAL.ID_UNKNOWN, [
      `authority id is not present in the protected catalog: ${authorityId}`,
    ]);
  }
  const provider = PROVIDERS.get(entry.provider);
  if (!provider) {
    return denial(authorityId, AUTHORITY_DENIAL.PROVIDER_UNSUPPORTED, [
      `unsupported authority provider: ${entry.provider}`,
    ]);
  }
  const materializationBase = options.materializationRoot;
  if (!materializationBase) {
    return denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_FAILED, [
      'a protected materialization root is required',
    ]);
  }
  if (options.candidateRoot && containedIn(options.candidateRoot, materializationBase)) {
    return denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_UNSAFE, [
      'authority materialization root is inside the candidate checkout',
    ]);
  }

  let retrieved;
  try {
    const retrieve = options.retrieve || provider.retrieve;
    retrieved = await retrieve(entry, {
      token: options.token,
      fetchImpl: options.fetchImpl,
      apiBase: options.apiBase,
    });
  } catch (error) {
    return denial(authorityId, AUTHORITY_DENIAL.RETRIEVAL_UNAVAILABLE, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const bytes = retrieved?.bytes;
  if (!bytes || bytes.length === 0) {
    return denial(authorityId, AUTHORITY_DENIAL.RETRIEVAL_UNAVAILABLE, ['authority retrieval returned no bytes']);
  }
  const archiveDigest = sha256(bytes);
  if (archiveDigest !== entry.archive.sha256) {
    return denial(authorityId, AUTHORITY_DENIAL.ARCHIVE_DIGEST_MISMATCH, [
      `archive digest mismatch: expected ${entry.archive.sha256}, got ${archiveDigest}`,
    ]);
  }

  const root = join(resolve(materializationBase), authorityId);
  if (existsSync(root)) {
    return denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_UNSAFE, [
      `authority materialization path already exists: ${root}`,
    ]);
  }
  const base = resolve(materializationBase);
  const archiveName = `${authorityId}.tar.gz`;
  const archivePath = join(base, archiveName);
  const runner = options.runner || defaultRunner;
  try {
    mkdirSync(base, { recursive: true });
    writeFileSync(archivePath, bytes, { flag: 'wx' });
    assertSafeArchiveEntries(listArchiveEntries(archiveName, runner, base));
    mkdirSync(root, { recursive: false });
    // --no-same-owner is honoured by both GNU tar and bsdtar. Archived modes are
    // deliberately not preserved via a flag: applyReadOnly below sets every mode
    // explicitly, so a hostile archive cannot ship a writable bit.
    const extracted = runner('tar', ['-xzf', archiveName, '-C', authorityId, '--no-same-owner'], {
      cwd: base,
    });
    if (extracted.status !== 0) {
      throw new Error(`archive extraction failed: ${(extracted.stderr || '').trim() || `exit ${extracted.status}`}`);
    }
  } catch (error) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
    return denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_FAILED, [
      error instanceof Error ? error.message : String(error),
    ]);
  } finally {
    try {
      rmSync(archivePath, { force: true });
    } catch {
      // best effort
    }
  }

  for (const required of entry.required_entries || []) {
    if (!existsSync(join(root, ...required.split('/')))) {
      return denial(authorityId, AUTHORITY_DENIAL.REQUIRED_ENTRY_MISSING, [
        `authority materialization is missing required entry: ${required}`,
      ]);
    }
  }

  let contentDigest;
  try {
    contentDigest = authorityTreeDigest(root);
  } catch (error) {
    return denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_UNSAFE, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  if (contentDigest !== entry.content.digest) {
    return denial(authorityId, AUTHORITY_DENIAL.CONTENT_DIGEST_MISMATCH, [
      `authority content digest mismatch: expected ${entry.content.digest}, got ${contentDigest}`,
    ]);
  }

  let referenceDigest = '';
  let referencePath = '';
  if (entry.reference) {
    referencePath = join(root, ...entry.reference.entry.split('/'));
    if (!existsSync(referencePath)) {
      return denial(authorityId, AUTHORITY_DENIAL.REFERENCE_DIGEST_MISMATCH, [
        `authority reference entry is absent: ${entry.reference.entry}`,
      ]);
    }
    referenceDigest = sha256(readFileSync(referencePath));
    if (referenceDigest !== entry.reference.digest) {
      return denial(authorityId, AUTHORITY_DENIAL.REFERENCE_DIGEST_MISMATCH, [
        `authority reference digest mismatch: expected ${entry.reference.digest}, got ${referenceDigest}`,
      ]);
    }
  }

  try {
    applyReadOnly(root, { enforceOwner: Boolean(options.enforceOwner) });
  } catch (error) {
    return denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_FAILED, [
      `read-only materialization could not be applied: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  // The read-only verdict is about the identity that will execute the proof, so
  // that identity must be explicit. There is no fallback to the controller's own
  // identity: on the trusted runner that is root, which can write regardless.
  if (!isProofIdentityValue(options.proofUid) || !isProofIdentityValue(options.proofGid)) {
    return denial(authorityId, AUTHORITY_DENIAL.PROOF_IDENTITY_REQUIRED, [
      `an authority-bound proof requires an explicit unprivileged proof uid/gid (>= 1); got uid=${options.proofUid} gid=${options.proofGid}`,
    ]);
  }
  const probe = (options.probeWritable || probeMaterializationWritable)(root, {
    uid: options.proofUid,
    gid: options.proofGid,
    runner: options.probeRunner,
  });
  if (!probe || probe.writable !== false) {
    return {
      ...denial(authorityId, probe?.reason_code || AUTHORITY_DENIAL.MATERIALIZATION_WRITABLE, [
        probe?.detail || 'authority materialization is not proven read-only for the proof identity',
      ]),
      probes: probe?.probes || [],
    };
  }
  // The probe ran as another identity: re-verify that nothing changed underneath
  // the verdict before any proof is allowed to see the tree.
  let postProbeDigest;
  try {
    postProbeDigest = authorityTreeDigest(root);
  } catch (error) {
    return {
      ...denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_UNSAFE, [
        `authority materialization changed during the writability probe: ${error instanceof Error ? error.message : String(error)}`,
      ]),
      probes: probe.probes || [],
    };
  }
  if (postProbeDigest !== contentDigest) {
    return {
      ...denial(authorityId, AUTHORITY_DENIAL.CONTENT_DIGEST_MISMATCH, [
        `authority content changed during the writability probe: expected ${contentDigest}, got ${postProbeDigest}`,
      ]),
      probes: probe.probes || [],
    };
  }

  const capabilityEnv = { [entry.capability_env.root]: root };
  if (entry.capability_env.reference) capabilityEnv[entry.capability_env.reference] = referencePath;

  return {
    status: AUTHORITY_STATUS.VERIFIED_READ_ONLY,
    authority_id: authorityId,
    content_digest: contentDigest,
    reference_digest: referenceDigest,
    materialization_result: AUTHORITY_STATUS.VERIFIED_READ_ONLY,
    materialization_root: root,
    source_identity: retrieved.source_identity || entry.provider,
    capability_env: capabilityEnv,
    probes: probe.probes || [],
    reason_code: null,
    errors: [],
  };
}
