/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — replay transport (test layer 1).
 *
 * Implements replay-transport-contract-v1.json 1.1.0, replayContractDigest
 * 240fa421e2b3a201656e331858e9b279908724273cfd5c137927ca23ea586ba5.
 *
 * Four properties carry the whole design and each one exists because its absence has a specific
 * failure mode:
 *
 *  1. The corpus is verified against the capture manifest BEFORE anything is answered. A transport
 *     that answers from unverified bytes provides no acceptance value at all.
 *  2. A key maps to an ORDERED LIST consumed in capture order, not to a single record. R-G-01 and
 *     R-G-02 are each issued twice with byte-identical argv (the BEFORE and AFTER reads of the
 *     canonical reference). A map keyed only by request identity answers both reads with the second
 *     record and silently destroys the observation-window evidence.
 *  3. Every failure is THROWN. A failure code that reached the Observer as a value would be folded
 *     into UNKNOWN, become BLOCKED, and a data-starved Observer would look correctly fail-closed.
 *  4. A deliberate capture-time non-attempt (NOT_CAPTURED_BY_PRECONDITION) is distinguished from a
 *     genuine corpus gap (NOT_IN_CORPUS). Both are hard failures, but they have different owners:
 *     the first is an Observer that ignored a stated instantiation predicate, the second is a
 *     corpus that is too small.
 *
 * `tools/replay-lookup.mts` in the Phase 0 authority is the reference implementation. It is a
 * reference, not acceptance authority; where this implementation diverges from it the divergence is
 * called out at the site, and the prose contract governs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CommandSurface,
  RequestOutsideCommandSurface,
  sha256Hex,
  framedDigestOfBytes,
  DOMAINS,
} from '@miljobeslut/mps-workspace-observer';
import type {
  FilesystemRequest,
  FilesystemResponse,
  ProcessRequest,
  ProcessResponse,
  RequestPort,
  RequestTiming,
} from '@miljobeslut/mps-workspace-observer';

/** requestMatching.separator: U+0000, written as an escape so this stays a reviewable text file. */
const SEP = '\u0000';

export class NotInCorpus extends Error {
  readonly code = 'NOT_IN_CORPUS';
  constructor(
    readonly requestId: string,
    readonly key: string,
    readonly caseId: string | null,
    readonly captureDigest: string | null,
  ) {
    super(
      `NOT_IN_CORPUS requestId=${requestId} case=${String(caseId)} captureDigest=${String(captureDigest)} key=${JSON.stringify(key)}`,
    );
    this.name = 'NotInCorpus';
  }
}

export class NotCapturedByPrecondition extends Error {
  readonly code = 'NOT_CAPTURED_BY_PRECONDITION';
  constructor(
    readonly requestId: string,
    readonly instanceKey: string,
    readonly opKey: string,
    readonly reason: string,
  ) {
    super(
      `NOT_CAPTURED_BY_PRECONDITION requestId=${requestId} instanceKey=${instanceKey} opKey=${JSON.stringify(opKey)} reason=${reason}`,
    );
    this.name = 'NotCapturedByPrecondition';
  }
}

export class CorpusAuthorityMismatch extends Error {
  readonly code = 'AUTHORITY_DIGEST_MISMATCH';
  constructor(detail: string) {
    super(`AUTHORITY_DIGEST_MISMATCH: ${detail}`);
    this.name = 'CorpusAuthorityMismatch';
  }
}

interface CoverageRow {
  readonly requestId: string;
  readonly instanceKey: string;
  readonly opKey?: string;
  readonly status: 'CAPTURED' | 'NOT_CAPTURED';
  readonly reason?: string;
}

interface CaptureRecord {
  readonly requestId: string;
  readonly instanceKey: string;
  readonly kind: 'PROCESS' | 'FS';
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly operation?: string;
  readonly opKey?: string;
  readonly path?: string;
  readonly outcome?: string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly spawnErrorCode?: string | null;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly truncation?: unknown;
  readonly result?: unknown;
}

