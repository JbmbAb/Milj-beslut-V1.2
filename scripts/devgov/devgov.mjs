#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED_ENVIRONMENT: 'BLOCKED_ENVIRONMENT',
  DENIED_GOVERNANCE: 'DENIED_GOVERNANCE',
});

const ANCESTRY_POLICIES = new Set(['exact_parent', 'descendant_of_base', 'merge_base_equals_base']);
const EVIDENCE_KINDS = new Set(['RED', 'GREEN']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function manifestHash(manifest) {
  return sha256(stableJson(manifest));
}

export function canonicalPath(pathValue, base = process.cwd()) {
  const absolute = isAbsolute(pathValue) ? pathValue : resolve(base, pathValue);
  const normalized = existsSync(absolute) ? realpathSync.native(absolute) : resolve(absolute);
  return normalized.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

export function normalizeRepoPath(pathValue) {
  return pathValue
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
}

function globToRegExp(glob) {
  const normalized = normalizeRepoPath(glob);
  let pattern = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      const after = normalized[index + 2];
      if (after === '/') {
        pattern += '(?:.*\\/)?';
        index += 2;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if ('\\^$+?.()|{}[]'.includes(char)) {
      pattern += `\\${char}`;
    } else {
      pattern += char;
    }
  }
  return new RegExp(`^${pattern}$`);
}

export function matchesAny(pathValue, patterns = []) {
  const normalized = normalizeRepoPath(pathValue);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function classifyDiffScope(paths, allowedPaths = [], forbiddenPaths = []) {
  const violations = [];
  for (const rawPath of paths) {
    const pathValue = normalizeRepoPath(rawPath);
    if (matchesAny(pathValue, forbiddenPaths)) {
      violations.push({ path: pathValue, reason: 'FORBIDDEN_PATH' });
      continue;
    }
    if (allowedPaths.length > 0 && !matchesAny(pathValue, allowedPaths)) {
      violations.push({ path: pathValue, reason: 'NOT_ALLOWED' });
    }
  }
  return violations;
}

export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schema_version !== 'dev-gov-v0') errors.push('schema_version must be dev-gov-v0');
  for (const field of ['unit', 'role', 'mode', 'worktree', 'branch', 'base_sha', 'ancestry_policy']) {
    if (!manifest?.[field]) errors.push(`${field} is required`);
  }
  if (manifest?.ancestry_policy && !ANCESTRY_POLICIES.has(manifest.ancestry_policy)) {
    errors.push(`unsupported ancestry_policy: ${manifest.ancestry_policy}`);
  }
  if (!Array.isArray(manifest?.allowed_paths)) errors.push('allowed_paths must be an array');
  if (!Array.isArray(manifest?.forbidden_paths)) errors.push('forbidden_paths must be an array');
  for (const kind of ['required_red', 'required_green']) {
    if (manifest?.[kind] && !Array.isArray(manifest[kind])) errors.push(`${kind} must be an array`);
  }
  return errors;
}

export function evaluateRepositoryState(manifest, state) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) return { result: RESULT.DENIED_GOVERNANCE, errors };

  if (canonicalPath(state.worktree) !== canonicalPath(manifest.worktree)) {
    errors.push(`worktree mismatch: expected ${manifest.worktree}, got ${state.worktree}`);
  }
  if (state.branch !== manifest.branch) {
    errors.push(`branch mismatch: expected ${manifest.branch}, got ${state.branch}`);
  }
  if (state.dirty) errors.push('dirty tree rejected');

  if (manifest.ancestry_policy === 'exact_parent' && state.parent_sha !== manifest.base_sha) {
    errors.push(`parent mismatch: expected ${manifest.base_sha}, got ${state.parent_sha}`);
  }
  if (manifest.ancestry_policy === 'descendant_of_base' && !state.is_descendant_of_base) {
    errors.push(`HEAD is not a descendant of ${manifest.base_sha}`);
  }
  if (manifest.ancestry_policy === 'merge_base_equals_base' && state.merge_base_sha !== manifest.base_sha) {
    errors.push(`merge-base mismatch: expected ${manifest.base_sha}, got ${state.merge_base_sha}`);
  }

  const diffViolations = classifyDiffScope(
    state.changed_paths || [],
    manifest.allowed_paths,
    manifest.forbidden_paths,
  );
  for (const violation of diffViolations) {
    errors.push(`${violation.reason}: ${violation.path}`);
  }

  return errors.length > 0
    ? { result: RESULT.DENIED_GOVERNANCE, errors }
    : { result: RESULT.PASS, errors: [] };
}

