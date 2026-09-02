#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyVerifierOwnedTrustPolicy } from './github-oidc.mjs';
import {
  EXECUTION_RECORD_SCHEMA,
  executionResultDigest,
  proofContractHash,
  sha256,
  signExecutionRecord,
  stableJson,
  validateTrustPolicy,
  verifyExecutionAttestation,
} from './trusted-attestation.mjs';

export { proofContractHash, sha256, signExecutionRecord } from './trusted-attestation.mjs';

export const RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED_ENVIRONMENT: 'BLOCKED_ENVIRONMENT',
  DENIED_GOVERNANCE: 'DENIED_GOVERNANCE',
});

export const EXIT_CODE = Object.freeze({
  PASS: 0,
  FAIL: 2,
  BLOCKED_ENVIRONMENT: 3,
  DENIED_GOVERNANCE: 4,
  INTERNAL_ERROR: 5,
});

const ANCESTRY_POLICIES = new Set(['exact_parent', 'descendant_of_base', 'merge_base_equals_base']);
const EVIDENCE_KINDS = new Set(['RED', 'GREEN']);
const TOOL_VERSION = 'dev-gov-v0.5';
const LOADED_EVIDENCE_PATH = Symbol('loadedEvidencePath');
const REMOTE_STATUS = Object.freeze({
  MATCH: 'REMOTE_MATCH',
  ABSENT_ALLOWED: 'REMOTE_ABSENT_ALLOWED_BY_POLICY',
  LOOKUP_FAILED: 'REMOTE_LOOKUP_FAILED',
  DIVERGED: 'REMOTE_DIVERGED',
  NOT_CONFIGURED: 'REMOTE_NOT_CONFIGURED',
});

export function manifestHash(manifest) {
  return sha256(stableJson(manifest));
}

