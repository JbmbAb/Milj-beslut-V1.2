/**
 * PATTERN-PROOF-ENGINE-01 V1 -- authority resolution (frozen design section 8, the hard rule).
 *
 * "No RedPlanArtifact probe may assert an authority it cannot resolve to a real governed source":
 * an `EvidenceLocator` is RESOLVED only when the thing it names demonstrably exists. Every kind has
 * its own resolution mechanism; anything that cannot be checked here is UNRESOLVED with a reason
 * (never silently true). `postgis_ref` is not supported in V1 (`NOT_SUPPORTED_IN_V1`).
 *
 * Two implementations: `InMemoryAuthorityResolver` (fixtures: a known set or a predicate) and
 * `RepositoryAuthorityResolver` (a checkout on disk + optional git / CAS store / attestation lookup /
 * runtime ledger). Neither one mints authority; both only report whether a citation holds.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  attestationSubjectBinding,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { PatternProofError } from './errors';
import { locatorKey, validateEvidenceLocator, type EvidenceLocator } from './evidence';
import {
  persistedRefFromArtifactId,
  type PatternProofArtifactStore,
  type PersistedArtifactRef,
} from './persistence';

export interface AuthorityResolution {
  readonly resolved: boolean;
  /** stable, code-like reason when unresolved (e.g. 'NOT_SUPPORTED_IN_V1', 'LINE_OUT_OF_RANGE') */
  readonly reason?: string;
  /** what the locator resolved to (normalized ref, absolute path, artifact id, binding, ...) */
  readonly resolvedTo?: string;
}

export interface AuthorityLocatorResolver {
  resolve(locator: EvidenceLocator): Promise<AuthorityResolution>;
}

export interface UnresolvedAuthority {
  readonly locator: EvidenceLocator;
  readonly reason: string;
}

export interface AuthorityResolutionSummary {
  readonly allResolved: boolean;
  readonly unresolved: readonly UnresolvedAuthority[];
}

export const NOT_SUPPORTED_IN_V1 = 'NOT_SUPPORTED_IN_V1';

function resolved(resolvedTo: string): AuthorityResolution {
  return Object.freeze({ resolved: true, resolvedTo });
}

function unresolved(reason: string): AuthorityResolution {
  return Object.freeze({ resolved: false, reason });
}

/**
 * `git cat-file -e` diagnostics (exit 128, `fatal:`-prefixed) that name the OBJECT or the path inside
 * it: the repository was opened and the thing is absent. Everything else at exit 128 / `fatal:` is
 * git refusing the repository itself (`not a git repository`, `detected dubious ownership`, `cannot
 * change to '<dir>'`), which is GIT_UNAVAILABLE, never "not found" (R2 F10).
 */
const GIT_OBJECT_NAMING_FATAL_RE =
  /^fatal: (?:Not a valid object name|invalid object name|path '.*' (?:does not exist|exists on disk, but not) in)/m;

/** Maps a non-zero `git cat-file -e` exit to its unresolved reason (R2 F10). */
function gitCatFileFailure(
  status: number | null,
  stderr: string,
): 'GIT_OBJECT_NOT_FOUND' | 'GIT_UNAVAILABLE' {
  // exit 1: the only silent failure of `cat-file -e` -- the object does not exist
  if (status === 1) return 'GIT_OBJECT_NOT_FOUND';
  if (GIT_OBJECT_NAMING_FATAL_RE.test(stderr)) return 'GIT_OBJECT_NOT_FOUND';
  // exit 128, any other `fatal:`, or killed by the timeout (status null): git could not be used here
  return 'GIT_UNAVAILABLE';
}

/** Resolves every locator (sequentially, deterministic order) and lists the ones that failed. */
export async function resolveAll(
  resolver: AuthorityLocatorResolver,
  locators: readonly EvidenceLocator[],
): Promise<AuthorityResolutionSummary> {
  const unresolvedList: UnresolvedAuthority[] = [];
  for (const locator of locators) {
    const resolution = await resolver.resolve(locator);
    if (!resolution.resolved) {
      unresolvedList.push(Object.freeze({ locator, reason: resolution.reason ?? 'UNRESOLVED' }));
    }
  }
  return Object.freeze({
    allResolved: unresolvedList.length === 0,
    unresolved: Object.freeze(unresolvedList),
  });
}

