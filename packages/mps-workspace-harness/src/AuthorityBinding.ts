/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — external acceptance authority binding (spec A26 / B4).
 *
 * The point of this module is narrow and it is worth stating plainly, because a reader who
 * misunderstands it will "simplify" it away: this code does NOT make the run trustworthy. Anything
 * that executes inside the implementer's own worktree — this file included — is under the
 * implementer's control, so a local run is diagnostic and carries no acceptance authority. What
 * this module does is make substitution VISIBLE: every acceptance report prints the eight digests
 * of the bytes that were actually used, so swapping the corpus or the expectations becomes a
 * deviation recorded in the artifact rather than an invisible event.
 *
 * The authoritative run executes outside the candidate's write domain and fetches these same bytes
 * by content hash. It recomputes the same eight digests with the same rule. A mismatch is
 * AUTHORITY_DIGEST_MISMATCH and blocks approval; it is never a soft finding (A24).
 *
 * Deliberately dependency-free beyond node:crypto and node:fs: the acceptance run must be able to
 * verify the authority without this repository's toolchain.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { sha256Hex } from '@miljobeslut/mps-workspace-observer';

/**
 * The eight digests the Phase 0 authority manifest marks as required, and the file each covers.
 *
 * The spec names four. Phase 0 requires four more, and the reason is recorded here rather than
 * only in the manifest, because each of them can silently change what counts as passing: the
 * replay contract decides whether a corpus gap aborts the run, the redaction policy decides which
 * bytes are digest-covered, the bundle schema decides the record shape, and the vocabulary mapping
 * records the deviations an auditor checks. Binding them informationally would leave a
 * substitution path the acceptance report never prints.
 */
export const REQUIRED_BINDINGS = Object.freeze({
  expectationsDigest: 'expectations/expected-dispositions-v1.json',
  captureManifestDigest: 'corpus/capture-manifest-v1.json',
  commandSurfaceDigest: 'contracts/workspace-observer-command-surface-v1.json',
  canonicalizerContractDigest: 'contracts/canonicalizer-contract-v1.json',
  replayContractDigest: 'contracts/replay-transport-contract-v1.json',
  redactionPolicyDigest: 'contracts/redaction-truncation-policy-v1.json',
  captureBundleSchemaDigest: 'contracts/capture-bundle-schema-v1.json',
  vocabularyMappingDigest: 'contracts/vocabulary-mapping-v1.json',
} as const);

export type RequiredBindingName = keyof typeof REQUIRED_BINDINGS;

/**
 * Raised for every authority deviation. There is exactly one code, because A24 requires exactly
 * one authoritative representation of a material fact: an authority deviation is not also a
 * finding, a warning and a low-confidence flag.
 */
export class AuthorityDigestMismatch extends Error {
  readonly code = 'AUTHORITY_DIGEST_MISMATCH';
  readonly deviations: readonly string[];

  constructor(deviations: readonly string[]) {
    super(`AUTHORITY_DIGEST_MISMATCH: ${deviations.length} deviation(s)\n  ${deviations.join('\n  ')}`);
    this.name = 'AuthorityDigestMismatch';
    this.deviations = Object.freeze([...deviations]);
  }
}

interface BoundFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface AuthorityManifest {
  readonly schemaId: string;
  readonly version: string;
  readonly status: string;
  readonly canonicalBaseSha: string;
  readonly adjudicationVersion: string;
  readonly requiredBindings: Readonly<Record<string, string>>;
  readonly additionalBindings?: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, readonly BoundFileEntry[]>>;
}

export interface BoundAuthority {
  /** Root of the verifier-controlled mirror the bytes were read from. */
  readonly authorityRoot: string;
  /** SHA-256 of authority-corpus-manifest-v1.json itself. */
  readonly authorityManifestDigest: string;
  readonly canonicalBaseSha: string;
  readonly adjudicationVersion: string;
  /** The eight required digests, recomputed from the bytes on disk, never copied from the manifest. */
  readonly requiredBindings: Readonly<Record<RequiredBindingName, string>>;
  /** Absolute path of each required binding's file. */
  readonly requiredBindingPaths: Readonly<Record<RequiredBindingName, string>>;
  /** How many bound files were checked for digest AND byte length. */
  readonly boundFileCount: number;
  /** Present when an authority-reference file was supplied and matched. */
  readonly authorityReference?: AuthorityReference;
}