export function canonicalPath(pathValue, base = process.cwd(), options = {}) {
  const absolute = isAbsolute(pathValue) ? pathValue : resolve(base, pathValue);
  const normalized = existsSync(absolute) ? realpathSync.native(absolute) : resolve(absolute);
  const slashed = normalized.replaceAll('\\', '/').replace(/\/+$/, '');
  const platform = options.platform || process.platform;
  return platform === 'win32' ? slashed.toLowerCase() : slashed;
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
  for (const field of [
    'unit',
    'role',
    'mode',
    'worktree',
    'branch',
    'base_sha',
    'target_sha',
    'ancestry_policy',
  ]) {
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
  if (manifest?.trusted_execution) {
    if (!manifest.trusted_execution.issuer) errors.push('trusted_execution.issuer is required');
    if (!manifest.trusted_execution.key_id) errors.push('trusted_execution.key_id is required');
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

  if (manifest.ancestry_policy === 'exact_parent') {
    if (state.parent_count !== 1) {
      errors.push(`exact_parent requires one parent, got ${state.parent_count ?? 'unknown'}`);
    }
    if (state.parent_sha !== manifest.base_sha) {
      errors.push(`parent mismatch: expected ${manifest.base_sha}, got ${state.parent_sha}`);
    }
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

export function evaluateLocalProvenance(manifest, evidenceRecords, finalSha) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) return { result: RESULT.DENIED_GOVERNANCE, errors };

  const hash = manifestHash(manifest);
  const requiredRed = manifest.required_red || [];
  const requiredGreen = manifest.required_green || [];

  for (const red of requiredRed) {
    const redRecords = evidenceRecords.filter(
      (record) =>
        record.kind === 'RED' &&
        isToolProducedEvidence(record) &&
        isCanonicalEvidencePath(manifest, record) &&
        record.unit === manifest.unit &&
        record.test_id === red.id &&
        record.base_sha === manifest.base_sha &&
        record.head_sha === manifest.base_sha &&
        record.observed_head_sha === record.head_sha &&
        record.target_sha === manifest.target_sha &&
        record.required_head === (red.required_head || 'base_sha') &&
        record.manifest_hash === hash &&
        record.command === commandString(red) &&
        record.classification === (red.expected_classification || RESULT.FAIL),
    );
    const redRecord = redRecords[0];
    if (redRecords.length > 1) {
      errors.push(`duplicate valid RED evidence for ${red.id}`);
      continue;
    }
    if (!redRecord) {
      errors.push(`missing valid RED evidence for ${red.id}`);
      continue;
    }

    for (const green of requiredGreen) {
      const greenRecords = evidenceRecords.filter(
        (record) =>
          record.kind === 'GREEN' &&
          isToolProducedEvidence(record) &&
          isCanonicalEvidencePath(manifest, record) &&
          record.unit === manifest.unit &&
          record.test_id === green.id &&
          record.base_sha === manifest.base_sha &&
          record.head_sha === finalSha &&
          record.observed_head_sha === record.head_sha &&
          record.target_sha === manifest.target_sha &&
          record.required_head === (green.required_head || 'target_sha') &&
          record.manifest_hash === hash &&
          record.command === commandString(green) &&
          record.classification === RESULT.PASS &&
          new Date(record.started_at).getTime() > new Date(redRecord.finished_at).getTime(),
      );
      const greenRecord = greenRecords[0];
      if (greenRecords.length > 1) {
        errors.push(`duplicate valid GREEN evidence for ${green.id}`);
        continue;
      }
      if (!greenRecord) {
        errors.push(`missing valid GREEN evidence for ${green.id} after RED ${red.id}`);
      }
    }
  }

  if (requiredRed.length === 0) {
    for (const green of requiredGreen) {
      const greenRecords = evidenceRecords.filter(
        (record) =>
          record.kind === 'GREEN' &&
          isToolProducedEvidence(record) &&
          isCanonicalEvidencePath(manifest, record) &&
          record.unit === manifest.unit &&
          record.test_id === green.id &&
          record.base_sha === manifest.base_sha &&
          record.head_sha === finalSha &&
          record.observed_head_sha === record.head_sha &&
          record.target_sha === manifest.target_sha &&
          record.required_head === (green.required_head || 'target_sha') &&
          record.manifest_hash === hash &&
          record.command === commandString(green) &&
          record.classification === RESULT.PASS,
      );
      const greenRecord = greenRecords[0];
      if (greenRecords.length > 1) {
        errors.push(`duplicate valid GREEN evidence for ${green.id}`);
        continue;
      }
      if (!greenRecord) errors.push(`missing valid GREEN evidence for ${green.id}`);
    }
  }

  return errors.length > 0
    ? { result: RESULT.DENIED_GOVERNANCE, errors }
    : { result: RESULT.PASS, errors: [] };
}

function expectedExecutionSha(manifest, commandSpec, kind) {
  const requiredHead = commandSpec.required_head || (kind === 'GREEN' ? 'target_sha' : 'base_sha');
  if (requiredHead === 'target_sha') return manifest.target_sha;
  if (requiredHead === 'base_sha') return manifest.base_sha;
  return undefined;
}

function matchingTrustedAttestations(manifest, attestations, commandSpec, kind, classification) {
  const executionSha = expectedExecutionSha(manifest, commandSpec, kind);
  const contractHash = proofContractHash(manifest);
  return attestations.filter(
    (record) =>
      record.issuer === manifest.trusted_execution?.issuer &&
      record.key_id === manifest.trusted_execution?.key_id &&
      record.unit_id === manifest.unit &&
      record.proof_contract_hash === contractHash &&
      record.base_sha === manifest.base_sha &&
      record.target_sha === manifest.target_sha &&
      (!executionSha || record.execution_sha === executionSha) &&
      record.proof_type === kind &&
      record.test_id === commandSpec.id &&
      record.command === commandString(commandSpec) &&
      record.classification === classification,
  );
}

export function evaluateTrustedExecutionGate(manifest, attestations, trustPolicy) {
  const errors = validateManifest(manifest);
  if (!manifest?.trusted_execution) errors.push('trusted_execution is required');
  errors.push(...validateTrustPolicy(trustPolicy));
  if (!Array.isArray(attestations) || attestations.length === 0) {
    errors.push('trusted execution attestation is required');
  }
  if (errors.length > 0) {
    return { result: RESULT.DENIED_GOVERNANCE, proof_status: 'NOT_PROVEN', errors };
  }

  for (const attestation of attestations) {
    const verification = verifyExecutionAttestation(attestation, trustPolicy);
    if (!verification.valid) errors.push(...verification.errors);
  }
  if (errors.length > 0) {
    return { result: RESULT.DENIED_GOVERNANCE, proof_status: 'NOT_PROVEN', errors };
  }

  const redRecords = new Map();
  for (const red of manifest.required_red || []) {
    const records = matchingTrustedAttestations(
      manifest,
      attestations,
      red,
      'RED',
      red.expected_classification || RESULT.FAIL,
    );
    if (records.length !== 1) {
      errors.push(
        records.length === 0
          ? `missing trusted RED attestation for ${red.id}`
          : `duplicate trusted RED attestations for ${red.id}`,
      );
    } else {
      redRecords.set(red.id, records[0]);
    }
  }

  for (const green of manifest.required_green || []) {
    const records = matchingTrustedAttestations(manifest, attestations, green, 'GREEN', RESULT.PASS);
    if (records.length !== 1) {
      errors.push(
        records.length === 0
          ? `missing trusted GREEN attestation for ${green.id}`
          : `duplicate trusted GREEN attestations for ${green.id}`,
      );
      continue;
    }
    for (const redRecord of redRecords.values()) {
      if (new Date(records[0].started_at).getTime() <= new Date(redRecord.finished_at).getTime()) {
        errors.push(`trusted GREEN attestation for ${green.id} does not follow trusted RED`);
      }
    }
  }

  return errors.length > 0
    ? { result: RESULT.DENIED_GOVERNANCE, proof_status: 'NOT_PROVEN', errors }
    : { result: RESULT.PASS, proof_status: 'PROVEN', errors: [] };
}

export function evaluateEvidenceGateWithLiveRepository(manifest, options = {}) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    return resultEnvelope(RESULT.DENIED_GOVERNANCE, 'INVALID_MANIFEST', errors.join('; '), errors);
  }

  let state;
  try {
    state = readRepositoryState(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return resultEnvelope(RESULT.DENIED_GOVERNANCE, 'REPOSITORY_STATE_UNRESOLVED', message, [message]);
  }

  const repository = evaluateRepositoryState(manifest, state);
  if (repository.result !== RESULT.PASS) {
    return resultEnvelope(
      RESULT.DENIED_GOVERNANCE,
      'REPOSITORY_STATE_DENIED',
      repository.errors.join('; '),
      repository.errors,
    );
  }

  const sha = evaluateShaVerification(manifest, resolveRemoteVerification(manifest, state));
  if (sha.result !== RESULT.PASS) {
    return resultEnvelope(
      RESULT.DENIED_GOVERNANCE,
      'SHA_VERIFICATION_DENIED',
      sha.errors.join('; '),
      sha.errors,
    );
  }

  const evidence = evaluateTrustedExecutionGate(manifest, options.attestations || [], options.trustPolicy);
  const missingAuthority =
    !options.trustPolicy || !Array.isArray(options.attestations) || options.attestations.length === 0;
  return resultEnvelope(
    evidence.result,
    evidence.result === RESULT.PASS
      ? 'PASS'
      : missingAuthority
        ? 'TRUSTED_EXECUTION_ATTESTATION_REQUIRED'
        : 'TRUSTED_EXECUTION_ATTESTATION_DENIED',
    evidence.errors.join('; ') || 'PASS',
    evidence.errors,
    {
      proof_status: evidence.proof_status,
      trust_policy_sha256: options.trustPolicy ? sha256(stableJson(options.trustPolicy)) : undefined,
      proof_ids: (options.attestations || []).map((record) => record.proof_id).filter(Boolean),
    },
  );
}

function commandString(commandSpec) {
  return [commandSpec.command, ...(commandSpec.args || [])].join(' ');
}

export function isToolProducedEvidence(record) {
  if (record?.schema_version !== 'dev-gov-v0-execution-evidence') return false;
  if (record.produced_by !== 'devgov-v0') return false;
  if (record.tool_version !== TOOL_VERSION) return false;
  if (!EVIDENCE_KINDS.has(record.kind)) return false;
  if (!record.execution_nonce) return false;
  if (!record.sequence) return false;
  if (!record.evidence_path) return false;
  if (!record.started_at || !record.finished_at) return false;
  if (!record.command || !record.cwd) return false;
  if (
    !record.manifest_hash ||
    !record.base_sha ||
    !record.target_sha ||
    !record.head_sha ||
    !record.observed_head_sha ||
    !record.required_head ||
    !record.test_id ||
    !record.unit
  ) {
    return false;
  }
  if (record.observed_head_sha !== record.head_sha) return false;
  if (!record.stdout_sha256 || !record.stderr_sha256) return false;
  if (!Object.values(RESULT).includes(record.classification)) return false;
  if (!record.evidence_hash) return false;
  const { evidence_hash, ...unsigned } = record;
  if (!record.finalized_at) return false;
  if (evidence_hash !== sha256(stableJson(unsigned))) return false;
  return true;
}

function safeUnitPath(unit) {
  return String(unit).replace(/[^A-Za-z0-9._-]/g, '_');
}

function gitCommonDir(worktree) {
  const raw = git(['rev-parse', '--git-common-dir'], worktree);
  return isAbsolute(raw) ? raw : resolve(worktree, raw);
}

export function canonicalEvidenceDir(manifest, root) {
  const base = root || gitCommonDir(manifest.worktree);
  return resolve(base, 'devgov', 'evidence', safeUnitPath(manifest.unit), manifestHash(manifest));
}

function evidenceFilePath(manifest, evidence, root) {
  return resolve(
    canonicalEvidenceDir(manifest, root),
    `${evidence.kind.toLowerCase()}-${evidence.test_id}-${evidence.head_sha}-${evidence.execution_nonce}.json`,
  );
}

export function isCanonicalEvidencePath(manifest, record, root) {
  const dir = `${canonicalPath(canonicalEvidenceDir(manifest, root))}/`;
  const evidencePath = canonicalPath(record.evidence_path);
  if (!evidencePath.startsWith(dir)) return false;
  const expectedPath = canonicalPath(evidenceFilePath(manifest, record, root));
  if (evidencePath !== expectedPath) return false;
  if (record[LOADED_EVIDENCE_PATH] && canonicalPath(record[LOADED_EVIDENCE_PATH]) !== evidencePath) {
    return false;
  }
  return true;
}

export function loadCanonicalEvidence(manifest) {
  const dir = canonicalEvidenceDir(manifest);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const loadedFrom = resolve(dir, file);
      const record = JSON.parse(readFileSync(loadedFrom, 'utf8'));
      Object.defineProperty(record, LOADED_EVIDENCE_PATH, {
        value: loadedFrom,
        enumerable: false,
      });
      return record;
    });
}

