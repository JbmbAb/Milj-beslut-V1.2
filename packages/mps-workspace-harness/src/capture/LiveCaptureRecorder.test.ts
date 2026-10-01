/**
 * The recorder's two obligations, both from spec B4 / A8.
 *
 *  1. The bundle it builds is CAPTURE_BUNDLE_V1-shaped: every required field of the frozen schema
 *     is present, no field the schema forbids is added, and absence is expressed by omission. A
 *     bundle that failed this would still hash to something, and that something would be compared
 *     against a frozen digest and reported as CORPUS_DRIFT — blaming the machine for a defect in
 *     the recorder, which is exactly the misattribution A8 forbids.
 *
 *  2. A bundle rebuilt from REPLAYED frozen records reproduces the frozen captureDigest. This is
 *     the round-trip that makes a fresh digest on the live machine comparable at all. If it does
 *     not hold, the failure is reported with the differing bytes named, never papered over: a
 *     silent divergence here would make every later drift verdict unfounded.
 *
 * The recorder is never run against a live machine here. Building it is in scope for this unit;
 * running it against a real workspace is the integration step and belongs to a later one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RequestSequencer, canonicalBytes, sha256Hex } from '@miljobeslut/mps-workspace-observer';
import type {
  FilesystemRequest,
  FilesystemResponse,
  ProcessRequest,
  ProcessResponse,
  RequestPort,
  RequestTiming,
  SequencerResult,
} from '@miljobeslut/mps-workspace-observer';

import { ReplayTransport, globalIdentityDigest, loadCorpus } from '../index.js';
import type { LoadedCorpus } from '../index.js';
import {
  CaptureBundleIncomplete,
  LiveCaptureRecorder,
  belongsToCase,
  listingFiltersFromSurface,
  operationFor,
} from './LiveCaptureRecorder.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';
const SURFACE_DIGEST = 'd1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642';
const CORPUS_DIR = join(AUTHORITY_ROOT, 'corpus');
const CONTRACTS_DIR = join(AUTHORITY_ROOT, 'contracts');
const authorityPresent = existsSync(join(CORPUS_DIR, 'capture-manifest-v1.json'));

/** The frozen bundle schema, read rather than restated: it is the authority on required fields. */
interface BundleSchema {
  readonly oneOf: readonly {
    readonly title: string;
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, unknown>>;
    readonly additionalProperties: boolean;
    readonly $defs?: unknown;
  }[];
  readonly $defs: {
    readonly processRecord: { readonly required: readonly string[]; readonly properties: Record<string, unknown> };
    readonly fsRecord: { readonly required: readonly string[]; readonly properties: Record<string, unknown> };
  };
}

function loadSchema(): BundleSchema {
  return JSON.parse(readFileSync(join(CONTRACTS_DIR, 'capture-bundle-schema-v1.json'), 'utf8')) as BundleSchema;
}

function contractDigests(): {
  commandSurfaceDigest: string;
  canonicalizerContractDigest: string;
  redactionPolicyDigest: string;
} {
  return {
    commandSurfaceDigest: sha256Hex(
      readFileSync(join(CONTRACTS_DIR, 'workspace-observer-command-surface-v1.json')),
    ),
    canonicalizerContractDigest: sha256Hex(
      readFileSync(join(CONTRACTS_DIR, 'canonicalizer-contract-v1.json')),
    ),
    redactionPolicyDigest: sha256Hex(
      readFileSync(join(CONTRACTS_DIR, 'redaction-truncation-policy-v1.json')),
    ),
  };
}

function loadFrozenCorpus(): LoadedCorpus {
  return loadCorpus({
    corpusDir: CORPUS_DIR,
    commandSurfacePath: join(CONTRACTS_DIR, 'workspace-observer-command-surface-v1.json'),
    commandSurfaceDigest: SURFACE_DIGEST,
  });
}

/** Run the Observer over one case against the frozen corpus, exactly as test layer 1 does. */
async function replayCase(corpus: LoadedCorpus, caseId: string): Promise<SequencerResult> {
  const port = new ReplayTransport(corpus, caseId);
  const sequencer = new RequestSequencer({
    surface: corpus.surface,
    port,
    repoRoot: corpus.global.repoRoot,
    observationScope: { caseIds: [caseId] },
  });
  return sequencer.run();
}