// ---------------------------------------------------------------------------------------------
// InMemoryAuthorityResolver (fixtures)
// ---------------------------------------------------------------------------------------------

export type AuthorityPredicate = (locator: EvidenceLocator) => boolean;

/**
 * Resolves a locator when it is in the known set (identity = kind + trimmed ref, `note` ignored)
 * or when the predicate says so. Never resolves `postgis_ref` (V1 parity with the repository
 * resolver) unless a predicate explicitly does.
 */
export class InMemoryAuthorityResolver implements AuthorityLocatorResolver {
  private readonly known: ReadonlySet<string>;
  private readonly predicate: AuthorityPredicate | undefined;

  constructor(source: Iterable<EvidenceLocator> | AuthorityPredicate) {
    if (typeof source === 'function') {
      this.known = new Set();
      this.predicate = source;
    } else {
      this.known = new Set([...source].map((locator) => locatorKey(validateEvidenceLocator(locator))));
      this.predicate = undefined;
    }
  }

  async resolve(locator: EvidenceLocator): Promise<AuthorityResolution> {
    const valid = validateEvidenceLocator(locator);
    if (this.predicate !== undefined) {
      return this.predicate(valid) ? resolved(valid.ref) : unresolved('NOT_IN_PREDICATE');
    }
    if (valid.kind === 'postgis_ref') return unresolved(NOT_SUPPORTED_IN_V1);
    return this.known.has(locatorKey(valid)) ? resolved(valid.ref) : unresolved('NOT_IN_KNOWN_SET');
  }
}

// ---------------------------------------------------------------------------------------------
// RepositoryAuthorityResolver
// ---------------------------------------------------------------------------------------------

/**
 * Verify-only attestation lookup: attestations are found by `attestationSubjectBinding` (what a
 * `signed_attestation` locator's `ref` carries), verified with a VerificationKeyProvider, and the
 * attestation's `signer` is bound to `expectedSignerKeyId` (defaults to `verification.keyId`) --
 * `verifyArtifactAttestation` alone does not bind the signer (reuse-apis fact).
 */
export interface AttestationAuthority {
  readonly verification: VerificationKeyProvider;
  readonly expectedSignerKeyId?: string;
  readonly attestations:
    | ReadonlyMap<string, ArtifactAttestation>
    | ((binding: string) => Promise<ArtifactAttestation | undefined> | ArtifactAttestation | undefined);
}

export interface RepositoryAuthorityResolverOptions {
  /** absolute path of the checkout; `file_line` refs are resolved inside it and may not escape it */
  readonly repoRoot: string;
  /** replaces `git cat-file -e <ref>` (spawnSync, no shell) when supplied */
  readonly gitObjectExists?: (ref: string) => Promise<boolean>;
  readonly artifactStore?: PatternProofArtifactStore;
  readonly attestations?: AttestationAuthority;
  /** exact `runtime_result` refs that a runtime actually produced */
  readonly runtimeLedger?: Iterable<string>;
}

export const FILE_LINE_SPEC_RE = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const GIT_REF_RE = /^[0-9a-f]{7,64}(?::[^\s]+)?$/;
/** `<sha>..<sha>` (R1 F4): a diff identity; both objects must exist. No `:path` suffix on a range. */
const GIT_RANGE_RE = /^([0-9a-f]{7,64})\.\.([0-9a-f]{7,64})$/;

export interface ParsedFileLineRef {
  readonly path: string;
  readonly lines: readonly number[];
}