export function evaluateShaVerification(manifest, state) {
  const errors = validateManifest(manifest);
  if (state.head_sha !== manifest.target_sha) {
    errors.push(`local HEAD mismatch: expected ${manifest.target_sha}, got ${state.head_sha}`);
  }
  if (manifest.remote?.branch) {
    const remoteStatus =
      state.remote_status ||
      (state.remote_sha
        ? state.remote_sha === manifest.target_sha
          ? REMOTE_STATUS.MATCH
          : REMOTE_STATUS.DIVERGED
        : undefined);
    if (remoteStatus === REMOTE_STATUS.LOOKUP_FAILED) {
      errors.push(`remote lookup failed for ${manifest.remote.name || 'origin'}/${manifest.remote.branch}`);
    } else if (remoteStatus === REMOTE_STATUS.DIVERGED) {
      errors.push(`remote SHA mismatch: expected ${manifest.target_sha}, got ${state.remote_sha}`);
    } else if (
      remoteStatus === REMOTE_STATUS.ABSENT_ALLOWED &&
      manifest.remote.absent_policy !== 'allow_absent'
    ) {
      errors.push(`remote absent but policy is not allow_absent`);
    } else if (!remoteStatus || remoteStatus === REMOTE_STATUS.NOT_CONFIGURED) {
      errors.push(
        `remote verification missing for ${manifest.remote.name || 'origin'}/${manifest.remote.branch}`,
      );
    }
    if (state.remote_sha && state.head_sha !== state.remote_sha) {
      errors.push(`local/remote divergence: local ${state.head_sha}, remote ${state.remote_sha}`);
    }
  }
  if (state.dirty) errors.push('dirty tree rejected for SHA verification');
  return errors.length > 0
    ? { result: RESULT.DENIED_GOVERNANCE, errors }
    : { result: RESULT.PASS, errors: [] };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitBuffer(args, cwd) {
  return execFileSync('git', args, { cwd });
}

function gitStatus(cwd) {
  return git(['status', '--porcelain=v1', '-z'], cwd);
}

function parseNulSeparatedPaths(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveRemoteVerification(manifest, state = {}) {
  if (!manifest.remote?.branch) return { ...state, remote_status: REMOTE_STATUS.NOT_CONFIGURED };
  const remoteName = manifest.remote.name || 'origin';
  const lookup = spawnSync('git', ['ls-remote', '--heads', remoteName, manifest.remote.branch], {
    cwd: manifest.worktree,
    encoding: 'utf8',
    timeout: manifest.remote.timeout_ms || 15_000,
  });
  if (lookup.error || lookup.status !== 0) {
    return {
      ...state,
      remote_sha: '',
      remote_status: REMOTE_STATUS.LOOKUP_FAILED,
      remote_error: lookup.error?.message || lookup.stderr || `exit ${lookup.status}`,
    };
  }
  const remoteSha = lookup.stdout.trim().split(/\s+/)[0] || '';
  if (!remoteSha && manifest.remote.absent_policy === 'allow_absent') {
    return { ...state, remote_sha: '', remote_status: REMOTE_STATUS.ABSENT_ALLOWED };
  }
  if (!remoteSha) {
    return {
      ...state,
      remote_sha: '',
      remote_status: REMOTE_STATUS.LOOKUP_FAILED,
      remote_error: 'remote branch absent',
    };
  }
  return {
    ...state,
    remote_sha: remoteSha,
    remote_status: remoteSha === manifest.target_sha ? REMOTE_STATUS.MATCH : REMOTE_STATUS.DIVERGED,
  };
}

export function readRepositoryState(manifest) {
  const cwd = manifest.worktree;
  const head = git(['rev-parse', 'HEAD'], cwd);
  const base = manifest.base_sha;
  let parent = '';
  let parentCount = 0;
  try {
    parent = git(['rev-parse', 'HEAD^'], cwd);
  } catch {
    parent = '';
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD'], cwd).split(/\s+/).slice(1);
    parentCount = parents.length;
  } catch {
    parentCount = 0;
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
  const changed = parseNulSeparatedPaths(gitBuffer(['diff', '--name-only', '-z', `${base}..HEAD`], cwd));
  const status = gitStatus(cwd);
  return {
    worktree: git(['rev-parse', '--show-toplevel'], cwd),
    branch,
    head_sha: head,
    parent_sha: parent,
    parent_count: parentCount,
    merge_base_sha: mergeBase,
    is_descendant_of_base: isDescendant,
    dirty: status.length > 0,
    changed_paths: changed,
  };
}

export function runManifestCommand(manifest, commandSpec, kind, options = {}) {
  if (!EVIDENCE_KINDS.has(kind)) throw new Error(`unsupported evidence kind: ${kind}`);
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) throw new Error(`invalid manifest: ${manifestErrors.join('; ')}`);
  const executionWorktree = options.worktree || manifest.worktree;
  const cwd = resolve(executionWorktree, commandSpec.cwd || '.');
  const startedAt = new Date().toISOString();
  const executionNonce = randomUUID();
  const headBefore = git(['rev-parse', 'HEAD'], executionWorktree);
  const statusBefore = gitStatus(executionWorktree);
  const requiredHead = commandSpec.required_head || (kind === 'GREEN' ? 'target_sha' : 'base_sha');
  const expectedHead =
    requiredHead === 'target_sha'
      ? manifest.target_sha
      : requiredHead === 'base_sha'
        ? manifest.base_sha
        : undefined;
  if (expectedHead && headBefore !== expectedHead) {
    return executionEvidence({
      manifest,
      kind,
      commandSpec,
      requiredHead,
      cwd,
      headSha: headBefore,
      startedAt,
      finishedAt: new Date().toISOString(),
      executionNonce,
      exitCode: null,
      classification: RESULT.DENIED_GOVERNANCE,
      environment_error: `${kind} requires HEAD ${expectedHead}, got ${headBefore}`,
      stdout: '',
      stderr: '',
    });
  }
  if (statusBefore.length > 0) {
    return executionEvidence({
      manifest,
      kind,
      commandSpec,
      requiredHead,
      cwd,
      headSha: headBefore,
      startedAt,
      finishedAt: new Date().toISOString(),
      executionNonce,
      exitCode: null,
      classification: RESULT.DENIED_GOVERNANCE,
      environment_error: 'dirty tree rejected before command execution',
      stdout: '',
      stderr: '',
    });
  }
  const result = spawnSync(commandSpec.command, commandSpec.args || [], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(commandSpec.env || {}), ...(options.env || {}) },
    timeout: commandSpec.timeout_ms || 120_000,
    uid: options.uid,
    gid: options.gid,
  });
  const finishedAt = new Date().toISOString();
  const headAfter = git(['rev-parse', 'HEAD'], executionWorktree);
  const statusAfter = gitStatus(executionWorktree);
  let classification = RESULT.PASS;
  let environmentError = '';
  if (headAfter !== headBefore || statusAfter.length > 0) {
    classification = RESULT.DENIED_GOVERNANCE;
    environmentError = 'proof surface changed during command execution';
  } else if (result.error) {
    classification = classifySpawnError(result.error);
    environmentError = result.error.message;
  } else if ((result.status ?? 1) !== 0) {
    classification = commandSpec.blocked_exit_codes?.includes(result.status)
      ? RESULT.BLOCKED_ENVIRONMENT
      : RESULT.FAIL;
  }
  return executionEvidence({
    manifest,
    kind,
    commandSpec,
    requiredHead,
    cwd,
    headSha: headAfter,
    startedAt,
    finishedAt,
    executionNonce,
    exitCode: result.status,
    classification,
    environment_error: environmentError,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  });
}