/** Structural validation against the frozen schema's required/allowed field lists. */
function schemaViolations(
  bundle: Record<string, unknown>,
  schema: BundleSchema,
  title: string,
): string[] {
  const shape = schema.oneOf.find((s) => s.title === title);
  if (shape === undefined) return [`schema has no '${title}' shape`];
  const out: string[] = [];
  for (const field of shape.required) {
    if (!(field in bundle)) out.push(`missing required ${title} field ${field}`);
  }
  if (shape.additionalProperties === false) {
    for (const key of Object.keys(bundle)) {
      if (!(key in shape.properties)) out.push(`${title} carries undeclared field ${key}`);
    }
  }

  const records = (bundle.records ?? []) as Record<string, unknown>[];
  records.forEach((record, index) => {
    const def = record.kind === 'PROCESS' ? schema.$defs.processRecord : schema.$defs.fsRecord;
    for (const field of def.required) {
      if (!(field in record)) out.push(`record[${index}] (${String(record.kind)}) missing ${field}`);
    }
    for (const key of Object.keys(record)) {
      if (!(key in def.properties)) out.push(`record[${index}] carries undeclared field ${key}`);
    }
    // Absence is encoded by omission, never by an explicit null, in anything digested.
    for (const [key, value] of Object.entries(record)) {
      const declared = def.properties[key] as { type?: unknown } | undefined;
      const nullable =
        declared !== undefined && JSON.stringify(declared).includes('null');
      if (value === null && !nullable) out.push(`record[${index}].${key} is an explicit null`);
    }
  });
  return out;
}

describe.skipIf(!authorityPresent)('LiveCaptureRecorder — bundle shape', () => {
  const corpus = authorityPresent ? loadFrozenCorpus() : (undefined as unknown as LoadedCorpus);
  const schema = authorityPresent ? loadSchema() : (undefined as unknown as BundleSchema);

  it('derives every filesystem operation from the frozen surface, including composite opKeys', () => {
    expect(operationFor(corpus.surface, 'R-F-01', '')).toBe('READDIR');
    expect(operationFor(corpus.surface, 'R-F-03', '')).toBe('READ_FILE');
    expect(operationFor(corpus.surface, 'R-F-04', 'gitdir-target')).toBe('LSTAT');
    expect(operationFor(corpus.surface, 'R-F-06', 'realpath')).toBe('REALPATH_NATIVE');
    expect(operationFor(corpus.surface, 'R-F-06', 'entryCount')).toBe('READDIR_COUNT');
    // R-F-07's operation key template is `file:{jsonFile}`; the instantiated key must still resolve.
    expect(operationFor(corpus.surface, 'R-F-07', 'file:k2-2-unit.json')).toBe('READ_FILE');
    expect(() => operationFor(corpus.surface, 'R-G-01', '')).toThrow(CaptureBundleIncomplete);
  });

  it('takes its listing filters from the surface, not from a restated copy', () => {
    const filters = listingFiltersFromSurface(corpus.surface);
    const driveRoot = filters.get('R-F-05 container:drive-root ');
    expect(driveRoot?.nameFilter).toBe('^(wt-|lu-|milj|rc8-|verify-)');
    expect(driveRoot?.nameFilterFlags).toBe('i');
    expect(driveRoot?.onlyDirectories).toBe(true);
    expect(filters.get('R-F-07  list')?.filesOnly).toBe(true);
  });

  it('never lets one case claim another case whose id is its prefix', () => {
    expect(belongsToCase('ws-c-a-0000abcd', 'ws-c-a-0000abcd')).toBe(true);
    expect(belongsToCase('ws-c-a-0000abcd:unit.json', 'ws-c-a-0000abcd')).toBe(true);
    expect(belongsToCase('ws-c-a-0000abcd-extra', 'ws-c-a-0000abcd')).toBe(false);
  });

  it('builds a global bundle that satisfies every required field of the frozen schema', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const result = await replayCase(corpus, caseId);
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const built = recorder.buildGlobalBundle(result);

    expect(schemaViolations(built.bundle as unknown as Record<string, unknown>, schema, 'global bundle')).toEqual(
      [],
    );
    expect(built.captureDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(built.bytes.length).toBeGreaterThan(0);
  }, 60000);

  it('builds a case bundle that satisfies every required field of the frozen schema', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const result = await replayCase(corpus, caseId);
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const global = recorder.buildGlobalBundle(result);
    const built = recorder.buildCaseBundle(result, caseId, recorder.identityDigestOf(global.bundle));

    expect(schemaViolations(built.bundle as unknown as Record<string, unknown>, schema, 'case bundle')).toEqual([]);
    expect(built.bundle.caseId).toMatch(/^ws-[a-z0-9-]+-[0-9a-f]{8}$/);
    expect(built.bundle.candidatePathSpellings.length).toBeGreaterThan(0);
  }, 60000);

  it('records RD3_ENVIRONMENT_VALUES as exactly the surface environment and no host value', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const result = await replayCase(corpus, caseId);
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const built = recorder.buildGlobalBundle(result);
    const processRecords = built.bundle.records.filter((r) => r.kind === 'PROCESS');

    expect(processRecords.length).toBeGreaterThan(0);
    for (const record of processRecords) {
      expect(record.env).toEqual(corpus.surface.mandatoryEnvironment);
    }
    // The frozen policy's RD3 prose names five keys; the frozen surface mandates eight and the
    // frozen corpus records eight. The surface is the operative authority here — recording five
    // would not reproduce a single frozen record — and the divergence is reported, not smoothed.
    expect(Object.keys(corpus.surface.mandatoryEnvironment).sort()).toEqual([
      'GCM_INTERACTIVE',
      'GIT_ASKPASS',
      'GIT_OPTIONAL_LOCKS',
      'GIT_SSH_COMMAND',
      'GIT_TERMINAL_PROMPT',
      'LANG',
      'LC_ALL',
      'SSH_ASKPASS',
    ]);
  }, 60000);

  it('aborts rather than invent a commonDir the schema requires', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const result = await replayCase(corpus, caseId);
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    expect(() => recorder.buildGlobalBundle({ ...result, commonDir: null })).toThrow(
      CaptureBundleIncomplete,
    );
  }, 60000);
});