export interface AuthorityReference {
  readonly path: string;
  /** SHA-256 of the reference file itself; this is the identity a role brief cites. */
  readonly selfDigest: string;
  readonly mirrorContentDigest: string;
  readonly acceptanceRule: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Load and verify a Phase 0 authority mirror.
 *
 * Every check is fail-closed and every deviation is collected before throwing, so an operator sees
 * the whole picture rather than fixing one mismatch at a time and re-running.
 */
export function bindAuthority(options: {
  readonly authorityRoot: string;
  /**
   * Optional path to a `phase0-authority-reference-v1.sha256-<digest>.json` file. When given, its
   * own SHA-256 must equal the digest embedded in its filename, and its requiredBindings must equal
   * the ones recomputed here. That is what turns "these are the bytes I found" into "these are the
   * bytes the owner recorded outside my write domain".
   */
  readonly authorityReferencePath?: string;
}): BoundAuthority {
  const { authorityRoot, authorityReferencePath } = options;
  const deviations: string[] = [];

  const manifestPath = join(authorityRoot, 'authority-corpus-manifest-v1.json');
  let manifestBytes: Buffer;
  try {
    manifestBytes = readFileSync(manifestPath);
  } catch {
    throw new AuthorityDigestMismatch([`authority manifest unreadable at ${manifestPath}`]);
  }
  const authorityManifestDigest = sha256Hex(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as AuthorityManifest;

  if (manifest.schemaId !== 'PHASE0_AUTHORITY_CORPUS_MANIFEST_V1') {
    deviations.push(`authority manifest schemaId is ${manifest.schemaId}`);
  }
  if (manifest.status !== 'FROZEN') {
    deviations.push(`authority manifest status is ${manifest.status}, expected FROZEN`);
  }

  // Every bound file must reproduce both its digest and its byte length. The length is not
  // redundant: an encoding conversion (BOM, CRLF) is then visible as a length change as well.
  let boundFileCount = 0;
  const digestToPath = new Map<string, string>();
  for (const entries of Object.values(manifest.files ?? {})) {
    for (const entry of entries) {
      boundFileCount += 1;
      const abs = join(authorityRoot, entry.path);
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch {
        deviations.push(`bound file missing: ${entry.path}`);
        continue;
      }
      const got = sha256Hex(bytes);
      if (got !== entry.sha256) {
        deviations.push(`bound file digest mismatch: ${entry.path} expected ${entry.sha256} got ${got}`);
      }
      const size = statSync(abs).size;
      if (size !== entry.bytes) {
        deviations.push(`bound file length mismatch: ${entry.path} expected ${entry.bytes} got ${size}`);
      }
      if (!digestToPath.has(entry.sha256)) digestToPath.set(entry.sha256, entry.path);
    }
  }

  // Recompute the eight required digests from the bytes on disk. Reading them out of the manifest
  // would prove only that the manifest is self-consistent, which is not the question being asked.
  const recomputed: Record<string, string> = {};
  const resolvedPaths: Record<string, string> = {};
  for (const [name, relPath] of Object.entries(REQUIRED_BINDINGS)) {
    const abs = join(authorityRoot, relPath);
    let bytes: Buffer;
    try {
      bytes = readFileSync(abs);
    } catch {
      deviations.push(`required binding file missing: ${relPath}`);
      continue;
    }
    const got = sha256Hex(bytes);
    recomputed[name] = got;
    resolvedPaths[name] = abs;

    const declared = manifest.requiredBindings?.[name];
    if (declared === undefined) {
      deviations.push(`manifest does not declare requiredBindings.${name}`);
    } else if (declared !== got) {
      deviations.push(`${name} mismatch: manifest ${declared}, recomputed ${got} from ${relPath}`);
    }

    // The mapping from binding name to file is asserted in both directions, so a manifest that
    // bound the right digest to the wrong path would still be caught.
    const boundPath = digestToPath.get(got);
    if (boundPath !== undefined && boundPath !== relPath) {
      deviations.push(`${name} digest is bound to ${boundPath}, expected ${relPath}`);
    }
  }

  const declaredNames = Object.keys(manifest.requiredBindings ?? {});
  const expectedNames = Object.keys(REQUIRED_BINDINGS);
  for (const name of declaredNames) {
    if (!expectedNames.includes(name)) {
      deviations.push(`manifest declares unknown required binding ${name}`);
    }
  }
  if (declaredNames.length !== expectedNames.length) {
    deviations.push(
      `manifest declares ${declaredNames.length} required bindings, expected ${expectedNames.length}`,
    );
  }

  let authorityReference: AuthorityReference | undefined;
  if (authorityReferencePath !== undefined) {
    authorityReference = verifyAuthorityReference(authorityReferencePath, recomputed, deviations);
  }

  if (deviations.length > 0) throw new AuthorityDigestMismatch(deviations);

  return Object.freeze({
    authorityRoot,
    authorityManifestDigest,
    canonicalBaseSha: manifest.canonicalBaseSha,
    adjudicationVersion: manifest.adjudicationVersion,
    requiredBindings: Object.freeze(recomputed) as Readonly<Record<RequiredBindingName, string>>,
    requiredBindingPaths: Object.freeze(resolvedPaths) as Readonly<Record<RequiredBindingName, string>>,
    boundFileCount,
    authorityReference,
  });
}

const REFERENCE_NAME_RE = /^phase0-authority-reference-v1\.sha256-([0-9a-f]{64})\.json$/;

function verifyAuthorityReference(
  path: string,
  recomputed: Readonly<Record<string, string>>,
  deviations: string[],
): AuthorityReference | undefined {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    deviations.push(`authority reference unreadable at ${path}`);
    return undefined;
  }
  const selfDigest = sha256Hex(bytes);

  // The reference's identity IS its digest, and the digest is in its own filename. Checking that
  // the two agree is what lets a role brief cite one 64-hex string and have it mean something.
  const named = REFERENCE_NAME_RE.exec(basename(path));
  if (named === null) {
    deviations.push(`authority reference filename does not carry its digest: ${basename(path)}`);
  } else if (named[1] !== selfDigest) {
    deviations.push(
      `authority reference self-digest mismatch: filename claims ${named[1]}, bytes hash to ${selfDigest}`,
    );
  }

  const ref = readJson<{
    schema_version?: string;
    authority_result?: string;
    mirror_content_digest?: string;
    externally_recorded_mirror_content_digest?: string;
    acceptance_rule?: string;
    required_bindings?: Record<string, string>;
  }>(path);

  if (ref.schema_version !== 'phase0-authority-reference-v1') {
    deviations.push(`authority reference schema_version is ${String(ref.schema_version)}`);
  }
  if (ref.authority_result !== 'PASS') {
    deviations.push(`authority reference authority_result is ${String(ref.authority_result)}, expected PASS`);
  }
  // Two independent recordings of the mirror digest; if they ever disagree the mirror is not the
  // one the owner externally anchored, whatever the manifest inside it says.
  if (
    ref.mirror_content_digest === undefined ||
    ref.mirror_content_digest !== ref.externally_recorded_mirror_content_digest
  ) {
    deviations.push(
      `authority reference mirror digest disagrees with its external anchor: ${String(ref.mirror_content_digest)} vs ${String(ref.externally_recorded_mirror_content_digest)}`,
    );
  }

  for (const [name, digest] of Object.entries(ref.required_bindings ?? {})) {
    const got = recomputed[name];
    if (got === undefined) {
      deviations.push(`authority reference binds unknown digest ${name}`);
    } else if (got !== digest) {
      deviations.push(
        `authority reference ${name} = ${digest}, but the mirrored bytes hash to ${got}`,
      );
    }
  }

  return Object.freeze({
    path,
    selfDigest,
    mirrorContentDigest: ref.mirror_content_digest ?? '',
    acceptanceRule: ref.acceptance_rule ?? '',
  });
}