export function trustedExecutionRecord(manifest, evidence, context) {
  for (const field of [
    'runner_identity',
    'controller_sha',
    'workflow_ref',
    'workflow_run_id',
    'workflow_run_attempt',
  ]) {
    if (!context?.[field]) throw new Error(`${field} is required for trusted execution`);
  }
  const record = {
    schema_version: EXECUTION_RECORD_SCHEMA,
    unit_id: manifest.unit,
    proof_contract_hash: proofContractHash(manifest),
    source_manifest_hash: manifestHash(manifest),
    base_sha: manifest.base_sha,
    target_sha: manifest.target_sha,
    execution_sha: evidence.head_sha,
    proof_type: evidence.kind,
    test_id: evidence.test_id,
    command: evidence.command,
    exit_code: evidence.exit_code,
    classification: evidence.classification,
    environment_error: evidence.environment_error || '',
    started_at: evidence.started_at,
    finished_at: evidence.finished_at,
    runner_identity: context.runner_identity,
    controller_sha: context.controller_sha,
    workflow_ref: context.workflow_ref,
    workflow_run_id: String(context.workflow_run_id),
    workflow_run_attempt: String(context.workflow_run_attempt),
    stdout_sha256: evidence.stdout_sha256,
    stderr_sha256: evidence.stderr_sha256,
  };
  return { ...record, result_digest: executionResultDigest(record) };
}