describe.skipIf(!authorityPresent)('LiveCaptureRecorder — round-trip captureDigest', () => {
  const corpus = authorityPresent ? loadFrozenCorpus() : (undefined as unknown as LoadedCorpus);

  /**
   * The decisive test. A bundle built from records the transport replayed out of the frozen corpus
   * must hash to the frozen captureDigest for that case. Anything less means a fresh digest on the
   * live machine is not comparable to the frozen one, and CORPUS_DRIFT cannot be told from
   * CONTROLLER_FAILURE.
   */
  it('reproduces the frozen case captureDigest for the whole corpus, or names the exact bytes that differ', async () => {
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const caseIds = [...corpus.cases.keys()].sort();

    const first = await replayCase(corpus, caseIds[0]);
    const globalBundle = recorder.buildGlobalBundle(first);
    const identity = recorder.identityDigestOf(globalBundle.bundle);

    const mismatches: { caseId: string; detail: string }[] = [];
    let matched = 0;

    for (const caseId of caseIds) {
      const result = await replayCase(corpus, caseId);
      const built = recorder.buildCaseBundle(result, caseId, identity);
      const expected = corpus.captureDigests.get(caseId);
      if (built.captureDigest === expected) {
        matched += 1;
        continue;
      }
      const frozen = corpus.cases.get(caseId);
      const frozenBytes = Buffer.from(canonicalBytes(frozen));
      const freshBytes = Buffer.from(built.bytes);
      mismatches.push({
        caseId,
        detail: describeByteDifference(frozenBytes, freshBytes),
      });
    }

    console.log(
      `[case round-trip] cases=${caseIds.length} reproduced=${matched} mismatched=${mismatches.length}` +
        (mismatches.length === 0
          ? ''
          : `\n${mismatches.slice(0, 5).map((m) => `  ${m.caseId}: ${m.detail}`).join('\n')}`),
    );
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(matched).toBe(caseIds.length);
  }, 300000);

  it('binds each case to the same global identity the frozen bundles bind', async () => {
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const caseId = [...corpus.cases.keys()].sort()[0];
    const result = await replayCase(corpus, caseId);
    const built = recorder.buildGlobalBundle(result);

    // Two independent computations of the same narrow identity: over the bundle this recorder just
    // built, and over the frozen global bundle the transport loaded. They must agree, or every case
    // this recorder produces would be bound to a global nobody else recognises.
    expect(recorder.identityDigestOf(built.bundle)).toBe(corpus.globalIdentity);
    expect(globalIdentityDigest(built.bundle)).toBe(corpus.globalIdentity);
  }, 60000);

  it('reproduces the frozen GLOBAL captureDigest when every candidate is observable', async () => {
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const port = new MultiCaseReplayPort(corpus);
    const sequencer = new RequestSequencer({
      surface: corpus.surface,
      port,
      repoRoot: corpus.global.repoRoot,
      observationScope: 'ALL',
    });
    const built = recorder.buildGlobalBundle(await sequencer.run());
    const expected = corpus.captureDigests.get('GLOBAL');

    if (built.captureDigest !== expected) {
      console.log(
        `[global round-trip] fresh=${built.captureDigest} frozen=${String(expected)}\n  ` +
          describeByteDifference(Buffer.from(canonicalBytes(corpus.global)), Buffer.from(built.bytes)) +
          `\n  frozen records=${corpus.global.records.length} fresh records=${built.bundle.records.length}`,
      );
    }
    expect(built.bundle.records).toHaveLength(corpus.global.records.length);
    expect(built.bundle.shaSet).toEqual(corpus.global.shaSet);
    expect(built.captureDigest).toBe(expected);
  }, 300000);

  /**
   * The limitation this measures is a property of the frozen replay contract, not of the recorder.
   *
   * consumptionScope binds a ReplayTransport to ONE case, and the shaSet rule draws clause (c) from
   * the R-W-01 HEAD of every OBSERVED candidate. A single-case run therefore observes one HEAD, its
   * shaSet is short by every SHA that reaches the set through no other clause, and the eight
   * SHA-relationship families are not issued for those. The result is a global bundle that is a
   * byte-identical, order-preserving SUBSET of the frozen one — never a bundle that disagrees.
   *
   * Stating this as a measured subset rather than as a digest mismatch is the difference between a
   * known boundary and an unexplained one, and an unexplained one would be attributed to the
   * machine as CORPUS_DRIFT.
   */
  it('is a byte-identical subset of the frozen global bundle when only one case is in scope', async () => {
    const recorder = new LiveCaptureRecorder({ surface: corpus.surface, ...contractDigests() });
    const caseId = [...corpus.cases.keys()].sort()[0];
    const built = recorder.buildGlobalBundle(await replayCase(corpus, caseId));

    const frozenKeys = corpus.global.records.map(replayKeyOf);
    const freshKeys = built.bundle.records.map(replayKeyOf);
    const frozenByKey = new Map<string, unknown[]>();
    corpus.global.records.forEach((r) => {
      const k = replayKeyOf(r);
      const list = frozenByKey.get(k);
      if (list === undefined) frozenByKey.set(k, [r]);
      else list.push(r);
    });

    // Nothing the recorder produced is absent from the frozen bundle: it never invents a record.
    expect(freshKeys.filter((k) => !frozenByKey.has(k))).toEqual([]);

    // Every record the fresh bundle does carry is byte-identical to its frozen counterpart, in the
    // same order. This is the property that makes the subset harmless.
    const cursor = new Map<string, number>();
    const differing: string[] = [];
    for (const record of built.bundle.records) {
      const k = replayKeyOf(record);
      const at = cursor.get(k) ?? 0;
      cursor.set(k, at + 1);
      const frozenRecord = frozenByKey.get(k)?.[at];
      const a = Buffer.from(canonicalBytes(frozenRecord));
      const b = Buffer.from(canonicalBytes(record));
      if (!a.equals(b)) differing.push(k);
    }
    expect(differing).toEqual([]);
    expect(freshKeys).toEqual(frozenKeys.filter((k) => freshKeys.includes(k)));

    const missing = corpus.global.records.filter((r) => !freshKeys.includes(replayKeyOf(r)));
    const missingShas = [
      ...new Set(missing.map((r) => (r as { instanceKey: string }).instanceKey.replace(/^sha:/, ''))),
    ].sort();
    const missingFamilies = [
      ...new Set(missing.map((r) => (r as { requestId: string }).requestId)),
    ].sort();

    console.log(
      `[single-case global subset] frozen=${corpus.global.records.length} fresh=${built.bundle.records.length} ` +
        `absent=${missing.length} families=${JSON.stringify(missingFamilies)} shas=${JSON.stringify(missingShas)}`,
    );

    // The absence is entirely the SHA-relationship block for SHAs no single-case run can reach.
    expect(missingFamilies).toEqual([
      'R-G-11',
      'R-G-12',
      'R-G-13',
      'R-G-14',
      'R-G-15',
      'R-G-16',
      'R-G-17',
      'R-G-18',
    ]);
    expect(missing).toHaveLength(missingShas.length * missingFamilies.length);
    for (const sha of missingShas) {
      expect(corpus.global.shaSet).toContain(sha);
      expect(built.bundle.shaSet).not.toContain(sha);
    }
  }, 120000);
});

