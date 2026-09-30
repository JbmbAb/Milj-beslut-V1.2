/**
 * PATTERN-PROOF-ENGINE-01 V1 -- hand-rolled validators (plan section 3, as amended by section 12).
 *
 * Every validator takes `unknown`, checks each field for its exact type (nothing is coerced),
 * enforces the frozen semantic invariants, and returns a DEEP-FROZEN copy that contains ONLY the
 * keys that are present on the input (T2: an explicit `derivation: undefined` is dropped, never
 * copied, because canonicalizeStrict forbids undefined values). Unknown top-level keys are rejected
 * (closed field sets, PPE_UNKNOWN_FIELD). Failure is always a `PatternProofError` with a stable code.
 *
 * No schema library (plan constraint 4). The JSON-Schema-subset objects in ./schemas.ts describe
 * the same shapes for the orchestrator adapter; the semantic invariants live ONLY here.
 */
import type {
  AllowedPathsCompliance,
  CandidateArtifact,
  DecisionGateArtifact,
  DecisionGateItem,
  DependencyGraphArtifact,
  DependencyGraphEdge,
  DependencyGraphNode,
  DiscoveryArtifact,
  DiscoveryFinding,
  EvidenceGround,
  InputManifest,
  PatternProofArtifactByKind,
  PatternVerificationArtifact,
  ProofPackage,
  RedPlanArtifact,
  RedProbe,
  SecretBackedAuthorityRef,
  VerificationClaim,
} from './artifacts';
import {
  ALLOWED_PATHS_RESULTS,
  DECISION_CLASSIFICATIONS,
  DEPENDENCY_RELATION_TYPES,
  EVIDENCE_GROUNDS,
  MATERIAL_EVIDENCE_GROUNDS,
  VERIFICATION_VERDICTS,
} from './artifacts';
import { PatternProofError } from './errors';
import { validateEvidenceLocator, validateEvidenceLocators, type EvidenceLocator } from './evidence';
import { isDigest, isPatternProofArtifactKind, type PatternProofArtifactKind } from './identity';
import { deepFreeze } from './internal/deep-freeze';
import { isPlainObject } from './internal/plain-object';

// The package-wide deep-freeze lives in ./internal (R1 F18); callers keep importing it from here.
export { deepFreeze } from './internal/deep-freeze';

// ---------------------------------------------------------------------------------------------
// shared primitives
// ---------------------------------------------------------------------------------------------

export const GIT_SHA_RE = /^[0-9a-f]{40}$/;

/** A bare git object id or a `<baseSha>..<candidateSha>` range: the only admissible diff identities. */
export const GIT_SHA_OR_RANGE_RE = /^[0-9a-f]{40}(?:\.\.[0-9a-f]{40})?$/;
/** Whole-token git object ids inside free text (stripped before scanning a diff identity for blobs). */
const GIT_SHA_TOKEN_RE = /\b[0-9a-f]{40}\b/g;

function requireObject(input: unknown, path: string, what: string): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', `${what} must be a plain object`, { path });
  }
  return input;
}

/** Closed field set: every key on the input must be in `allowed`. */
function rejectUnknownKeys(input: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new PatternProofError('PPE_UNKNOWN_FIELD', `unknown field "${key}"`, { path });
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be a non-empty string', { path });
  }
  return value;
}

/** Present-and-non-empty string, or undefined when the key is absent / explicitly undefined. */
function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be a string when present', { path });
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be a boolean', { path });
  }
  return value;
}

function requireArray(value: unknown, path: string, minItems: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be an array', { path });
  }
  if (value.length < minItems) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', `must contain at least ${minItems} item(s)`, {
      path,
    });
  }
  return value;
}

function requireStringArray(value: unknown, path: string, minItems: number): readonly string[] {
  const items = requireArray(value, path, minItems);
  return items.map((item, index) => requireString(item, `${path}[${index}]`));
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', `must be one of ${allowed.join(', ')}`, { path });
  }
  return value as T;
}

function requireGitSha(value: unknown, path: string): string {
  if (typeof value !== 'string' || !GIT_SHA_RE.test(value)) {
    throw new PatternProofError('PPE_CANDIDATE_SHA_INVALID', 'must be a 40-hex lowercase git object id', {
      path,
    });
  }
  return value;
}