/** Parses `path:N`, `path:N-M`, `path:N,M,...` (mixed ranges allowed); undefined when malformed. */
export function parseFileLineRef(ref: string): ParsedFileLineRef | undefined {
  const trimmed = ref.trim();
  const colon = trimmed.lastIndexOf(':');
  if (colon <= 0) return undefined;
  const spec = trimmed.slice(colon + 1);
  if (!FILE_LINE_SPEC_RE.test(spec)) return undefined;
  const filePath = trimmed.slice(0, colon).replace(/\\/g, '/');
  if (filePath.length === 0) return undefined;
  const lines: number[] = [];
  for (const part of spec.split(',')) {
    const [startText, endText] = part.split('-');
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (start < 1 || end < start) return undefined;
    for (let line = start; line <= end; line += 1) lines.push(line);
  }
  return { path: filePath, lines };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const pieces = text.split('\n');
  return text.endsWith('\n') ? pieces.length - 1 : pieces.length;
}

export class RepositoryAuthorityResolver implements AuthorityLocatorResolver {
  private readonly repoRoot: string;
  private readonly gitObjectExists: ((ref: string) => Promise<boolean>) | undefined;
  private readonly artifactStore: PatternProofArtifactStore | undefined;
  private readonly attestations: AttestationAuthority | undefined;
  private readonly runtimeLedger: ReadonlySet<string> | undefined;

  constructor(options: RepositoryAuthorityResolverOptions) {
    if (typeof options.repoRoot !== 'string' || !path.isAbsolute(options.repoRoot)) {
      throw new PatternProofError('PPE_SCHEMA_INVALID', 'repoRoot must be an absolute path');
    }
    this.repoRoot = path.resolve(options.repoRoot);
    this.gitObjectExists = options.gitObjectExists;
    this.artifactStore = options.artifactStore;
    this.attestations = options.attestations;
    this.runtimeLedger =
      options.runtimeLedger === undefined
        ? undefined
        : new Set([...options.runtimeLedger].map((ref) => ref.trim()));
  }

  async resolve(locator: EvidenceLocator): Promise<AuthorityResolution> {
    const valid = validateEvidenceLocator(locator);
    switch (valid.kind) {
      case 'file_line':
        return this.resolveFileLine(valid.ref);
      case 'git_object':
        return this.resolveGitObject(valid.ref);
      case 'cas_artifact':
        return this.resolveCasArtifact(valid.ref);
      case 'signed_attestation':
        return this.resolveSignedAttestation(valid.ref);
      case 'runtime_result':
        return this.resolveRuntimeResult(valid.ref);
      case 'postgis_ref':
        return unresolved(NOT_SUPPORTED_IN_V1);
    }
  }

  private resolveFileLine(ref: string): AuthorityResolution {
    const parsed = parseFileLineRef(ref);
    if (parsed === undefined) return unresolved('FILE_LINE_REF_MALFORMED');
    if (path.isAbsolute(parsed.path) || parsed.path.split('/').includes('..')) {
      return unresolved('PATH_OUTSIDE_REPO_ROOT');
    }
    const absolute = path.resolve(this.repoRoot, parsed.path);
    if (absolute !== this.repoRoot && !absolute.startsWith(this.repoRoot + path.sep)) {
      return unresolved('PATH_OUTSIDE_REPO_ROOT');
    }
    let text: string;
    try {
      if (!statSync(absolute).isFile()) return unresolved('NOT_A_FILE');
      text = readFileSync(absolute, 'utf8');
    } catch {
      return unresolved('FILE_NOT_FOUND');
    }
    const total = countLines(text);
    const missing = parsed.lines.find((line) => line > total);
    if (missing !== undefined) return unresolved('LINE_OUT_OF_RANGE');
    return resolved(`${parsed.path}:${ref.trim().slice(ref.trim().lastIndexOf(':') + 1)}`);
  }

  /**
   * `<sha>`, `<sha>:<path>` (one object) or `<sha>..<sha>` (a range: BOTH objects must exist, each
   * checked separately through the hook or `git cat-file -e`). Any other text is malformed.
   */
  private async resolveGitObject(ref: string): Promise<AuthorityResolution> {
    const trimmed = ref.trim();
    const range = GIT_RANGE_RE.exec(trimmed);
    const objects = range !== null ? [range[1], range[2]] : [trimmed];
    if (range === null) {
      if (!GIT_REF_RE.test(trimmed)) return unresolved('GIT_OBJECT_REF_MALFORMED');
      const objectPath = trimmed.includes(':') ? trimmed.slice(trimmed.indexOf(':') + 1) : undefined;
      if (objectPath !== undefined && (objectPath.startsWith('/') || objectPath.split('/').includes('..'))) {
        return unresolved('GIT_OBJECT_REF_MALFORMED');
      }
    }
    for (const object of objects) {
      const outcome = await this.gitObjectPresent(object);
      if (outcome !== 'present') return unresolved(outcome);
    }
    return resolved(trimmed);
  }