/**
 * A replay port that can answer for EVERY case at once, so the Observer can run with
 * observationScope 'ALL'.
 *
 * The frozen replay contract binds one ReplayTransport to one case (consumptionScope), and that is
 * right for test layer 1, where cases must stay independent. Reproducing the GLOBAL bundle needs
 * the opposite: the shaSet rule reads the HEAD of every observed candidate, so a run that sees one
 * candidate cannot produce the global record set at all.
 *
 * Every repository-global request goes to ONE delegate so its sequence cursors advance exactly
 * once. Routing them round-robin would hand the AFTER read of R-G-01 to a transport that had not
 * consumed the BEFORE one, and the observation-window evidence would be silently destroyed.
 */
class MultiCaseReplayPort implements RequestPort {
  readonly repoRoot: string;
  private readonly byCase = new Map<string, ReplayTransport>();
  private readonly globalDelegate: ReplayTransport;

  constructor(corpus: LoadedCorpus) {
    for (const caseId of corpus.cases.keys()) {
      this.byCase.set(caseId, new ReplayTransport(corpus, caseId));
    }
    const first = [...corpus.cases.keys()].sort()[0];
    const delegate = this.byCase.get(first);
    if (delegate === undefined) throw new Error('the corpus has no cases');
    this.globalDelegate = delegate;
    this.repoRoot = corpus.global.repoRoot;
  }

