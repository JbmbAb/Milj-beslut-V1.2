/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — live capture bundle construction (spec B4 / A8).
 *
 * This module turns an ObservationLedger into CAPTURE_BUNDLE_V1 bytes and computes the
 * captureDigest over them, so that test layer 3 can compare a FRESH digest for a case against the
 * frozen one. That comparison is what separates the two verdicts A8 names:
 *
 *   fresh digest differs, controller behaves      -> CORPUS_DRIFT      (the machine moved on)
 *   fresh digest matches, controller disagrees    -> CONTROLLER_FAILURE (the code is wrong)
 *
 * A live layer that cannot compute the fresh digest can only report "the live run disagreed with
 * the corpus" and has no way to say which of those two happened. That is the gap this fills.
 *
 * It is an OBSERVER, not a recorder of state: nothing here writes to a repository, to the corpus,
 * or to any file at all. There is deliberately no fs import. A capture that wrote to the machine it
 * was observing would invalidate the BEFORE/AFTER pair that is the corpus's own proof that
 * observation mutated nothing.
 *
 * Three things must be reproduced exactly or the digest is meaningless, and each is taken from a
 * single authority rather than restated here:
 *
 *   record ORDER      the sequencer's frozen order of execution (candidateExpansion)
 *   record SHAPE      capture-bundle-schema-v1.json, including absence-by-omission
 *   record BYTES      RedactionPolicy, applied before canonicalization
 */
import {
  DOMAINS,
  canonicalBytes,
  framedDigestOfBytes,
  nonNfcPaths,
} from '@miljobeslut/mps-workspace-observer';
import type {
  CommandSurface,
  FilesystemOperation,
  RequestFamily,
  SequencerResult,
} from '@miljobeslut/mps-workspace-observer';
import type { LedgerEntry } from '@miljobeslut/mps-workspace-observer';

import { globalIdentityDigest } from '../ReplayTransport.js';
import {
  listingFilterKey,
  redactRecord,
} from './RedactionPolicy.js';
import type {
  CaptureRecord,
  FsCaptureRecord,
  FsResultLike,
  ListingFilter,
  ProcessCaptureRecord,
} from './RedactionPolicy.js';

/** The frozen executable. The surface pins it; the ledger does not carry it back. */
const EXECUTABLE = 'git';

export interface GlobalCaptureBundle {
  readonly schemaId: 'CAPTURE_BUNDLE_V1';
  readonly bundleKind: 'GLOBAL';
  readonly commandSurfaceDigest: string;
  readonly canonicalizerContractDigest: string;
  readonly redactionPolicyDigest: string;
  readonly repoRoot: string;
  readonly commonDir: string;
  readonly canonicalSha: string | null;
  readonly canonicalShaSource: string;
  readonly shaSet: readonly string[];
  readonly records: readonly CaptureRecord[];
}

export interface CaseCaptureBundle {
  readonly schemaId: 'CAPTURE_BUNDLE_V1';
  readonly bundleKind: 'CASE';
  readonly caseId: string;
  readonly preferredSpelling: string;
  readonly comparisonKey: string;
  readonly candidatePathSpellings: readonly { readonly source: string; readonly path: string }[];
  readonly globalIdentityDigest: string;
  readonly records: readonly CaptureRecord[];
}

export interface BuiltBundle<T> {
  readonly bundle: T;
  readonly bytes: Uint8Array;
  readonly captureDigest: string;
}

/**
 * Raised when the ledger cannot be expressed as a schema-valid bundle.
 *
 * Every case is a stated abort rather than a degraded bundle. A bundle that filled a required field
 * with an invented value would still produce a digest, and that digest would be compared against a
 * frozen one and reported as drift — attributing a controller defect to the machine, which is the
 * exact misattribution A8 forbids.
 */
export class CaptureBundleIncomplete extends Error {
  readonly code = 'CAPTURE_BUNDLE_INCOMPLETE';
  constructor(detail: string) {
    super(`CAPTURE_BUNDLE_INCOMPLETE: ${detail}`);
    this.name = 'CaptureBundleIncomplete';
  }
}

/**
 * The recorded filesystem operation for a request.
 *
 * The ledger keys entries by (requestId, instanceKey, opKey) but does not carry the operation back,
 * and the operation is part of the replay key (fsKey). Deriving it from the response shape would be
 * a guess; deriving it from the frozen surface is the same source the capture used.
 */
export function operationFor(
  surface: CommandSurface,
  requestId: string,
  opKey: string,
): FilesystemOperation {
  const family: RequestFamily = surface.family(requestId);
  switch (family.kind) {
    case 'FS_LSTAT':
      return 'LSTAT';
    case 'FS_READDIR':
      return 'READDIR';
    case 'FS_READ_FILE':
      return 'READ_FILE';
    case 'FS_COMPOSITE': {
      const op = (family.operations ?? []).find((o) => matchesOpKey(o.key, opKey));
      if (op === undefined) {
        throw new CaptureBundleIncomplete(
          `${requestId} has no composite operation for opKey ${JSON.stringify(opKey)}`,
        );
      }
      return op.op;
    }
    default:
      throw new CaptureBundleIncomplete(`${requestId} is not a filesystem family`);
  }
}

