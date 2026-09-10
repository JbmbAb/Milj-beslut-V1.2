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
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

// A real attempt to write, not an inspection of mode bits. Two probes:
//   file-write      -- open every materialized file for update; all must fail.
//   identity-create -- when a proof uid/gid is supplied, a child process running
//                      as that exact identity must fail to create a file in the
//                      materialization root.
// The probes that actually ran are reported so a caller can never mistake a
// skipped probe for a passed one.
export function probeMaterializationWritable(root, options = {}) {
  const probes = [];
  const { files } = walkPaths(root);
  let writable = null;
  for (const file of files) {
    try {
      const handle = openSync(file, 'r+');
      closeSync(handle);
      writable = `file is writable: ${posixRelative(resolve(root), file)}`;
      break;
    } catch {
      // expected: the materialization is read-only
    }
  }
  probes.push('file-write');
  if (writable) return { writable: true, detail: writable, probes };

  if (Number.isInteger(options.uid) && Number.isInteger(options.gid)) {
    const probePath = join(resolve(root), '.devgov-authority-write-probe');
    const runner = options.runner || defaultRunner;
    const result = runner(
      process.execPath,
      ['-e', 'require("node:fs").writeFileSync(process.argv[1], "x");', probePath],
      { uid: options.uid, gid: options.gid },
    );
    probes.push('identity-create');
    let created = false;
    try {
      if (existsSync(probePath)) {
        created = true;
        unlinkSync(probePath);
      }
    } catch {
      created = true;
    }
    if (result.status === 0 || created) {
      return {
        writable: true,
        detail: 'proof identity was able to create a file in the authority materialization',
        probes,
      };
    }
  }
  return { writable: false, detail: null, probes };
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
  const probe = (options.probeWritable || probeMaterializationWritable)(root, {
    uid: options.proofUid,
    gid: options.proofGid,
    runner: options.probeRunner,
  });
  if (probe.writable) {
    return {
      ...denial(authorityId, AUTHORITY_DENIAL.MATERIALIZATION_WRITABLE, [
        probe.detail || 'authority materialization is writable',
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