  async executeProcess(request: ProcessRequest): Promise<ProcessResponse> {
    return this.delegateFor(request.scope, request.instanceKey).executeProcess(request);
  }

  async executeFilesystem(request: FilesystemRequest): Promise<FilesystemResponse> {
    return this.delegateFor(request.scope, request.instanceKey).executeFilesystem(request);
  }

  timingFor(requestId: string, instanceKey: string, opKey: string): RequestTiming | undefined {
    return this.globalDelegate.timingFor(requestId, instanceKey, opKey);
  }

  private delegateFor(scope: string, instanceKey: string): ReplayTransport {
    if (scope === 'REPOSITORY_GLOBAL') return this.globalDelegate;
    const caseId = instanceKey.includes(':')
      ? instanceKey.slice(0, instanceKey.indexOf(':'))
      : instanceKey;
    const delegate = this.byCase.get(caseId);
    if (delegate === undefined) throw new Error(`no case transport for ${JSON.stringify(instanceKey)}`);
    return delegate;
  }
}

/** The replay key of a record, which is what identifies it across two runs. */
function replayKeyOf(record: unknown): string {
  const r = record as {
    kind: string;
    requestId: string;
    instanceKey: string;
    argv?: readonly string[];
    opKey?: string;
    path?: string;
  };
  return r.kind === 'PROCESS'
    ? `P ${r.requestId} ${r.instanceKey} ${JSON.stringify(r.argv ?? [])}`
    : `F ${r.requestId} ${r.instanceKey} ${r.opKey ?? ''} ${String(r.path)}`;
}

/**
 * The first differing byte, with context from both sides.
 *
 * A bare "digests differ" is not actionable and would tempt a reader to loosen the assertion. The
 * offset and the surrounding bytes say WHICH field diverged, which is the difference between a
 * finding and a shrug.
 */
function describeByteDifference(frozen: Buffer, fresh: Buffer): string {
  const limit = Math.min(frozen.length, fresh.length);
  let at = -1;
  for (let i = 0; i < limit; i += 1) {
    if (frozen[i] !== fresh[i]) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    return `identical for ${limit} bytes; lengths frozen=${frozen.length} fresh=${fresh.length}`;
  }
  const from = Math.max(0, at - 60);
  return (
    `lengths frozen=${frozen.length} fresh=${fresh.length}; first difference at byte ${at}\n` +
    `    frozen: ${JSON.stringify(frozen.subarray(from, at + 80).toString('utf8'))}\n` +
    `    fresh:  ${JSON.stringify(fresh.subarray(from, at + 80).toString('utf8'))}`
  );
}