function requireStringRecord(value: unknown, path: string): Readonly<Record<string, string>> {
  const record = requireObject(value, path, 'record');
  const out: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (typeof item !== 'string') {
      throw new PatternProofError('PPE_SCHEMA_INVALID', 'record values must be strings', {
        path: `${path}.${key}`,
      });
    }
    out[key] = item;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// allow-list matching (candidate; plan section 3 + D10)
// ---------------------------------------------------------------------------------------------

/**
 * Proof-policy surfaces that a writer allow-list may never cover (D10, extended per R1 F17 with the
 * repo surfaces that register packages, alias imports, run the acceptance commands or hold audit
 * records). A prefix ending in `-` is a file-name prefix; an entry naming a top-level file matches
 * exactly that file; every other entry is a directory prefix.
 */
export const PROOF_POLICY_PATH_PREFIXES: readonly string[] = Object.freeze([
  'packages/mps-pattern-proof',
  'governance/devgov',
  'scripts/audit',
  'scripts/devgov',
  'docs/architecture/PATTERN-PROOF-ENGINE-01-',
  'docs/architecture/audits',
  '.claude',
  '.github',
  'vitest.config.ts',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
]);

/** Representative proof-policy paths that every allow-list entry is tested against (D10 + F17). */
const PROOF_POLICY_PROBE_PATHS: readonly string[] = Object.freeze([
  'packages/mps-pattern-proof/package.json',
  'packages/mps-pattern-proof/src/index.ts',
  'governance/devgov/units/unit.json',
  'scripts/audit/master-boundary-audit.test.ts',
  'scripts/devgov/run-red.mjs',
  'docs/architecture/PATTERN-PROOF-ENGINE-01-DESIGN-V1-FROZEN.md',
  'docs/architecture/audits/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-AUDIT.md',
  '.claude/settings.json',
  '.claude/workflows/ppe-v1.js',
  '.github/workflows/deploy-gcp.yml',
  'vitest.config.ts',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
]);

function normalizePath(value: string): string {
  let out = value.trim().replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function hasGlobChars(entry: string): boolean {
  return /[*?[\]{}]/.test(entry);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
}

/** Minimal glob: `**` spans separators, `*` and `?` do not. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 3;
        } else {
          source += '.*';
          index += 2;
        }
      } else {
        source += '[^/]*';
        index += 1;
      }
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else {
      source += escapeRegExp(char);
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when `entry` (exact path, directory prefix or glob) admits `path`. */
export function allowedPathEntryMatches(entry: string, path: string): boolean {
  const normalizedEntry = normalizePath(entry);
  const normalizedPath = normalizePath(path);
  if (normalizedEntry.length === 0) return false;
  if (hasGlobChars(normalizedEntry)) return globToRegExp(normalizedEntry).test(normalizedPath);
  return normalizedPath === normalizedEntry || normalizedPath.startsWith(`${normalizedEntry}/`);
}

export function isPathAllowed(allowedPaths: readonly string[], path: string): boolean {
  return allowedPaths.some((entry) => allowedPathEntryMatches(entry, path));
}

/** D10: does this allow-list entry reach into a proof-policy surface? */
export function allowedPathCoversProofPolicy(entry: string): boolean {
  const normalized = normalizePath(entry);
  for (const prefix of PROOF_POLICY_PATH_PREFIXES) {
    if (prefix.endsWith('-')) {
      if (normalized.startsWith(prefix)) return true;
    } else if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return PROOF_POLICY_PROBE_PATHS.some((probe) => allowedPathEntryMatches(normalized, probe));
}

const LINE_SPEC_RE = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;

/**
 * Extracts the repository path a locator names, when it names one: `file_line` refs of the form
 * `path:N`, `path:N-M`, `path:N,M,...` (or a bare path), and `git_object` refs of the form
 * `<sha>:<path>`. Returns undefined for every other locator (a bare git sha names no path).
 */
export function locatorPath(locator: EvidenceLocator): string | undefined {
  const ref = locator.ref.trim();
  if (locator.kind === 'file_line') {
    const colon = ref.lastIndexOf(':');
    if (colon > 0 && LINE_SPEC_RE.test(ref.slice(colon + 1))) return normalizePath(ref.slice(0, colon));
    return normalizePath(ref);
  }
  if (locator.kind === 'git_object') {
    const colon = ref.indexOf(':');
    if (colon > 0 && colon < ref.length - 1) return normalizePath(ref.slice(colon + 1));
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// secret-material scan (InputManifest; plan section 3 + D12)
// ---------------------------------------------------------------------------------------------

const SECRET_LIKE_KEY_RE = /(secret|token|password|private|key)/i;
const PEM_HEADER_RE = /-----BEGIN [A-Z0-9 ]+-----/;
const URL_CREDENTIALS_RE = /:\/\/[^\s/:@]+:[^\s/@]+@/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const FINGERPRINT_TOKEN_RE = /sha256:[0-9a-f]{64}/g;
const KEY_ID_TOKEN_RE = /ed25519:[A-Za-z0-9._:-]{1,39}(?![A-Za-z0-9+/=_-])/g;
const HEX_BLOB_RE = /[0-9a-fA-F]{40,}/;
const BASE64_BLOB_RE = /[A-Za-z0-9+/_-]{40,}={0,2}/g;

function isKeyIdValue(value: string): boolean {
  return /^ed25519:[A-Za-z0-9._:-]{1,39}$/.test(value);
}

/**
 * Returns the reason a VALUE looks like secret material, or undefined when it is clean (D12).
 * `sha256:<64 hex>` fingerprints, `ed25519:`-prefixed key ids and WHOLE-TOKEN 40-hex git object ids
 * (R2 F9: a declared commit id is an input, not a secret) are exempt from the blob rule; a hex run
 * of 41 or more characters, or a 40-hex run embedded in a longer word, is still a blob.
 */
export function secretMaterialReason(value: string): string | undefined {
  if (PEM_HEADER_RE.test(value)) return 'PEM header';
  if (URL_CREDENTIALS_RE.test(value)) return 'URL-embedded credentials';
  if (JWT_RE.test(value)) return 'JWT-shaped token';
  const stripped = value
    .replace(FINGERPRINT_TOKEN_RE, ' ')
    .replace(KEY_ID_TOKEN_RE, ' ')
    .replace(GIT_SHA_TOKEN_RE, ' ');
  if (HEX_BLOB_RE.test(stripped)) return 'hex blob of 40+ characters';
  for (const match of stripped.match(BASE64_BLOB_RE) ?? []) {
    if (/[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match)) {
      return 'base64 blob of 40+ characters';
    }
  }
  return undefined;
}

function rejectSecretValue(value: string, path: string): void {
  const reason = secretMaterialReason(value);
  if (reason !== undefined) {
    throw new PatternProofError(
      'PPE_MANIFEST_SECRET_MATERIAL',
      `value looks like secret material (${reason})`,
      {
        path,
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// DiscoveryArtifact
// ---------------------------------------------------------------------------------------------

const DISCOVERY_KEYS = ['findings'] as const;
const FINDING_KEYS = ['category', 'description', 'evidence'] as const;

function validateFinding(input: unknown, path: string): DiscoveryFinding {
  const record = requireObject(input, path, 'DiscoveryFinding');
  rejectUnknownKeys(record, FINDING_KEYS, path);
  return {
    category: requireString(record.category, `${path}.category`),
    description: requireString(record.description, `${path}.description`),
    evidence: validateEvidenceLocators(record.evidence, `${path}.evidence`),
  };
}

export function validateDiscoveryArtifact(input: unknown): DiscoveryArtifact {
  const path = 'discovery';
  const record = requireObject(input, path, 'DiscoveryArtifact');
  rejectUnknownKeys(record, DISCOVERY_KEYS, path);
  const findings = requireArray(record.findings, `${path}.findings`, 1).map((item, index) =>
    validateFinding(item, `${path}.findings[${index}]`),
  );
  return deepFreeze({ findings });
}

// ---------------------------------------------------------------------------------------------
// DependencyGraphArtifact
// ---------------------------------------------------------------------------------------------

const GRAPH_KEYS = ['nodes', 'edges'] as const;
const NODE_KEYS = ['id', 'kind', 'evidence'] as const;
const EDGE_KEYS = ['from', 'to', 'relationType', 'evidence'] as const;

function validateNode(input: unknown, path: string): DependencyGraphNode {
  const record = requireObject(input, path, 'DependencyGraphNode');
  rejectUnknownKeys(record, NODE_KEYS, path);
  return {
    id: requireString(record.id, `${path}.id`),
    kind: requireString(record.kind, `${path}.kind`),
    evidence: validateEvidenceLocators(record.evidence, `${path}.evidence`),
  };
}

function validateEdge(input: unknown, path: string): DependencyGraphEdge {
  const record = requireObject(input, path, 'DependencyGraphEdge');
  rejectUnknownKeys(record, EDGE_KEYS, path);
  return {
    from: requireString(record.from, `${path}.from`),
    to: requireString(record.to, `${path}.to`),
    relationType: requireEnum(record.relationType, DEPENDENCY_RELATION_TYPES, `${path}.relationType`),
    evidence: validateEvidenceLocators(record.evidence, `${path}.evidence`),
  };
}

export function validateDependencyGraphArtifact(input: unknown): DependencyGraphArtifact {
  const path = 'dependency-graph';
  const record = requireObject(input, path, 'DependencyGraphArtifact');
  rejectUnknownKeys(record, GRAPH_KEYS, path);
  const nodes = requireArray(record.nodes, `${path}.nodes`, 1).map((item, index) =>
    validateNode(item, `${path}.nodes[${index}]`),
  );
  const ids = new Set<string>();
  nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      throw new PatternProofError('PPE_GRAPH_DUPLICATE_NODE', `duplicate node id "${node.id}"`, {
        path: `${path}.nodes[${index}].id`,
      });
    }
    ids.add(node.id);
  });
  const edges = requireArray(record.edges, `${path}.edges`, 0).map((item, index) =>
    validateEdge(item, `${path}.edges[${index}]`),
  );
  edges.forEach((edge, index) => {
    for (const end of ['from', 'to'] as const) {
      if (!ids.has(edge[end])) {
        throw new PatternProofError(
          'PPE_GRAPH_DANGLING_EDGE',
          `edge ${end} "${edge[end]}" does not reference a declared node`,
          { path: `${path}.edges[${index}].${end}` },
        );
      }
    }
  });
  return deepFreeze({ nodes, edges });
}

// ---------------------------------------------------------------------------------------------
// DecisionGateArtifact (D9: MECHANICAL requires derivation; others require blockingReason;
// presence of the other field is NOT rejected)
// ---------------------------------------------------------------------------------------------

const GATE_KEYS = ['items'] as const;
const GATE_ITEM_KEYS = ['item', 'classification', 'derivation', 'blockingReason'] as const;

function validateDecisionGateItem(input: unknown, path: string): DecisionGateItem {
  const record = requireObject(input, path, 'DecisionGateItem');
  rejectUnknownKeys(record, GATE_ITEM_KEYS, path);
  const item = requireString(record.item, `${path}.item`);
  const classification = requireEnum(
    record.classification,
    DECISION_CLASSIFICATIONS,
    `${path}.classification`,
  );
  const derivation = optionalString(record.derivation, `${path}.derivation`);
  const blockingReason = optionalString(record.blockingReason, `${path}.blockingReason`);
  if (classification === 'MECHANICAL') {
    if (derivation === undefined || derivation.trim().length === 0) {
      throw new PatternProofError(
        'PPE_DECISION_ITEM_INCOMPLETE',
        'MECHANICAL items require a non-empty derivation',
        { path: `${path}.derivation` },
      );
    }
  } else if (blockingReason === undefined || blockingReason.trim().length === 0) {
    throw new PatternProofError(
      'PPE_DECISION_ITEM_INCOMPLETE',
      `${classification} items require a non-empty blockingReason`,
      { path: `${path}.blockingReason` },
    );
  }
  const out: {
    item: string;
    classification: DecisionGateItem['classification'];
    derivation?: string;
    blockingReason?: string;
  } = { item, classification };
  if (derivation !== undefined) out.derivation = derivation;
  if (blockingReason !== undefined) out.blockingReason = blockingReason;
  return out;
}

export function validateDecisionGateArtifact(input: unknown): DecisionGateArtifact {
  const path = 'decision-gate';
  const record = requireObject(input, path, 'DecisionGateArtifact');
  rejectUnknownKeys(record, GATE_KEYS, path);
  const items = requireArray(record.items, `${path}.items`, 1).map((item, index) =>
    validateDecisionGateItem(item, `${path}.items[${index}]`),
  );
  return deepFreeze({ items });
}

// ---------------------------------------------------------------------------------------------
// RedPlanArtifact
// ---------------------------------------------------------------------------------------------

const RED_PLAN_KEYS = ['probes'] as const;
const PROBE_KEYS = ['id', 'assertedBehavior', 'authorityEvidence', 'command'] as const;

function validateRedProbe(input: unknown, path: string): RedProbe {
  const record = requireObject(input, path, 'RedProbe');
  rejectUnknownKeys(record, PROBE_KEYS, path);
  if (record.authorityEvidence === undefined) {
    throw new PatternProofError(
      'PPE_PROBE_AUTHORITY_REQUIRED',
      'every probe must cite its governed authority as an EvidenceLocator (frozen design section 8)',
      { path: `${path}.authorityEvidence` },
    );
  }
  return {
    id: requireString(record.id, `${path}.id`),
    assertedBehavior: requireString(record.assertedBehavior, `${path}.assertedBehavior`),
    authorityEvidence: validateEvidenceLocator(record.authorityEvidence, `${path}.authorityEvidence`),
    command: requireString(record.command, `${path}.command`),
  };
}

export function validateRedPlanArtifact(input: unknown): RedPlanArtifact {
  const path = 'red-plan';
  const record = requireObject(input, path, 'RedPlanArtifact');
  rejectUnknownKeys(record, RED_PLAN_KEYS, path);
  const probes = requireArray(record.probes, `${path}.probes`, 1).map((item, index) =>
    validateRedProbe(item, `${path}.probes[${index}]`),
  );
  const ids = new Set<string>();
  probes.forEach((probe, index) => {
    if (ids.has(probe.id)) {
      throw new PatternProofError('PPE_PROBE_ID_DUPLICATE', `duplicate probe id "${probe.id}"`, {
        path: `${path}.probes[${index}].id`,
      });
    }
    ids.add(probe.id);
  });
  return deepFreeze({ probes });
}

// ---------------------------------------------------------------------------------------------
// CandidateArtifact
// ---------------------------------------------------------------------------------------------

const CANDIDATE_KEYS = ['candidateSha', 'baseSha', 'diffRef', 'allowedPathsCompliance'] as const;
const COMPLIANCE_KEYS = ['result', 'allowedPaths', 'evidence'] as const;

/**
 * The admissible `diffRef` identities of a candidate: exactly the range `<baseSha>..<candidateSha>`.
 * BOOTSTRAP section 2: "diffRef must resolve to the exact baseSha..candidateSha diff" -- a bare
 * candidate object names a commit, not a diff (its parent is unverified), so it is not admissible
 * (R2 F6). Kept as a list so callers render "one of ..." uniformly.
 */
export function candidateDiffRefs(baseSha: string, candidateSha: string): readonly string[] {
  return Object.freeze([`${baseSha}..${candidateSha}`]);
}

/** True iff `locator` is a git_object whose (trimmed) ref is one of `candidateDiffRefs`. */
export function isCandidateDiffRef(locator: EvidenceLocator, baseSha: string, candidateSha: string): boolean {
  return (
    locator.kind === 'git_object' && candidateDiffRefs(baseSha, candidateSha).includes(locator.ref.trim())
  );
}

function validateAllowedPathsCompliance(input: unknown, path: string): AllowedPathsCompliance {
  const record = requireObject(input, path, 'AllowedPathsCompliance');
  rejectUnknownKeys(record, COMPLIANCE_KEYS, path);
  const result = requireEnum(record.result, ALLOWED_PATHS_RESULTS, `${path}.result`);
  const allowedPaths = requireStringArray(record.allowedPaths, `${path}.allowedPaths`, 0);
  allowedPaths.forEach((entry, index) => {
    if (allowedPathCoversProofPolicy(entry)) {
      throw new PatternProofError(
        'PPE_ALLOWLIST_COVERS_PROOF_POLICY',
        `allow-list entry "${entry}" reaches a proof-policy surface (${PROOF_POLICY_PATH_PREFIXES.join(', ')})`,
        { path: `${path}.allowedPaths[${index}]` },
      );
    }
  });
  const evidence = validateEvidenceLocators(record.evidence, `${path}.evidence`);
  if (result === 'PASS') {
    evidence.forEach((locator, index) => {
      const named = locatorPath(locator);
      if (named !== undefined && !isPathAllowed(allowedPaths, named)) {
        throw new PatternProofError(
          'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT',
          `result PASS but evidence names "${named}" outside allowedPaths`,
          { path: `${path}.evidence[${index}]` },
        );
      }
    });
  }
  return { result, allowedPaths, evidence };
}

export function validateCandidateArtifact(input: unknown): CandidateArtifact {
  const path = 'candidate';
  const record = requireObject(input, path, 'CandidateArtifact');
  rejectUnknownKeys(record, CANDIDATE_KEYS, path);
  const candidateSha = requireGitSha(record.candidateSha, `${path}.candidateSha`);
  const baseSha = requireGitSha(record.baseSha, `${path}.baseSha`);
  const diffRef = validateEvidenceLocator(record.diffRef, `${path}.diffRef`);
  // BOOTSTRAP section 2: diffRef must resolve to the exact baseSha..candidateSha diff (R1 F4). A
  // `git_object` naming that RANGE is the only admissible form (R2 F6: a bare candidate object is a
  // commit, not the diff); a runtime_result, a file_line or a git_object naming anything else is not
  // this candidate's diff.
  if (!isCandidateDiffRef(diffRef, baseSha, candidateSha)) {
    throw new PatternProofError(
      'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT',
      `diffRef must be a git_object naming ${baseSha}..${candidateSha}; got ${diffRef.kind} "${diffRef.ref}"`,
      { path: `${path}.diffRef` },
    );
  }
  const allowedPathsCompliance = validateAllowedPathsCompliance(
    record.allowedPathsCompliance,
    `${path}.allowedPathsCompliance`,
  );
  return deepFreeze({ candidateSha, baseSha, diffRef, allowedPathsCompliance });
}

// ---------------------------------------------------------------------------------------------
// PatternVerificationArtifact
// ---------------------------------------------------------------------------------------------

const VERIFICATION_KEYS = ['claims', 'verdict', 'reasonCode', 'isolationEvidence'] as const;
const CLAIM_KEYS = ['claim', 'evidenceGrounds', 'materialInvariant'] as const;

function validateClaim(input: unknown, path: string): VerificationClaim {
  const record = requireObject(input, path, 'VerificationClaim');
  rejectUnknownKeys(record, CLAIM_KEYS, path);
  const claim = requireString(record.claim, `${path}.claim`);
  const evidenceGrounds = requireArray(record.evidenceGrounds, `${path}.evidenceGrounds`, 1).map(
    (item, index): EvidenceGround => requireEnum(item, EVIDENCE_GROUNDS, `${path}.evidenceGrounds[${index}]`),
  );
  const materialInvariant = requireBoolean(record.materialInvariant, `${path}.materialInvariant`);
  if (materialInvariant && !evidenceGrounds.some((ground) => MATERIAL_EVIDENCE_GROUNDS.includes(ground))) {
    throw new PatternProofError(
      'PPE_MATERIAL_CLAIM_WEAK_GROUND',
      'a material invariant needs VERIFIER_OWNED_PROBE or INDEPENDENT_CODE_DERIVATION (frozen design section 5)',
      { path: `${path}.evidenceGrounds` },
    );
  }
  return { claim, evidenceGrounds, materialInvariant };
}

export function validatePatternVerificationArtifact(input: unknown): PatternVerificationArtifact {
  const path = 'pattern-verification';
  const record = requireObject(input, path, 'PatternVerificationArtifact');
  rejectUnknownKeys(record, VERIFICATION_KEYS, path);
  const claims = requireArray(record.claims, `${path}.claims`, 1).map((item, index) =>
    validateClaim(item, `${path}.claims[${index}]`),
  );
  const verdict = requireEnum(record.verdict, VERIFICATION_VERDICTS, `${path}.verdict`);
  const reasonCode = optionalString(record.reasonCode, `${path}.reasonCode`);
  const isolationEvidence = requireArray(record.isolationEvidence, `${path}.isolationEvidence`, 0).map(
    (item, index) => validateEvidenceLocator(item, `${path}.isolationEvidence[${index}]`),
  );
  if (verdict === 'NOT_PROVEN' && (reasonCode === undefined || reasonCode.trim().length === 0)) {
    throw new PatternProofError('PPE_REASON_CODE_REQUIRED', 'verdict NOT_PROVEN requires a reasonCode', {
      path: `${path}.reasonCode`,
    });
  }
  if (verdict !== 'NOT_PROVEN' && isolationEvidence.length === 0) {
    throw new PatternProofError(
      'PPE_ISOLATION_EVIDENCE_REQUIRED',
      `verdict ${verdict} requires non-empty isolationEvidence (BOOTSTRAP section 4)`,
      { path: `${path}.isolationEvidence` },
    );
  }
  const out: {
    claims: readonly VerificationClaim[];
    verdict: PatternVerificationArtifact['verdict'];
    reasonCode?: string;
    isolationEvidence: readonly EvidenceLocator[];
  } = { claims, verdict, isolationEvidence };
  if (reasonCode !== undefined) out.reasonCode = reasonCode;
  return deepFreeze(out);
}

// ---------------------------------------------------------------------------------------------
// InputManifest
// ---------------------------------------------------------------------------------------------

const MANIFEST_KEYS = [
  'baseSha',
  'candidateShaOrDiff',
  'dependencyLockHash',
  'fixtureContentHashes',
  'toolchainIdentity',
  'environmentConfig',
  'secretBackedAuthority',
] as const;
const SECRET_AUTHORITY_KEYS = ['keyId', 'providerRef'] as const;

function validateSecretBackedAuthority(input: unknown, path: string): SecretBackedAuthorityRef {
  const record = requireObject(input, path, 'secretBackedAuthority entry');
  rejectUnknownKeys(record, SECRET_AUTHORITY_KEYS, path);
  const keyId = requireString(record.keyId, `${path}.keyId`);
  const providerRef = requireString(record.providerRef, `${path}.providerRef`);
  rejectSecretValue(keyId, `${path}.keyId`);
  rejectSecretValue(providerRef, `${path}.providerRef`);
  return { keyId, providerRef };
}

export function validateInputManifest(input: unknown): InputManifest {
  const path = 'input-manifest';
  const record = requireObject(input, path, 'InputManifest');
  rejectUnknownKeys(record, MANIFEST_KEYS, path);
  const baseSha = requireString(record.baseSha, `${path}.baseSha`);
  if (!GIT_SHA_RE.test(baseSha)) {
    throw new PatternProofError('PPE_MANIFEST_INVALID', 'baseSha must be a 40-hex git object id', {
      path: `${path}.baseSha`,
    });
  }
  const candidateShaOrDiff = requireString(record.candidateShaOrDiff, `${path}.candidateShaOrDiff`);
  if (!GIT_SHA_OR_RANGE_RE.test(candidateShaOrDiff)) {
    // R1 F10: a value that is not a git identity is scanned for secret material FIRST (so a PEM or a
    // token is named as such; whole git object ids -- what this field is for -- are not blobs), then
    // rejected as malformed. A well-formed sha/range is, by its form, not secret material.
    rejectSecretValue(candidateShaOrDiff.replace(GIT_SHA_TOKEN_RE, ' '), `${path}.candidateShaOrDiff`);
    throw new PatternProofError(
      'PPE_MANIFEST_INVALID',
      'candidateShaOrDiff must be a 40-hex git object id or <baseSha>..<candidateSha>',
      { path: `${path}.candidateShaOrDiff` },
    );
  }
  const dependencyLockHash = requireString(record.dependencyLockHash, `${path}.dependencyLockHash`);
  if (!isDigest(dependencyLockHash)) {
    throw new PatternProofError('PPE_MANIFEST_INVALID', 'dependencyLockHash must be sha256:<64 hex>', {
      path: `${path}.dependencyLockHash`,
    });
  }
  const fixtureContentHashes = requireStringRecord(
    record.fixtureContentHashes,
    `${path}.fixtureContentHashes`,
  );
  for (const key of Object.keys(fixtureContentHashes)) {
    // frozen design section 7: "content hashes for every fixture" -- a hash, never free text (R1 F10)
    if (!isDigest(fixtureContentHashes[key])) {
      throw new PatternProofError('PPE_MANIFEST_INVALID', 'fixture content hashes must be sha256:<64 hex>', {
        path: `${path}.fixtureContentHashes.${key}`,
      });
    }
  }
  const toolchainIdentity = requireString(record.toolchainIdentity, `${path}.toolchainIdentity`);
  rejectSecretValue(toolchainIdentity, `${path}.toolchainIdentity`);
  const environmentConfig = requireStringRecord(record.environmentConfig, `${path}.environmentConfig`);
  for (const key of Object.keys(environmentConfig)) {
    const value = environmentConfig[key];
    const valuePath = `${path}.environmentConfig.${key}`;
    if (SECRET_LIKE_KEY_RE.test(key) && !isDigest(value) && !isKeyIdValue(value)) {
      throw new PatternProofError(
        'PPE_MANIFEST_SECRET_MATERIAL',
        `key "${key}" looks secret-bearing; only a sha256 fingerprint or an ed25519: key id is admissible`,
        { path: valuePath },
      );
    }
    rejectSecretValue(value, valuePath);
  }
  const out: {
    baseSha: string;
    candidateShaOrDiff: string;
    dependencyLockHash: string;
    fixtureContentHashes: Readonly<Record<string, string>>;
    toolchainIdentity: string;
    environmentConfig: Readonly<Record<string, string>>;
    secretBackedAuthority?: readonly SecretBackedAuthorityRef[];
  } = {
    baseSha,
    candidateShaOrDiff,
    dependencyLockHash,
    fixtureContentHashes,
    toolchainIdentity,
    environmentConfig,
  };
  if (record.secretBackedAuthority !== undefined) {
    out.secretBackedAuthority = requireArray(
      record.secretBackedAuthority,
      `${path}.secretBackedAuthority`,
      0,
    ).map((item, index) => validateSecretBackedAuthority(item, `${path}.secretBackedAuthority[${index}]`));
  }
  return deepFreeze(out);
}

// ---------------------------------------------------------------------------------------------
// ProofPackage
// ---------------------------------------------------------------------------------------------

const PROOF_PACKAGE_KEYS = [
  'candidateSha',
  'baseSha',
  'tree',
  'probeIdentities',
  'verifierAuthority',
  'provenInvariants',
  'inputManifest',
] as const;

export function validateProofPackage(input: unknown): ProofPackage {
  const path = 'proof-package';
  const record = requireObject(input, path, 'ProofPackage');
  rejectUnknownKeys(record, PROOF_PACKAGE_KEYS, path);
  const candidateSha = requireGitSha(record.candidateSha, `${path}.candidateSha`);
  const baseSha = requireGitSha(record.baseSha, `${path}.baseSha`);
  const tree = requireGitSha(record.tree, `${path}.tree`);
  const probeIdentities = requireStringArray(record.probeIdentities, `${path}.probeIdentities`, 0);
  const verifierAuthority = requireString(record.verifierAuthority, `${path}.verifierAuthority`);
  const provenInvariants = requireStringArray(record.provenInvariants, `${path}.provenInvariants`, 1);
  const inputManifest = validateInputManifest(record.inputManifest);
  return deepFreeze({
    candidateSha,
    baseSha,
    tree,
    probeIdentities,
    verifierAuthority,
    provenInvariants,
    inputManifest,
  });
}

// ---------------------------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------------------------

type ValidatorTable = {
  readonly [K in PatternProofArtifactKind]: (input: unknown) => PatternProofArtifactByKind[K];
};

export const PATTERN_PROOF_VALIDATORS: ValidatorTable = Object.freeze({
  discovery: validateDiscoveryArtifact,
  'dependency-graph': validateDependencyGraphArtifact,
  'decision-gate': validateDecisionGateArtifact,
  'red-plan': validateRedPlanArtifact,
  candidate: validateCandidateArtifact,
  'pattern-verification': validatePatternVerificationArtifact,
  'input-manifest': validateInputManifest,
  'proof-package': validateProofPackage,
});

/** Validates `input` as the artifact of `kind`; unknown kinds fail closed with PPE_SCHEMA_INVALID. */
export function validateArtifact<K extends PatternProofArtifactKind>(
  kind: K,
  input: unknown,
): PatternProofArtifactByKind[K] {
  if (!isPatternProofArtifactKind(kind)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', `unknown artifact kind "${String(kind)}"`);
  }
  const validator = PATTERN_PROOF_VALIDATORS[kind] as (input: unknown) => PatternProofArtifactByKind[K];
  return validator(input);
}