/**
 * A composite operation key template may carry a placeholder, e.g. R-F-07's `file:{jsonFile}`, so
 * an instantiated opKey matches on the literal prefix before the placeholder rather than on
 * equality. Matching on equality would leave every instantiated read of that family unresolvable.
 */
function matchesOpKey(template: string, opKey: string): boolean {
  const brace = template.indexOf('{');
  return brace < 0 ? template === opKey : opKey.startsWith(template.slice(0, brace));
}

/**
 * Listing filters derived from the frozen surface, for RD4 and for R-F-07's filesOnly listing.
 *
 * The surface is the single authority for which names are recordable; restating the drive-root
 * name filter here would create a second place for it to drift from the bytes the corpus was made
 * with, and drift there is invisible until a digest disagrees for reasons nobody can attribute.
 */
export function listingFiltersFromSurface(surface: CommandSurface): ReadonlyMap<string, ListingFilter> {
  const filters = new Map<string, ListingFilter>();

  for (const container of surface.family('R-F-05').instances.containers ?? []) {
    filters.set(listingFilterKey('R-F-05', `container:${container.key}`, ''), {
      nameFilter: container.nameFilter,
      nameFilterFlags: container.nameFilterFlags,
      onlyDirectories: container.onlyDirectories,
      // R-F-05's resultInterpretation records `[{name,type}]`; it is the one listing family that
      // does not declare withSize, and recording sizes there would add bytes the corpus lacks.
      dropEntryMetadata: true,
    });
  }
  for (const op of surface.family('R-F-07').operations ?? []) {
    if (op.filesOnly === true) {
      filters.set(listingFilterKey('R-F-07', '', op.key), { nameFilter: null, filesOnly: true });
    }
  }

  return filters;
}

export interface RecorderOptions {
  readonly surface: CommandSurface;
  /** The three contract digests the global bundle binds, recomputed by the caller from the bytes. */
  readonly commandSurfaceDigest: string;
  readonly canonicalizerContractDigest: string;
  readonly redactionPolicyDigest: string;
}

export class LiveCaptureRecorder {
  private readonly surface: CommandSurface;
  private readonly digests: Omit<RecorderOptions, 'surface'>;

  constructor(options: RecorderOptions) {
    this.surface = options.surface;
    this.digests = {
      commandSurfaceDigest: options.commandSurfaceDigest,
      canonicalizerContractDigest: options.canonicalizerContractDigest,
      redactionPolicyDigest: options.redactionPolicyDigest,
    };
  }

  /**
   * The REPOSITORY_GLOBAL bundle: every issued repository-global request, in ledger order.
   *
   * NOT_ATTEMPTED entries are excluded, and that is not an omission of the A3 kind: a non-attempt
   * is recorded by the capture manifest's coverage rows, which is where the replay transport looks
   * for it and what lets it raise NOT_CAPTURED_BY_PRECONDITION instead of NOT_IN_CORPUS. Putting a
   * non-attempt in `records` would give it a replay key and let it answer a real request.
   */
  buildGlobalBundle(result: SequencerResult): BuiltBundle<GlobalCaptureBundle> {
    if (result.commonDir === null) {
      throw new CaptureBundleIncomplete(
        'commonDir is null; the frozen bundle schema requires a string and no metadata family could be addressed',
      );
    }
    const filters = listingFiltersFromSurface(this.surface);
    const records = result.ledger
      .all()
      .filter((e) => e.state !== 'NOT_ATTEMPTED' && this.scopeOf(e) === 'REPOSITORY_GLOBAL')
      .map((e) => this.recordFor(e, result.repoRoot, filters));

    const bundle: GlobalCaptureBundle = {
      schemaId: 'CAPTURE_BUNDLE_V1',
      bundleKind: 'GLOBAL',
      commandSurfaceDigest: this.digests.commandSurfaceDigest,
      canonicalizerContractDigest: this.digests.canonicalizerContractDigest,
      redactionPolicyDigest: this.digests.redactionPolicyDigest,
      repoRoot: result.repoRoot,
      commonDir: result.commonDir,
      canonicalSha: result.canonicalSha,
      canonicalShaSource: result.canonicalShaSource,
      shaSet: [...result.shaSet],
      records,
    };
    return this.seal(bundle);
  }