export function evaluateEvidenceGate(manifest, evidenceRecords, finalSha) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) return { result: RESULT.DENIED_GOVERNANCE, errors };

  const hash = manifestHash(manifest);
  const requiredRed = manifest.required_red || [];
  const requiredGreen = manifest.required_green || [];

  for (const red of requiredRed) {
    const redRecord = evidenceRecords.find(
      (record) =>
        record.kind === 'RED' &&
        record.unit === manifest.unit &&
        record.test_id === red.id &&
        record.base_sha === manifest.base_sha &&
        record.manifest_hash === hash &&
        record.classification === (red.expected_classification || RESULT.FAIL),
    );
    if (!redRecord) {
      errors.push(`missing valid RED evidence for ${red.id}`);
      continue;
    }

    for (const green of requiredGreen) {
      const greenRecord = evidenceRecords.find(
        (record) =>
          record.kind === 'GREEN' &&
          record.unit === manifest.unit &&
          record.test_id === green.id &&
          record.head_sha === finalSha &&
          record.manifest_hash === hash &&
          record.classification === RESULT.PASS &&
          new Date(record.timestamp).getTime() > new Date(redRecord.timestamp).getTime(),
      );
      if (!greenRecord) {
        errors.push(`missing valid GREEN evidence for ${green.id} after RED ${red.id}`);
      }
    }
  }

  if (requiredRed.length === 0) {
    for (const green of requiredGreen) {
      const greenRecord = evidenceRecords.find(
        (record) =>
          record.kind === 'GREEN' &&
          record.unit === manifest.unit &&
          record.test_id === green.id &&
          record.head_sha === finalSha &&
          record.manifest_hash === hash &&
          record.classification === RESULT.PASS,
      );
      if (!greenRecord) errors.push(`missing valid GREEN evidence for ${green.id}`);
    }
  }

  return errors.length > 0
    ? { result: RESULT.DENIED_GOVERNANCE, errors }
    : { result: RESULT.PASS, errors: [] };
}

export function evaluateShaVerification(manifest, state) {
  const errors = [];
  if (manifest.target_sha && state.head_sha !== manifest.target_sha) {
    errors.push(`local HEAD mismatch: expected ${manifest.target_sha}, got ${state.head_sha}`);
  }
  if (
    manifest.remote?.branch &&
    state.remote_sha &&
    manifest.target_sha &&
    state.remote_sha !== manifest.target_sha
  ) {
    errors.push(`remote SHA mismatch: expected ${manifest.target_sha}, got ${state.remote_sha}`);
  }
  if (manifest.remote?.branch && state.remote_sha && state.head_sha !== state.remote_sha) {
    errors.push(`local/remote divergence: local ${state.head_sha}, remote ${state.remote_sha}`);
  }
  if (state.dirty) errors.push('dirty tree rejected for SHA verification');
  return errors.length > 0
    ? { result: RESULT.DENIED_GOVERNANCE, errors }
    : { result: RESULT.PASS, errors: [] };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function readRepositoryState(manifest) {
  const cwd = manifest.worktree;
  const head = git(['rev-parse', 'HEAD'], cwd);
  const base = manifest.base_sha;
  let parent = '';
  try {
    parent = git(['rev-parse', 'HEAD^'], cwd);
  } catch {
    parent = '';
  }
  let branch = git(['branch', '--show-current'], cwd);
  if (!branch) branch = 'HEAD';
  let mergeBase = '';
  let isDescendant = false;
  try {
    mergeBase = git(['merge-base', 'HEAD', base], cwd);
    isDescendant = spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd }).status === 0;
  } catch {
    mergeBase = '';
  }
  const changed = git(['diff', '--name-only', `${base}..HEAD`], cwd)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const status = git(['status', '--short'], cwd);
  return {
    worktree: git(['rev-parse', '--show-toplevel'], cwd),
    branch,
    head_sha: head,
    parent_sha: parent,
    merge_base_sha: mergeBase,
    is_descendant_of_base: isDescendant,
    dirty: status.length > 0,
    changed_paths: changed,
  };
}