interface CaseBundle {
  readonly caseId: string;
  readonly preferredSpelling: string;
  readonly comparisonKey: string;
  readonly candidatePathSpellings: readonly { readonly source: string; readonly path: string }[];
  readonly globalIdentityDigest: string;
  readonly records: readonly CaptureRecord[];
}

interface GlobalBundle {
  readonly schemaId: string;
  readonly bundleKind: string;
  readonly repoRoot: string;
  readonly commonDir: string;
  readonly canonicalSha: string | null;
  readonly canonicalShaSource: string;
  readonly commandSurfaceDigest: string;
  readonly canonicalizerContractDigest: string;
  readonly redactionPolicyDigest: string;
  readonly shaSet: readonly string[];
  readonly records: readonly CaptureRecord[];
}

interface CaptureMeta {
  readonly timings: Readonly<Record<string, RequestTiming>>;
  readonly observationWindow?: { readonly start: string; readonly end: string };
}

/**
 * The narrow identity of the global bundle that case bundles bind.
 *
 * Binding the whole global captureDigest made any unrelated change in the global bundle re-key
 * every frozen expectation at once, which defeats the purpose of per-case drift (A8). The
 * serialization is JSON.stringify with the sorted key list as its replacer, exactly as Phase 0
 * computed it — this is a fixed nine-field flat object, so the replacer both filters and orders,
 * and the result is stable without needing the canonical primitive.
 */
export function globalIdentityDigest(global: GlobalBundle): string {
  const identity = {
    schemaId: global.schemaId,
    bundleKind: global.bundleKind,
    repoRoot: global.repoRoot,
    commonDir: global.commonDir,
    canonicalSha: global.canonicalSha,
    canonicalShaSource: global.canonicalShaSource,
    commandSurfaceDigest: global.commandSurfaceDigest,
    canonicalizerContractDigest: global.canonicalizerContractDigest,
    redactionPolicyDigest: global.redactionPolicyDigest,
  };
  const bytes = Buffer.from(JSON.stringify(identity, Object.keys(identity).sort()), 'utf8');
  return framedDigestOfBytes(DOMAINS.CAPTURE_BUNDLE_V1, bytes);
}

export interface LoadedCorpus {
  readonly corpusDir: string;
  readonly surface: CommandSurface;
  readonly global: GlobalBundle;
  readonly globalMeta: CaptureMeta;
  readonly globalIdentity: string;
  readonly cases: ReadonlyMap<string, CaseBundle>;
  readonly caseMeta: ReadonlyMap<string, CaptureMeta>;
  readonly captureDigests: ReadonlyMap<string, string>;
  readonly sequences: ReadonlyMap<string, readonly CaptureRecord[]>;
  /** NOT_CAPTURED rows, scoped: 'GLOBAL' or the caseId. */
  readonly notCaptured: ReadonlyMap<string, readonly CoverageRow[]>;
  readonly manifestCaptureDigest: string;
  readonly caseCount: number;
}

function recordKey(scope: string, r: CaptureRecord): string {
  return r.kind === 'PROCESS'
    ? processKey(scope, r.requestId, r.cwd ?? '', (r.argv ?? []) as string[])
    : fsKey(scope, r.requestId, r.operation ?? '', r.opKey ?? '', r.path ?? '');
}

/**
 * processKey = scope + SEP + requestId + SEP + cwd + SEP + argv joined by SEP, where argv INCLUDES
 * the mandatory prefix exactly as the Observer spawns it. Byte-exact, no normalization.
 */
export function processKey(
  scope: string,
  requestId: string,
  cwd: string,
  argv: readonly string[],
): string {
  return [scope, requestId, cwd, ...argv].join(SEP);
}

/**
 * fsKey = scope + SEP + requestId + SEP + operation + SEP + opKey + SEP + path, where opKey is the
 * empty string for single-operation families. Byte-exact.
 */
export function fsKey(
  scope: string,
  requestId: string,
  operation: string,
  opKey: string,
  path: string,
): string {
  return [scope, requestId, operation, opKey, path].join(SEP);
}