  /**
   * The bundle for ONE caseId. Cases are separate bundles because A8's drift is per case: a change
   * in one workspace must re-key that workspace's expectation and no other.
   */
  buildCaseBundle(
    result: SequencerResult,
    caseId: string,
    globalIdentity: string,
  ): BuiltBundle<CaseCaptureBundle> {
    const candidate = result.candidates.find((c) => c.caseId === caseId);
    if (candidate === undefined) {
      throw new CaptureBundleIncomplete(`the ledger has no candidate ${caseId}`);
    }
    const filters = listingFiltersFromSurface(this.surface);
    const records = result.ledger
      .all()
      .filter(
        (e) =>
          e.state !== 'NOT_ATTEMPTED' &&
          this.scopeOf(e) === 'WORKSPACE_LOCAL' &&
          belongsToCase(e.instanceKey, caseId),
      )
      .map((e) => this.recordFor(e, result.repoRoot, filters));

    const bundle: CaseCaptureBundle = {
      schemaId: 'CAPTURE_BUNDLE_V1',
      bundleKind: 'CASE',
      caseId,
      preferredSpelling: candidate.preferredSpelling,
      comparisonKey: candidate.comparisonKey,
      candidatePathSpellings: candidate.spellings.map((s) => ({ source: s.source, path: s.path })),
      globalIdentityDigest: globalIdentity,
      records,
    };
    return this.seal(bundle);
  }

  /** The narrow global identity a case bundle binds, from a global bundle this recorder built. */
  identityDigestOf(global: GlobalCaptureBundle): string {
    return globalIdentityDigest(global);
  }

  private seal<T>(bundle: T): BuiltBundle<T> {
    const bytes = canonicalBytes(bundle);
    return { bundle, bytes, captureDigest: framedDigestOfBytes(DOMAINS.CAPTURE_BUNDLE_V1, bytes) };
  }

  private scopeOf(entry: LedgerEntry): string {
    return this.surface.family(entry.requestId).scope;
  }

  /**
   * One ledger entry as a redacted capture record.
   *
   * nonNfcFields is computed over the record AFTER redaction, because the question P7 asks is
   * whether the DIGEST-COVERED bytes are NFC-stable; a pre-redaction string that no longer appears
   * in the bundle cannot make a replay of it miss.
   */
  private recordFor(
    entry: LedgerEntry,
    repoRoot: string,
    filters: ReadonlyMap<string, ListingFilter>,
  ): CaptureRecord {
    const raw = entry.process !== undefined ? this.processRecord(entry, repoRoot) : this.fsRecord(entry);
    const redacted = redactRecord(raw, { listingFilters: filters });
    const { nonNfcFields: _ignored, ...body } = redacted as CaptureRecord & {
      nonNfcFields: readonly string[];
    };
    const nonNfc = nonNfcPaths(body).map((p) => p.replace(/^\$\./, ''));
    return { ...redacted, nonNfcFields: nonNfc } as CaptureRecord;
  }

  private processRecord(entry: LedgerEntry, repoRoot: string): ProcessCaptureRecord {
    const response = entry.process;
    if (response === undefined || entry.argv === undefined) {
      throw new CaptureBundleIncomplete(`${entry.requestId} ${entry.instanceKey} has no process response`);
    }
    return {
      requestId: entry.requestId,
      instanceKey: entry.instanceKey,
      kind: 'PROCESS',
      executable: EXECUTABLE,
      argv: [...entry.argv],
      // cwd is a replay-key field and the transport rejects any cwd but the repository root, so it
      // is taken from the run rather than from the entry, which does not carry it.
      cwd: repoRoot,
      env: { ...this.surface.mandatoryEnvironment },
      outcome: response.outcome,
      exitCode: response.exitCode,
      signal: response.signal,
      spawnErrorCode: response.spawnErrorCode,
      stdout: response.stdout,
      stderr: response.stderr,
      redactions: [],
      nonNfcFields: [],
      ...(response.truncation === undefined
        ? {}
        : { truncation: response.truncation }),
    };
  }

  private fsRecord(entry: LedgerEntry): FsCaptureRecord {
    const response = entry.filesystem;
    if (response === undefined || entry.path === undefined) {
      throw new CaptureBundleIncomplete(
        `${entry.requestId} ${entry.instanceKey} has no filesystem response`,
      );
    }
    return {
      requestId: entry.requestId,
      instanceKey: entry.instanceKey,
      kind: 'FS',
      operation: operationFor(this.surface, entry.requestId, entry.opKey),
      ...(entry.opKey === '' ? {} : { opKey: entry.opKey }),
      path: entry.path,
      result: response as FsResultLike,
      redactions: [],
      nonNfcFields: [],
    };
  }
}

/**
 * Whether a WORKSPACE_LOCAL instanceKey belongs to a case.
 *
 * R-W-06's keyFormat is `{caseId}:{unitFile}` while every other workspace-local family keys by the
 * caseId alone, so the test is equality OR the caseId followed by the keyFormat separator. A plain
 * startsWith would let case `ws-c-a-0000abcd` claim records of `ws-c-a-0000abcd-extra`.
 */
export function belongsToCase(instanceKey: string, caseId: string): boolean {
  return instanceKey === caseId || instanceKey.startsWith(`${caseId}:`);
}