export function validateExecutionRecordForManifest(manifest, record, kind, id) {
  const errors = validateManifest(manifest);
  const list = kind === 'RED' ? manifest.required_red || [] : manifest.required_green || [];
  const spec = list.find((item) => item.id === id);
  if (!spec) return [...errors, `unknown ${kind} command id: ${id}`];
  const expectedClassification = kind === 'RED' ? spec.expected_classification || RESULT.FAIL : RESULT.PASS;
  const expectedSha = expectedExecutionSha(manifest, spec, kind);
  const expected = {
    unit_id: manifest.unit,
    proof_contract_hash: proofContractHash(manifest),
    source_manifest_hash: manifestHash(manifest),
    base_sha: manifest.base_sha,
    target_sha: manifest.target_sha,
    proof_type: kind,
    test_id: id,
    command: commandString(spec),
    classification: expectedClassification,
  };
  if (expectedSha) expected.execution_sha = expectedSha;
  for (const [field, value] of Object.entries(expected)) {
    if (record?.[field] !== value) errors.push(`${field} mismatch`);
  }
  return errors;
}

function classifySpawnError(error) {
  if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') return RESULT.BLOCKED_ENVIRONMENT;
  if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].includes(error.code)) return RESULT.BLOCKED_ENVIRONMENT;
  return RESULT.FAIL;
}