/**
 * loadTimeVerification, in the contract's own order. Every check aborts before the Observer is
 * constructed, and the surface digest is checked against the manifest so the surface and the corpus
 * cannot drift apart.
 */
export function loadCorpus(options: {
  readonly corpusDir: string;
  readonly commandSurfacePath: string;
  readonly commandSurfaceDigest: string;
}): LoadedCorpus {
  const { corpusDir, commandSurfacePath, commandSurfaceDigest } = options;

  const surfaceBytes = readFileSync(commandSurfacePath);
  const surface = CommandSurface.fromBytes(surfaceBytes, commandSurfaceDigest);

  const manifestBytes = readFileSync(join(corpusDir, 'capture-manifest-v1.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    commandSurfaceDigest: string;
    caseCount: number;
    global: {
      file: string;
      metaFile: string;
      captureDigest: string;
      fileSha256: string;
      coverage: readonly CoverageRow[];
    };
    cases: readonly {
      caseId: string;
      file: string;
      metaFile: string;
      captureDigest: string;
      fileSha256: string;
      coverage: readonly CoverageRow[];
    }[];
  };

  if (manifest.commandSurfaceDigest !== sha256Hex(surfaceBytes)) {
    throw new CorpusAuthorityMismatch(
      `command surface ${sha256Hex(surfaceBytes)} does not match the corpus manifest ${manifest.commandSurfaceDigest}`,
    );
  }

  const gBytes = readFileSync(join(corpusDir, manifest.global.file));
  const gCapture = framedDigestOfBytes(DOMAINS.CAPTURE_BUNDLE_V1, gBytes);
  if (gCapture !== manifest.global.captureDigest) {
    throw new CorpusAuthorityMismatch(
      `global bundle captureDigest ${gCapture} != manifest ${manifest.global.captureDigest}`,
    );
  }
  if (sha256Hex(gBytes) !== manifest.global.fileSha256) {
    throw new CorpusAuthorityMismatch('global bundle file digest mismatch');
  }
  const global = JSON.parse(gBytes.toString('utf8')) as GlobalBundle;
  const globalMeta = JSON.parse(
    readFileSync(join(corpusDir, manifest.global.metaFile), 'utf8'),
  ) as CaptureMeta;
  const gid = globalIdentityDigest(global);

  const sequences = new Map<string, CaptureRecord[]>();
  const push = (scope: string, r: CaptureRecord): void => {
    const k = recordKey(scope, r);
    const list = sequences.get(k);
    if (list === undefined) sequences.set(k, [r]);
    else list.push(r);
  };
  for (const r of global.records) push('GLOBAL', r);

  const cases = new Map<string, CaseBundle>();
  const caseMeta = new Map<string, CaptureMeta>();
  const captureDigests = new Map<string, string>();
  captureDigests.set('GLOBAL', gCapture);

  const notCaptured = new Map<string, CoverageRow[]>();
  const addCoverage = (scope: string, rows: readonly CoverageRow[]): void => {
    const kept = rows.filter((r) => r.status === 'NOT_CAPTURED');
    if (kept.length > 0) notCaptured.set(scope, kept);
  };
  addCoverage('GLOBAL', manifest.global.coverage);

  for (const m of manifest.cases) {
    const bytes = readFileSync(join(corpusDir, m.file));
    const digest = framedDigestOfBytes(DOMAINS.CAPTURE_BUNDLE_V1, bytes);
    if (digest !== m.captureDigest) {
      throw new CorpusAuthorityMismatch(`case ${m.caseId} captureDigest ${digest} != ${m.captureDigest}`);
    }
    if (sha256Hex(bytes) !== m.fileSha256) {
      throw new CorpusAuthorityMismatch(`case ${m.caseId} file digest mismatch`);
    }
    const bundle = JSON.parse(bytes.toString('utf8')) as CaseBundle;
    if (bundle.globalIdentityDigest !== gid) {
      throw new CorpusAuthorityMismatch(
        `case ${m.caseId} is bound to global identity ${bundle.globalIdentityDigest}, this global bundle is ${gid}`,
      );
    }
    cases.set(bundle.caseId, bundle);
    captureDigests.set(bundle.caseId, digest);
    caseMeta.set(
      bundle.caseId,
      JSON.parse(readFileSync(join(corpusDir, m.metaFile), 'utf8')) as CaptureMeta,
    );
    addCoverage(bundle.caseId, m.coverage);
    for (const r of bundle.records) push(bundle.caseId, r);
  }

  if (cases.size !== manifest.caseCount) {
    throw new CorpusAuthorityMismatch(
      `manifest declares ${manifest.caseCount} cases, loaded ${cases.size}`,
    );
  }

  return {
    corpusDir,
    surface,
    global,
    globalMeta,
    globalIdentity: gid,
    cases,
    caseMeta,
    captureDigests,
    sequences,
    notCaptured,
    manifestCaptureDigest: sha256Hex(manifestBytes),
    caseCount: manifest.caseCount,
  };
}

/**
 * A replay port bound to ONE case.
 *
 * consumptionScope: sequence position is per test case and reset when the transport is constructed,
 * so cases remain independent. REPOSITORY_GLOBAL records come from the global bundle under scope
 * 'GLOBAL'; WORKSPACE_LOCAL records come from this case's bundle under scope = caseId.
 */
export class ReplayTransport implements RequestPort {
  private readonly cursor = new Map<string, number>();
  private lastTiming: RequestTiming | undefined;

  readonly repoRoot: string;

  constructor(
    private readonly corpus: LoadedCorpus,
    readonly caseId: string | null,
  ) {
    this.repoRoot = corpus.global.repoRoot;
    if (caseId !== null && !corpus.cases.has(caseId)) {
      throw new CorpusAuthorityMismatch(`no case bundle for ${caseId}`);
    }
  }

  get captureDigest(): string | null {
    return this.caseId === null ? null : (this.corpus.captureDigests.get(this.caseId) ?? null);
  }

  async executeProcess(request: ProcessRequest): Promise<ProcessResponse> {
    const family = this.corpus.surface.family(request.requestId);
    if (family.kind !== 'PROCESS') {
      throw new RequestOutsideCommandSurface(`${request.requestId} is not a process family`);
    }

    // commandSurfacePrecondition, asserted here as well as in CommandSurface.assembleArgv: the
    // Observer builds argv through the surface, but the transport must not TRUST that it did.
    const prefix = this.corpus.surface.mandatoryArgvPrefix;
    for (let i = 0; i < prefix.length; i += 1) {
      if (request.argv[i] !== prefix[i]) {
        throw new RequestOutsideCommandSurface(
          `argv lacks the mandatory prefix at token ${i} for ${request.requestId}`,
        );
      }
    }
    this.corpus.surface.assertEnvironment(request.env);
    this.corpus.surface.assertArgvAgainstTemplate(family, request.argv.slice(prefix.length));
    if (request.cwd !== this.corpus.global.repoRoot) {
      throw new RequestOutsideCommandSurface(
        `cwd must be the repository root for ${request.requestId}; got ${JSON.stringify(request.cwd)}`,
      );
    }

    const scope = this.scopeFor(family.scope, request.requestId);
    const key = processKey(scope, request.requestId, request.cwd, request.argv);
    const record = this.take(key, request.requestId, request.instanceKey, '', scope);

    this.lastTiming = this.timingFor(request.requestId, record.instanceKey, '');
    return {
      outcome: record.outcome as ProcessResponse['outcome'],
      exitCode: record.exitCode ?? null,
      signal: record.signal ?? null,
      spawnErrorCode: record.spawnErrorCode ?? null,
      stdout: record.stdout as ProcessResponse['stdout'],
      stderr: record.stderr as ProcessResponse['stderr'],
      truncation: record.truncation as ProcessResponse['truncation'],
    };
  }

  async executeFilesystem(request: FilesystemRequest): Promise<FilesystemResponse> {
    const family = this.corpus.surface.family(request.requestId);
    if (family.kind === 'PROCESS') {
      throw new RequestOutsideCommandSurface(`${request.requestId} is a process family`);
    }
    this.corpus.surface.assertFilesystemOperation(request.operation);

    const scope = this.scopeFor(family.scope, request.requestId);
    const key = fsKey(scope, request.requestId, request.operation, request.opKey, request.path);
    const record = this.take(key, request.requestId, request.instanceKey, request.opKey, scope);

    this.lastTiming = this.timingFor(request.requestId, record.instanceKey, record.opKey ?? '');
    return record.result as FilesystemResponse;
  }

  timingFor(requestId: string, instanceKey: string, opKey: string): RequestTiming | undefined {
    // The meta timings key is `${requestId} ${instanceKey} ${opKey}` with a single space between
    // the three parts and an empty opKey for single-operation families.
    const k = `${requestId} ${instanceKey} ${opKey}`;
    const fromCase =
      this.caseId !== null ? this.corpus.caseMeta.get(this.caseId)?.timings[k] : undefined;
    return fromCase ?? this.corpus.globalMeta.timings[k];
  }

  /** The global observation window, injected as the Observer's clock rather than read from one. */
  get globalObservationWindow(): { readonly start: string; readonly end: string } | undefined {
    return this.corpus.globalMeta.observationWindow;
  }

  get mostRecentTiming(): RequestTiming | undefined {
    return this.lastTiming;
  }

  private scopeFor(scope: string, requestId: string): string {
    if (scope === 'REPOSITORY_GLOBAL') return 'GLOBAL';
    if (this.caseId === null) {
      throw new RequestOutsideCommandSurface(`workspace-local request ${requestId} without a caseId`);
    }
    return this.caseId;
  }

  private take(
    key: string,
    requestId: string,
    instanceKey: string,
    opKey: string,
    scope: string,
  ): CaptureRecord {
    const list = this.corpus.sequences.get(key);
    const at = this.cursor.get(key) ?? 0;
    if (list !== undefined && at < list.length) {
      this.cursor.set(key, at + 1);
      return list[at];
    }

    // A NOT_CAPTURED row names a different owner than a corpus gap, so it is checked before
    // NOT_IN_CORPUS is raised. The rows are scoped, unlike in the reference implementation, which
    // merges global and every case's rows into one map: there, two cases' empty-expansion rows for
    // the same family collide, and a row belonging to another case can answer for this one.
    const row = this.findNotCapturedRow(scope, requestId, instanceKey, opKey);
    if (row !== undefined) {
      throw new NotCapturedByPrecondition(
        requestId,
        row.instanceKey,
        row.opKey ?? '',
        row.reason ?? 'UNSPECIFIED',
      );
    }
    throw new NotInCorpus(requestId, key, this.caseId, this.captureDigest);
  }

  /**
   * Match a NOT_CAPTURED coverage row to a request.
   *
   * The row names a concrete instance, but the instance it names is the one whose EXPANSION was
   * empty, not the instance the Observer would have requested. R-W-06's keyFormat is
   * `{caseId}:{unitFile}`; when a workspace has no unit files the row is keyed by the caseId alone.
   * So a request matches a row when the requestId and opKey are equal and the row's instanceKey is
   * either the request's instanceKey, or its parent under the keyFormat separator, or empty (the
   * family expanded to zero instances at all).
   */
  private findNotCapturedRow(
    scope: string,
    requestId: string,
    instanceKey: string,
    opKey: string,
  ): CoverageRow | undefined {
    const rows = this.corpus.notCaptured.get(scope);
    if (rows === undefined) return undefined;
    const parent = instanceKey.includes(':') ? instanceKey.slice(0, instanceKey.indexOf(':')) : null;
    return rows.find((r) => {
      if (r.requestId !== requestId) return false;
      if ((r.opKey ?? '') !== opKey) return false;
      return r.instanceKey === instanceKey || r.instanceKey === '' || r.instanceKey === parent;
    });
  }
}