export function runManifestCommand(manifest, commandSpec, kind) {
  if (!EVIDENCE_KINDS.has(kind)) throw new Error(`unsupported evidence kind: ${kind}`);
  const cwd = resolve(manifest.worktree, commandSpec.cwd || '.');
  const startedAt = new Date().toISOString();
  const result = spawnSync(commandSpec.command, commandSpec.args || [], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(commandSpec.env || {}) },
  });
  const headSha = git(['rev-parse', 'HEAD'], manifest.worktree);
  let classification = RESULT.PASS;
  if (result.error) {
    classification = ['ENOENT', 'EACCES'].includes(result.error.code)
      ? RESULT.BLOCKED_ENVIRONMENT
      : RESULT.FAIL;
  } else if ((result.status ?? 1) !== 0) {
    classification = commandSpec.blocked_exit_codes?.includes(result.status)
      ? RESULT.BLOCKED_ENVIRONMENT
      : RESULT.FAIL;
  }
  return {
    schema_version: 'dev-gov-v0-evidence',
    unit: manifest.unit,
    kind,
    test_id: commandSpec.id,
    base_sha: manifest.base_sha,
    head_sha: headSha,
    manifest_hash: manifestHash(manifest),
    command: [commandSpec.command, ...(commandSpec.args || [])].join(' '),
    cwd,
    exit_code: result.status,
    classification,
    timestamp: startedAt,
    stdout_sha256: sha256(result.stdout || ''),
    stderr_sha256: sha256(result.stderr || ''),
  };
}

export function writeEvidence(manifest, evidence, root = manifest.worktree) {
  const finalDir = resolve(root, 'governance', 'devgov', 'evidence', manifest.unit, evidence.head_sha);
  mkdirSync(finalDir, { recursive: true });
  const file = resolve(finalDir, `${evidence.kind.toLowerCase()}-${evidence.test_id}.json`);
  if (existsSync(file)) throw new Error(`immutable evidence already exists: ${file}`);
  writeFileSync(file, `${stableJson(evidence)}\n`);
  return file;
}

function loadManifest(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.result === RESULT.PASS ? 0 : 1);
}

function usage() {
  console.error(
    'Usage: node scripts/devgov/devgov.mjs <preflight|verify-sha|evidence-gate|run-red|run-green> --manifest <file>',
  );
  process.exit(2);
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const manifestPath = argValue(args, '--manifest');
  if (!command || !manifestPath) usage();
  const manifest = loadManifest(manifestPath);

  if (command === 'preflight') {
    printResult(evaluateRepositoryState(manifest, readRepositoryState(manifest)));
  }

  if (command === 'verify-sha') {
    const state = readRepositoryState(manifest);
    if (manifest.remote?.branch) {
      try {
        state.remote_sha =
          git(
            ['ls-remote', '--heads', manifest.remote.name || 'origin', manifest.remote.branch],
            manifest.worktree,
          ).split(/\s+/)[0] || '';
      } catch {
        state.remote_sha = '';
      }
    }
    printResult(evaluateShaVerification(manifest, state));
  }

  if (command === 'evidence-gate') {
    const evidencePath = argValue(args, '--evidence');
    if (!evidencePath) usage();
    const records = readFileSync(evidencePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const target = manifest.target_sha || git(['rev-parse', 'HEAD'], manifest.worktree);
    printResult(evaluateEvidenceGate(manifest, records, target));
  }

  if (command === 'run-red' || command === 'run-green') {
    const id = argValue(args, '--id');
    const kind = command === 'run-red' ? 'RED' : 'GREEN';
    const list = kind === 'RED' ? manifest.required_red || [] : manifest.required_green || [];
    const spec = list.find((item) => item.id === id);
    if (!spec) throw new Error(`unknown ${kind} command id: ${id}`);
    const evidence = runManifestCommand(manifest, spec, kind);
    const file = writeEvidence(manifest, evidence);
    console.log(file);
    console.log(JSON.stringify(evidence, null, 2));
    process.exit(0);
  }

  usage();
}