function executionEvidence({
  manifest,
  kind,
  commandSpec,
  requiredHead,
  cwd,
  headSha,
  startedAt,
  finishedAt,
  executionNonce,
  exitCode,
  classification,
  environment_error,
  stdout,
  stderr,
}) {
  return {
    schema_version: 'dev-gov-v0-execution-evidence',
    produced_by: 'devgov-v0',
    tool_version: TOOL_VERSION,
    execution_nonce: executionNonce,
    unit: manifest.unit,
    kind,
    test_id: commandSpec.id,
    base_sha: manifest.base_sha,
    target_sha: manifest.target_sha,
    head_sha: headSha,
    observed_head_sha: headSha,
    required_head: requiredHead,
    manifest_hash: manifestHash(manifest),
    command: [commandSpec.command, ...(commandSpec.args || [])].join(' '),
    cwd,
    started_at: startedAt,
    finished_at: finishedAt,
    exit_code: exitCode,
    classification,
    environment_error,
    stdout_sha256: sha256(stdout || ''),
    stderr_sha256: sha256(stderr || ''),
  };
}

export function finalizeEvidenceRecord(manifest, evidence, root) {
  const file = evidenceFilePath(manifest, evidence, root);
  const sequence = `${evidence.started_at}-${evidence.kind}-${evidence.test_id}-${evidence.execution_nonce}`;
  const unsigned = {
    ...evidence,
    sequence,
    evidence_path: file,
    finalized_at: new Date().toISOString(),
  };
  return { ...unsigned, evidence_hash: sha256(stableJson(unsigned)) };
}

export function writeEvidence(manifest, evidence, root = manifest.worktree) {
  const canonicalRoot = root === manifest.worktree ? undefined : root;
  const finalDir = canonicalEvidenceDir(manifest, canonicalRoot);
  mkdirSync(finalDir, { recursive: true });
  const finalized = finalizeEvidenceRecord(manifest, evidence, canonicalRoot);
  const file = finalized.evidence_path;
  if (existsSync(file)) throw new Error(`immutable evidence already exists: ${file}`);
  writeFileSync(file, `${stableJson(finalized)}\n`);
  return file;
}