  private async gitObjectPresent(
    object: string,
  ): Promise<'present' | 'GIT_OBJECT_NOT_FOUND' | 'GIT_UNAVAILABLE'> {
    if (this.gitObjectExists !== undefined) {
      try {
        return (await this.gitObjectExists(object)) ? 'present' : 'GIT_OBJECT_NOT_FOUND';
      } catch {
        return 'GIT_UNAVAILABLE';
      }
    }
    const result = spawnSync('git', ['-C', this.repoRoot, 'cat-file', '-e', object], {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      timeout: 10_000,
      encoding: 'utf8',
    });
    if (result.error !== undefined) return 'GIT_UNAVAILABLE';
    if (result.status === 0) return 'present';
    return gitCatFileFailure(result.status, typeof result.stderr === 'string' ? result.stderr : '');
  }

  private async resolveCasArtifact(ref: string): Promise<AuthorityResolution> {
    if (this.artifactStore === undefined) return unresolved('CAS_ARTIFACT_STORE_NOT_CONFIGURED');
    let persistedRef: PersistedArtifactRef;
    try {
      persistedRef = persistedRefFromArtifactId(ref.trim());
    } catch {
      return unresolved('CAS_ARTIFACT_REF_MALFORMED');
    }
    try {
      await this.artifactStore.loadArtifact(persistedRef);
      return resolved(persistedRef.artifactId);
    } catch (error) {
      if (error instanceof PatternProofError) {
        if (error.code === 'PPE_ARTIFACT_NOT_FOUND') return unresolved('CAS_ARTIFACT_NOT_FOUND');
        if (error.code === 'PPE_CONTENT_HASH_MISMATCH')
          return unresolved('CAS_ARTIFACT_CONTENT_HASH_MISMATCH');
        return unresolved('CAS_ARTIFACT_INVALID');
      }
      return unresolved('CAS_ARTIFACT_UNAVAILABLE');
    }
  }

  private async resolveSignedAttestation(ref: string): Promise<AuthorityResolution> {
    const authority = this.attestations;
    if (authority === undefined) return unresolved('ATTESTATION_LOOKUP_NOT_CONFIGURED');
    // The verifier lane may verify but never sign (frozen design sections 4 and 13).
    if ('sign' in authority.verification) return unresolved('VERIFICATION_PROVIDER_CAN_SIGN');
    const binding = ref.trim();
    const attestation =
      typeof authority.attestations === 'function'
        ? await authority.attestations(binding)
        : authority.attestations.get(binding);
    if (attestation === undefined) return unresolved('ATTESTATION_NOT_FOUND');
    if (attestationSubjectBinding(attestation) !== binding) return unresolved('ATTESTATION_BINDING_MISMATCH');
    const expectedSigner = authority.expectedSignerKeyId ?? authority.verification.keyId;
    if (attestation.signer !== expectedSigner) return unresolved('ATTESTATION_SIGNER_MISMATCH');
    let verified: boolean;
    try {
      verified = await verifyArtifactAttestation(attestation, authority.verification);
    } catch {
      verified = false;
    }
    return verified ? resolved(binding) : unresolved('ATTESTATION_SIGNATURE_INVALID');
  }

  private resolveRuntimeResult(ref: string): AuthorityResolution {
    if (this.runtimeLedger === undefined) return unresolved('RUNTIME_LEDGER_NOT_CONFIGURED');
    const trimmed = ref.trim();
    return this.runtimeLedger.has(trimmed) ? resolved(trimmed) : unresolved('RUNTIME_RESULT_NOT_IN_LEDGER');
  }
}