function loadManifest(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJsonExclusive(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${stableJson(value)}\n`, { flag: 'wx' });
}

function resultEnvelope(classification, reasonCode, message, errors = [], extra = {}) {
  return {
    result: classification === RESULT.PASS ? RESULT.PASS : classification,
    classification,
    reason_code: reasonCode,
    message,
    errors,
    ...extra,
  };
}

function normalizeResult(result, fallbackReason) {
  if (result.classification && result.reason_code && result.message !== undefined) return result;
  return resultEnvelope(
    result.result || RESULT.FAIL,
    fallbackReason,
    result.errors?.join('; ') || result.result || RESULT.FAIL,
    result.errors || [],
  );
}

function exitForClassification(classification) {
  return EXIT_CODE[classification] ?? EXIT_CODE.INTERNAL_ERROR;
}

function printResult(result) {
  const normalized = normalizeResult(result, 'RESULT');
  console.log(JSON.stringify(normalized, null, 2));
  process.exit(exitForClassification(normalized.classification));
}

function usageText() {
  return 'Usage: node scripts/devgov/devgov.mjs <preflight|verify-sha|evidence-gate|run-red|run-green|execute-proof|attest-execution> [options]';
}

function usage() {
  printResult(resultEnvelope(RESULT.DENIED_GOVERNANCE, 'USAGE', usageText()));
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function argValues(args, name) {
  return args.flatMap((value, index) => (value === name && args[index + 1] ? [args[index + 1]] : []));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (!command) usage();
    if (command === 'attest-execution') {
      const manifestPath = argValue(args, '--manifest');
      const recordPath = argValue(args, '--record');
      const outputPath = argValue(args, '--output');
      const kind = argValue(args, '--kind');
      const id = argValue(args, '--id');
      const privateKey = process.env.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM;
      const issuer = process.env.DEVGOV_ATTESTATION_ISSUER;
      const keyId = process.env.DEVGOV_ATTESTATION_KEY_ID;
      if (!manifestPath || !recordPath || !outputPath || !['RED', 'GREEN'].includes(kind) || !id) {
        usage();
      }
      if (!privateKey || !issuer || !keyId) {
        printResult(
          resultEnvelope(
            RESULT.BLOCKED_ENVIRONMENT,
            'ATTESTATION_SIGNER_UNAVAILABLE',
            'record, output, and protected attestation signer environment are required',
          ),
        );
      }
      const manifest = loadManifest(manifestPath);
      const record = loadManifest(recordPath);
      const bindingErrors = validateExecutionRecordForManifest(manifest, record, kind, id);
      const runtimeBindings = {
        runner_identity: process.env.DEVGOV_RUNNER_IDENTITY,
        controller_sha: process.env.DEVGOV_CONTROLLER_SHA,
        workflow_ref: process.env.GITHUB_WORKFLOW_REF,
        workflow_run_id: process.env.GITHUB_RUN_ID,
        workflow_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
      };
      for (const [field, value] of Object.entries(runtimeBindings)) {
        if (!value || record[field] !== String(value)) bindingErrors.push(`${field} mismatch`);
      }
      if (manifest.trusted_execution?.issuer !== issuer || manifest.trusted_execution?.key_id !== keyId) {
        bindingErrors.push('protected signer does not match manifest trusted_execution');
      }
      if (bindingErrors.length > 0) {
        printResult(
          resultEnvelope(
            RESULT.DENIED_GOVERNANCE,
            'EXECUTION_RECORD_BINDING_DENIED',
            bindingErrors.join('; '),
            bindingErrors,
          ),
        );
      }
      const attestation = signExecutionRecord(record, privateKey, { issuer, key_id: keyId });
      writeJsonExclusive(outputPath, attestation);
      printResult(
        resultEnvelope(RESULT.PASS, 'PASS', 'trusted execution attestation created', [], {
          attestation_file: outputPath,
          proof_id: attestation.proof_id,
        }),
      );
    }
    const manifestPath = argValue(args, '--manifest');
    if (!manifestPath) usage();
    const manifest = loadManifest(manifestPath);

    if (command === 'preflight') {
      printResult(
        normalizeResult(evaluateRepositoryState(manifest, readRepositoryState(manifest)), 'PREFLIGHT'),
      );
    }

    if (command === 'verify-sha') {
      const state = resolveRemoteVerification(manifest, readRepositoryState(manifest));
      printResult(normalizeResult(evaluateShaVerification(manifest, state), 'VERIFY_SHA'));
    }

    if (command === 'evidence-gate') {
      const evidencePath = argValue(args, '--evidence');
      if (evidencePath) {
        printResult(
          resultEnvelope(
            RESULT.DENIED_GOVERNANCE,
            'ARBITRARY_EVIDENCE_PATH_DENIED',
            'evidence-gate reads only canonical DEV-GOV evidence for the manifest',
          ),
        );
      }
      const trustPolicyPath = argValue(args, '--trust-policy');
      if (trustPolicyPath) {
        printResult(
          resultEnvelope(
            RESULT.DENIED_GOVERNANCE,
            'TRUST_POLICY_SUBSTITUTION_DENIED',
            'evidence-gate does not accept caller-supplied trust policy',
            [],
            { proof_status: 'NOT_PROVEN' },
          ),
        );
      }
      const liveRepository = evaluateEvidenceGateWithLiveRepository(manifest);
      if (
        [
          'INVALID_MANIFEST',
          'REPOSITORY_STATE_UNRESOLVED',
          'REPOSITORY_STATE_DENIED',
          'SHA_VERIFICATION_DENIED',
        ].includes(liveRepository.reason_code)
      ) {
        printResult(liveRepository);
      }
      const attestationPaths = argValues(args, '--attestation');
      const attestations = attestationPaths.flatMap((path) => {
        const value = loadManifest(path);
        return Array.isArray(value) ? value : [value];
      });
      const rawTrustPolicy = process.env.DEVGOV_VERIFIER_TRUST_POLICY_JSON;
      const oidcToken = process.env.DEVGOV_GATE_OIDC_TOKEN;
      if (!rawTrustPolicy || !oidcToken) {
        printResult(
          resultEnvelope(
            RESULT.DENIED_GOVERNANCE,
            'TRUSTED_VERIFIER_CONFIGURATION_REQUIRED',
            'protected verifier trust policy and GitHub OIDC gate identity are required',
            [],
            { proof_status: 'NOT_PROVEN' },
          ),
        );
      }
      let trustRoot;
      try {
        trustRoot = await verifyVerifierOwnedTrustPolicy(rawTrustPolicy, oidcToken, {
          expectedCandidateSha: manifest.target_sha,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        printResult(
          resultEnvelope(RESULT.BLOCKED_ENVIRONMENT, 'GITHUB_OIDC_PROVIDER_UNAVAILABLE', message, [message], {
            proof_status: 'NOT_PROVEN',
          }),
        );
      }
      if (!trustRoot.valid) {
        printResult(
          resultEnvelope(
            RESULT.DENIED_GOVERNANCE,
            'TRUST_ROOT_PROVENANCE_DENIED',
            trustRoot.errors.join('; '),
            trustRoot.errors,
            { proof_status: 'NOT_PROVEN' },
          ),
        );
      }
      const gate = evaluateEvidenceGateWithLiveRepository(manifest, {
        trustPolicy: trustRoot.policy,
        attestations,
      });
      gate.trust_policy_sha256 = trustRoot.trust_policy_sha256;
      gate.trust_root_provenance = {
        issuer: trustRoot.oidc_claims.iss,
        audience: trustRoot.oidc_claims.aud,
        repository: trustRoot.oidc_claims.repository,
        workflow_ref: trustRoot.oidc_claims.workflow_ref,
        ref: trustRoot.oidc_claims.ref,
        environment: trustRoot.oidc_claims.environment,
        runner_environment: trustRoot.oidc_claims.runner_environment,
        run_id: trustRoot.oidc_claims.run_id,
        run_attempt: trustRoot.oidc_claims.run_attempt,
        jti: trustRoot.oidc_claims.jti,
      };
      printResult(gate);
    }

    if (command === 'execute-proof') {
      const id = argValue(args, '--id');
      const kind = argValue(args, '--kind');
      const worktree = argValue(args, '--worktree');
      const outputPath = argValue(args, '--output');
      if (!id || !['RED', 'GREEN'].includes(kind) || !worktree || !outputPath) usage();
      const list = kind === 'RED' ? manifest.required_red || [] : manifest.required_green || [];
      const spec = list.find((item) => item.id === id);
      if (!spec) {
        printResult(
          resultEnvelope(RESULT.DENIED_GOVERNANCE, 'UNKNOWN_COMMAND_ID', `unknown ${kind} command id: ${id}`),
        );
      }
      const uidValue = argValue(args, '--run-as-uid');
      const gidValue = argValue(args, '--run-as-gid');
      const runAsHome = argValue(args, '--run-as-home');
      const uid = uidValue === undefined ? undefined : Number(uidValue);
      const gid = gidValue === undefined ? undefined : Number(gidValue);
      if (
        (uidValue !== undefined || gidValue !== undefined) &&
        (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 1 || gid < 1)
      ) {
        printResult(
          resultEnvelope(
            RESULT.DENIED_GOVERNANCE,
            'INVALID_EXECUTION_IDENTITY',
            'run-as uid and gid must both be positive integers',
          ),
        );
      }
      const evidence = runManifestCommand(manifest, spec, kind, {
        worktree,
        uid,
        gid,
        env: runAsHome ? { HOME: runAsHome } : undefined,
      });
      const record = trustedExecutionRecord(manifest, evidence, {
        runner_identity: process.env.DEVGOV_RUNNER_IDENTITY,
        controller_sha: process.env.DEVGOV_CONTROLLER_SHA,
        workflow_ref: process.env.GITHUB_WORKFLOW_REF,
        workflow_run_id: process.env.GITHUB_RUN_ID,
        workflow_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
      });
      writeJsonExclusive(outputPath, record);
      const expected = kind === 'RED' ? spec.expected_classification || RESULT.FAIL : RESULT.PASS;
      const outerClassification =
        evidence.classification === expected
          ? RESULT.PASS
          : evidence.classification === RESULT.BLOCKED_ENVIRONMENT ||
              evidence.classification === RESULT.DENIED_GOVERNANCE
            ? evidence.classification
            : RESULT.FAIL;
      printResult(
        resultEnvelope(
          outerClassification,
          outerClassification,
          outerClassification === RESULT.PASS
            ? `trusted runner observed expected ${kind} result`
            : `trusted runner observed ${evidence.classification}, expected ${expected}`,
          [],
          { execution_record_file: outputPath, execution_record: record },
        ),
      );
    }

    if (command === 'run-red' || command === 'run-green') {
      const id = argValue(args, '--id');
      const kind = command === 'run-red' ? 'RED' : 'GREEN';
      const list = kind === 'RED' ? manifest.required_red || [] : manifest.required_green || [];
      const spec = list.find((item) => item.id === id);
      if (!spec) {
        printResult(
          resultEnvelope(RESULT.DENIED_GOVERNANCE, 'UNKNOWN_COMMAND_ID', `unknown ${kind} command id: ${id}`),
        );
      }
      const evidence = runManifestCommand(manifest, spec, kind);
      const file = writeEvidence(manifest, evidence);
      printResult(
        resultEnvelope(
          evidence.classification,
          evidence.classification,
          evidence.environment_error || evidence.classification,
          [],
          {
            evidence_file: file,
            evidence,
          },
        ),
      );
    }

    usage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printResult(resultEnvelope(RESULT.BLOCKED_ENVIRONMENT, 'COMMAND_BLOCKED', message, [message]));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
