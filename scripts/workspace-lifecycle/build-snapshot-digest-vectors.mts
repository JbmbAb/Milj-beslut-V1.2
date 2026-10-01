/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — generator for the two digest artifacts (spec B6, Del D 10).
 *
 * Why this is a generator and not two hand-written JSON files:
 *
 *  - The inclusion table is published FROM DIGEST_INCLUSION_TABLE in SnapshotDigest.ts. A
 *    hand-copied table drifts from the code the first time a row is edited on one side only, and
 *    the drift is invisible because both halves still look plausible. SnapshotDigest.test.ts
 *    asserts the published table deep-equals the code's, so a run of this script is the only way
 *    to change the artifact.
 *  - Every expectedDigest is produced by calling the real framedDigest/digestPayload. A
 *    hand-written expected value proves that someone could compute SHA-256 by hand, not that this
 *    implementation agrees with the frozen primitive.
 *  - primitivePin.sourceSha256 is copied out of the Phase 0-frozen canonicalizer contract in the
 *    read-only authority mirror, never re-derived from the repository files. Re-deriving it would
 *    make the pin agree with whatever the working tree happens to contain, which is the exact
 *    check the pin exists to perform.
 *
 * Run:  npx tsx scripts/workspace-lifecycle/build-snapshot-digest-vectors.mts
 *       (WLC_AUTHORITY_ROOT overrides the authority mirror location)
 *
 * The script is read-only outside packages/mps-workspace-observer/contracts. It never writes to
 * the authority mirror.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DOMAINS,
  canonicalBytes,
  framePreimage,
  framedDigest,
  sha256Hex,
} from '../../packages/mps-workspace-observer/src/digest/CanonicalDigest.js';
import {
  caseIdFromComparisonKey,
  comparisonKey,
} from '../../packages/mps-workspace-observer/src/surface/PathPolicy.js';
import { DIGEST_INCLUSION_TABLE } from '../../packages/mps-workspace-observer/src/snapshot/SnapshotDigest.js';
import { digestPayload } from '../../packages/mps-workspace-observer/src/snapshot/SnapshotDigest.js';
import { SNAPSHOT_SCHEMA_ID } from '../../packages/mps-workspace-observer/src/snapshot/types.js';
import type {
  RepositoryObservation,
  WorkspaceObservation,
} from '../../packages/mps-workspace-observer/src/snapshot/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CONTRACTS_DIR = join(REPO_ROOT, 'packages', 'mps-workspace-observer', 'contracts');

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';
const CANONICALIZER_CONTRACT_PATH = join(AUTHORITY_ROOT, 'contracts', 'canonicalizer-contract-v1.json');

/* ------------------------------------------------------------------------------------------- */
/* Serialization                                                                                 */
/* ------------------------------------------------------------------------------------------- */

/**
 * JSON.stringify cannot be used for the vectors file: it emits `0` for negative zero, which would
 * silently delete vector SD07 — the whole point of that vector is that the FILE literally carries
 * `-0` so a re-implementation reading it with a standard JSON parser receives negative zero and
 * has to reproduce the collapse. Everything else follows JSON.stringify exactly, including leaving
 * U+2028/U+2029 raw (contract R6), which vector SD08 depends on.
 */
function writeJson(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${padInner}${writeJson(v, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '{}';
  const items = entries.map(
    ([k, v]) => `${padInner}${JSON.stringify(k)}: ${writeJson(v, indent + 1)}`,
  );
  return `{\n${items.join(',\n')}\n${pad}}`;
}

/**
 * selfDigestEncoding of the Phase 0 contracts, adopted verbatim: UTF-8, no BOM, LF, exactly one
 * trailing LF. Digests are taken over these bytes, so a re-indentation or a CRLF conversion is a
 * digest change and the artifact stops verifying — which is the intended behaviour.
 */
function writeArtifact(path: string, value: unknown): string {
  const text = `${writeJson(value).replace(/\r\n/g, '\n')}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(text, 'utf8'));
  return sha256Hex(Buffer.from(text, 'utf8'));
}

/* ------------------------------------------------------------------------------------------- */
/* Fixture                                                                                       */
/* ------------------------------------------------------------------------------------------- */

/**
 * A deterministic two-workspace snapshot, local to this script.
 *
 * It is NOT exported and NOT shared with the test suite: the vectors carry the projected payload,
 * so the tests reproduce a digest from the published bytes rather than from a fixture they would
 * have to keep in sync with this file. A shared fixture would let a change here and a change there
 * cancel out and leave the vectors green while the published payload no longer matched anything.
 */
const OBSERVED_PATH = 'C:\\wt-alpha';
const UNKNOWN_PATH = 'C:\\wt-beta';

function repository(): RepositoryObservation {
  return {
    repoRoot: 'C:\\miljobeslut',
    commonDir: { state: 'OBSERVED', value: 'C:/miljobeslut/.git' },
    canonicalRef: 'refs/remotes/origin/main',
    canonicalSha: { state: 'OBSERVED', value: '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85' },
    canonicalShaSource: 'R-G-02[BEFORE]',
    canonicalShaStableAcrossWindow: { state: 'OBSERVED', value: true },
    canonicalRefUpdatedAtEpochSeconds: { state: 'OBSERVED', value: 1757462400 },
    stashes: {
      state: 'OBSERVED',
      value: [
        {
          stashCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          firstParent: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          selector: 'stash@{0}',
          attribution: 'UNKNOWN',
        },
      ],
    },
    mainWorktreeEntryNames: { state: 'OBSERVED', value: ['HEAD', 'config', 'index', 'worktrees'] },
    mainWorktreeLockFiles: { state: 'OBSERVED', value: [] },
    mainWorktreeInProgressMarkers: { state: 'OBSERVED', value: [] },
    mutationEvidence: { state: 'OBSERVED', value: { comparedPairs: 3, differingPairs: [] } },
    configuration: {
      'core.ignorecase': { state: 'OBSERVED', value: ['true'] },
      'core.symlinks': { state: 'OBSERVED', value: ['false'] },
    },
    canonicalUnitFiles: {
      state: 'OBSERVED',
      value: ['governance/devgov/units/workspace-lifecycle-controller-v1.json'],
    },
  };
}

function observedWorkspace(): WorkspaceObservation {
  const key = comparisonKey(OBSERVED_PATH);
  return {
    caseId: caseIdFromComparisonKey(key),
    comparisonKey: key,
    preferredSpelling: OBSERVED_PATH,
    spellings: [{ source: 'S1', path: OBSERVED_PATH }],
    observationState: 'OBSERVED',
    gitWorktreeList: {
      listed: true,
      path: 'C:/wt-alpha',
      head: 'cccccccccccccccccccccccccccccccccccccccc',
      branch: 'refs/heads/feat/alpha',
      detached: false,
      locked: false,
      prunable: false,
      bare: false,
    },
    gitMetadata: {
      registered: true,
      worktreeId: 'wt-alpha',
      gitdirPointer: 'C:/wt-alpha/.git',
      gitdirTargetPresent: true,
      registeredHead: 'cccccccccccccccccccccccccccccccccccccccc',
      lockedMarker: false,
      metadataEntryNames: ['HEAD', 'ORIG_HEAD', 'commondir', 'gitdir', 'index'],
      lockFiles: [],
      inProgressMarkers: [],
      hasWorktreeConfig: false,
    },
    filesystem: {
      pathPresent: { state: 'OBSERVED', value: true },
      entryType: 'dir',
      realpath: 'C:\\wt-alpha',
      entryCount: 412,
      dotGitType: 'file',
      dotGitAbsent: false,
      dotGitPointer: 'C:/miljobeslut/.git/worktrees/wt-alpha',
    },
    branchBinding: {
      bound: true,
      refname: 'refs/heads/feat/alpha',
      objectname: 'cccccccccccccccccccccccccccccccccccccccc',
      upstream: 'refs/remotes/origin/feat/alpha',
      upstreamTrack: '[ahead 2]',
    },
    toplevel: { state: 'OBSERVED', value: 'C:/wt-alpha' },
    toplevelMatchesCandidate: { state: 'OBSERVED', value: true },
    workspaceGitDir: { state: 'OBSERVED', value: 'C:/repo/.git/worktrees/wt-a' },
    workspaceGitCommonDir: { state: 'OBSERVED', value: 'C:/repo/.git' },
    insideWorkTree: { state: 'OBSERVED', value: true },
    workspaceGitExitCode: 0,
    repositoryMembership: { state: 'OBSERVED', value: 'MEMBER' },
    workspaceGitUnavailable: false,
    symbolicRef: { state: 'OBSERVED', value: 'refs/heads/feat/alpha' },
    status: {
      state: 'OBSERVED',
      value: {
        trackedModificationCount: 3,
        untrackedEntryCount: 1,
        unmergedCount: 0,
        branchHead: 'feat/alpha',
        branchOid: 'cccccccccccccccccccccccccccccccccccccccc',
        branchUpstream: 'origin/feat/alpha',
        aheadOfUpstream: 2,
        behindUpstream: 0,
        pathsElided: false,
      },
    },
    ancestry: {
      state: 'OBSERVED',
      value: {
        headSha: 'cccccccccccccccccccccccccccccccccccccccc',
        headCommitExists: true,
        headIsAncestorOfCanonical: false,
        canonicalIsAncestorOfHead: true,
        mergeBase: '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85',
        commitsAheadOfCanonical: 2,
        commitsBehindCanonical: 0,
        allUniqueCommitsPatchEquivalent: false,
        uniqueCommitCount: 2,
      },
    },
    declaredUnitFiles: ['governance/devgov/units/workspace-lifecycle-controller-v1.json'],
    contentEvidence: 'NONE',
    graphRelation: 'DESCENDANT',
    proofs: [
      {
        predicate: 'headCommitExists',
        provenBy: 'git cat-file -e',
        requestId: 'R-W-07',
        exitCode: 0,
      },
    ],
  };
}

/** The A12 vector class "a workspace whose observation state is UNKNOWN". */
function unknownWorkspace(
  overrides: {
    readonly statusUnknownReason?: 'TIMEOUT' | 'SPAWN_ERROR';
    readonly notAttempted?: boolean;
  } = {},
): WorkspaceObservation {
  const key = comparisonKey(UNKNOWN_PATH);
  const notAttempted = overrides.notAttempted === true;
  return {
    caseId: caseIdFromComparisonKey(key),
    comparisonKey: key,
    preferredSpelling: UNKNOWN_PATH,
    spellings: [
      { source: 'S1', path: UNKNOWN_PATH },
      { source: 'S3', path: 'C:/wt-beta' },
    ],
    observationState: notAttempted ? 'NOT_ATTEMPTED' : 'UNKNOWN',
    notAttemptedReason: notAttempted ? 'OUT_OF_OBSERVATION_SCOPE' : undefined,
    gitWorktreeList: { listed: false },
    gitMetadata: { registered: false },
    filesystem: {
      pathPresent: { state: 'UNKNOWN', unknownReason: 'FILESYSTEM_ERROR_INCONCLUSIVE' },
      errorCode: 'EBUSY',
    },
    branchBinding: { bound: false },
    toplevel: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    toplevelMatchesCandidate: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    workspaceGitDir: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    workspaceGitCommonDir: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    insideWorkTree: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    repositoryMembership: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    workspaceGitUnavailable: true,
    symbolicRef: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    status: { state: 'UNKNOWN', unknownReason: overrides.statusUnknownReason ?? 'TIMEOUT' },
    ancestry: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    declaredUnitFiles: [],
    contentEvidence: 'NONE',
    graphRelation: 'UNKNOWN',
    proofs: [],
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Vectors                                                                                       */
/* ------------------------------------------------------------------------------------------- */

interface VectorInput {
  readonly id: string;
  readonly description: string;
  readonly class: 'conformance' | 'informative';
  readonly schemaId: string;
  readonly payload: unknown;
  readonly payloadNote?: string;
}

/** The Windows path carrying a and o with diaeresis and ring, per A12's `å/ö` requirement. */
const UMLAUT_PATH = 'C:\\milj\u00f6beslut\\wt-\u00f6verv\u00e4g-\u00e5';
const UMLAUT_PATH_UPPER = 'c:\\MILJ\u00d6BESLUT\\WT-\u00d6VERV\u00c4G-\u00c5';

const BASELINE = { repoRoot: 'C:\\wt-alpha' };

function vectorInputs(): readonly VectorInput[] {
  return [
    {
      id: 'SD01',
      class: 'conformance',
      description:
        'baseline: canonicalSha absent. Absence is encoded by OMISSION, so this is also the "list omitted" half of SD03 and the "absent field" half of SD02.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: BASELINE,
    },
    {
      id: 'SD02',
      class: 'conformance',
      description:
        'explicit null differs from absence (contract R4). No conforming projection emits this shape; the vector exists so an implementation that writes null for "not observed" fails visibly instead of producing a plausible wrong digest.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: { repoRoot: 'C:\\wt-alpha', canonicalSha: null },
    },
    {
      id: 'SD03',
      class: 'conformance',
      description:
        'an empty list is emitted as [] and differs from the omitted list of SD01. A worktree metadata directory that was read and found empty is not the same fact as one that was never read.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: { repoRoot: 'C:\\wt-alpha', mainWorktreeEntryNames: [] },
    },
    {
      id: 'SD04',
      class: 'conformance',
      description:
        'a with ring and o with diaeresis in a Windows path, NFC input. caseId and comparisonKey are computed by the frozen PathPolicy rules from this spelling.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: {
        caseId: caseIdFromComparisonKey(comparisonKey(UMLAUT_PATH)),
        comparisonKey: comparisonKey(UMLAUT_PATH),
        repoRoot: UMLAUT_PATH,
      },
    },
    {
      id: 'SD05',
      class: 'conformance',
      description:
        'the same directory spelled in a different case. The canonicaliser does no case folding, so repoRoot differs and the digest differs from SD04 — while caseId and comparisonKey are byte-identical to SD04, because the frozen comparison rule lowercases. That pair is the whole reason identity is keyed on comparisonKey and not on the observed spelling.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: {
        caseId: caseIdFromComparisonKey(comparisonKey(UMLAUT_PATH_UPPER)),
        comparisonKey: comparisonKey(UMLAUT_PATH_UPPER),
        repoRoot: UMLAUT_PATH_UPPER,
      },
    },
    {
      id: 'SD06',
      class: 'conformance',
      description:
        'integers at the safe-integer boundary, plus and minus (2^53 - 1), beside a realistic epoch-second reflog timestamp. Anything outside this range is rejected by payload restriction P2 rather than silently rounded.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: {
        canonicalRefUpdatedAtEpochSeconds: 1757462400,
        commitsAheadOfCanonical: 9007199254740991,
        commitsBehindCanonical: -9007199254740991,
      },
    },
    {
      id: 'SD07',
      class: 'conformance',
      description:
        'negative zero collapses to 0 (contract R7). The collapse survives the payload restrictions, so a producer must never encode meaning in the sign of a zero count.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: { aheadOfUpstream: -0 },
      payloadNote:
        'the JSON text is {"aheadOfUpstream":-0}; an implementation that preserves the sign of zero produces different bytes and fails this vector',
    },
    {
      id: 'SD08',
      class: 'conformance',
      description:
        'U+2028 and U+2029 are emitted RAW as UTF-8 (contract R6). The output is valid JSON and is not valid ECMAScript source; a producer that escapes them for JavaScript safety produces different bytes.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: { lockedReason: 'held\u2028by\u2029agent' },
    },
    {
      id: 'SD09',
      class: 'conformance',
      description:
        'domain separation: the SD01 payload under CAPTURE_BUNDLE_V1 yields a different digest. A Phase 0 captureDigest can therefore never collide with a V1 identityDigest.',
      schemaId: DOMAINS.CAPTURE_BUNDLE_V1,
      payload: BASELINE,
    },
    {
      id: 'SD10',
      class: 'conformance',
      description:
        'prefix safety: the SD01 payload under the longer schemaId SNAPSHOT_V11 differs from SD01, because both components of the preimage are length-prefixed. SNAPSHOT_V11 is NOT an admissible domain; it appears only to demonstrate this property.',
      schemaId: 'SNAPSHOT_V11',
      payload: BASELINE,
    },
    {
      id: 'SD11',
      class: 'conformance',
      description:
        'a full snapshot projection with one OBSERVED and one UNKNOWN workspace, produced by digestPayload(). Every excluded field of the artifact (graphRelation, preferredSpelling, spellings, entryCount, contentEvidence, declaredUnitFiles, proofs, metadata) is absent from this payload; what remains is the whole digest-eligible surface.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: digestPayload({
        repository: repository(),
        workspaces: [observedWorkspace(), unknownWorkspace()],
      }),
    },
    {
      id: 'SD12',
      class: 'conformance',
      description:
        'SD11 with the UNKNOWN workspace status reason changed from TIMEOUT to SPAWN_ERROR. The digest differs: why the world refused to answer is a fact about the world, so it must invalidate a disposition.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: digestPayload({
        repository: repository(),
        workspaces: [observedWorkspace(), unknownWorkspace({ statusUnknownReason: 'SPAWN_ERROR' })],
      }),
    },
    {
      id: 'SD13',
      class: 'conformance',
      description:
        'SD11 with the second workspace NOT_ATTEMPTED instead of UNKNOWN. observationState changes the digest, while the accompanying notAttemptedReason does not appear in the payload at all — it is a fact about this run scope, not about the machine.',
      schemaId: DOMAINS.SNAPSHOT_V1,
      payload: digestPayload({
        repository: repository(),
        workspaces: [observedWorkspace(), unknownWorkspace({ notAttempted: true })],
      }),
    },
  ];
}

function buildVector(v: VectorInput): Record<string, unknown> {
  const bytes = canonicalBytes(v.payload);
  const preimage = framePreimage(v.schemaId, bytes);
  const { digest } = framedDigest(v.schemaId, v.payload);
  return {
    id: v.id,
    class: v.class,
    description: v.description,
    schemaId: v.schemaId,
    payload: v.payload,
    payloadNote: v.payloadNote,
    expectedCanonicalUtf8: Buffer.from(bytes).toString('utf8'),
    expectedCanonicalByteLength: bytes.length,
    expectedPreimageHex: preimage.toString('hex'),
    expectedDigest: digest,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Build                                                                                         */
/* ------------------------------------------------------------------------------------------- */

interface CanonicalizerContract {
  readonly version: string;
  readonly primitivePin: {
    readonly packageName: string;
    readonly packageVersion: string;
    readonly canonicalBaseSha: string;
    readonly sourceSha256: Readonly<Record<string, string>>;
    readonly behaviourChangeRule: string;
  };
  readonly framing: Readonly<Record<string, string>>;
}

function main(): void {
  if (!existsSync(CANONICALIZER_CONTRACT_PATH)) {
    // Fail rather than fall back to the repository's own files: a pin regenerated from the working
    // tree agrees with whatever is there, which is precisely the check the pin performs.
    throw new Error(
      `frozen canonicalizer contract not readable at ${CANONICALIZER_CONTRACT_PATH}; set WLC_AUTHORITY_ROOT`,
    );
  }
  const contractBytes = readFileSync(CANONICALIZER_CONTRACT_PATH);
  const canonicalizerContractDigest = sha256Hex(contractBytes);
  const contract = JSON.parse(contractBytes.toString('utf8')) as CanonicalizerContract;

  const vectors = vectorInputs().map(buildVector);
  const byId = new Map(vectors.map((v) => [v.id as string, v]));
  const digestOf = (id: string): string => {
    const v = byId.get(id);
    if (v === undefined) throw new Error(`no vector ${id}`);
    return v.expectedDigest as string;
  };

  // Every invariant is COMPUTED here and the build fails if one is false. A published invariants
  // block that was merely asserted would be a claim, and a claim is what test vectors replace.
  const invariants: Record<string, boolean> = {
    'SD01 != SD02 (absent field versus explicit null)': digestOf('SD01') !== digestOf('SD02'),
    'SD01 != SD03 (omitted list versus empty list)': digestOf('SD01') !== digestOf('SD03'),
    'SD04 != SD05 (no case folding on the observed spelling)':
      digestOf('SD04') !== digestOf('SD05'),
    'SD04 and SD05 carry byte-identical caseId and comparisonKey':
      (byId.get('SD04')!.payload as { caseId: string }).caseId ===
      (byId.get('SD05')!.payload as { caseId: string }).caseId,
    'SD01 != SD09 (domain separation, SNAPSHOT_V1 versus CAPTURE_BUNDLE_V1)':
      digestOf('SD01') !== digestOf('SD09'),
    'SD01 != SD10 (prefix safety, SNAPSHOT_V1 versus SNAPSHOT_V11)':
      digestOf('SD01') !== digestOf('SD10'),
    'SD07 emits 0 for negative zero': byId.get('SD07')!.expectedCanonicalUtf8 ===
      '{"aheadOfUpstream":0}',
    'SD08 leaves U+2028 and U+2029 raw': (
      byId.get('SD08')!.expectedCanonicalUtf8 as string
    ).includes('\u2028'),
    'SD11 != SD12 (unknownReason is digest-covered)': digestOf('SD11') !== digestOf('SD12'),
    'SD11 != SD13 (observationState is digest-covered)': digestOf('SD11') !== digestOf('SD13'),
  };
  const broken = Object.entries(invariants).filter(([, ok]) => !ok);
  if (broken.length > 0) {
    throw new Error(`vector invariants do not hold: ${broken.map(([k]) => k).join('; ')}`);
  }

  const vectorsFile = {
    schemaId: 'WORKSPACE_SNAPSHOT_DIGEST_TEST_VECTORS_V1',
    version: '1.0.0',
    status: 'FROZEN',
    contract: 'snapshot-digest-v1.json',
    generatedBy: 'scripts/workspace-lifecycle/build-snapshot-digest-vectors.mts',
    generatedWith: `${contract.primitivePin.packageName} ${contract.primitivePin.packageVersion} DefaultCanonicalJson.toBytes with SHA-256 framing, via packages/mps-workspace-observer/src/digest/CanonicalDigest.ts`,
    howToVerify:
      'For each vector: canonicalize `payload` per byteSemantics of the Phase 0 canonicalizer-contract-v1.json, compare the bytes to expectedCanonicalUtf8 and expectedCanonicalByteLength, build the preimage uint32be(len(schemaId))||schemaId||uint32be(len(bytes))||bytes, compare it to expectedPreimageHex, and SHA-256 it to expectedDigest. No expectedDigest in this file was written by hand; all of them are produced by the implementation under test, so they prove AGREEMENT with the frozen primitive, not correctness of the inclusion rule. Reviewing the vector SET is the adversarial verifier\u2019s job (spec A12).',
    conformanceVectorCount: vectors.filter((v) => v.class === 'conformance').length,
    informativeVectorCount: vectors.filter((v) => v.class === 'informative').length,
    invariants,
    vectors,
  };
  const vectorsPath = join(CONTRACTS_DIR, 'snapshot-digest-test-vectors-v1.json');
  const vectorsDigest = writeArtifact(vectorsPath, vectorsFile);

  const included = DIGEST_INCLUSION_TABLE.filter((r) => r.included);
  const excluded = DIGEST_INCLUSION_TABLE.filter((r) => !r.included);

  const absentDigest = framedDigest(DOMAINS.SNAPSHOT_V1, {}).digest;
  const nullDigest = framedDigest(DOMAINS.SNAPSHOT_V1, { headSha: null }).digest;

  const digestFile = {
    schemaId: 'WORKSPACE_SNAPSHOT_DIGEST_V1',
    version: '1.0.0',
    status: 'FROZEN',
    ownedBy: 'WORKSPACE-LIFECYCLE-CONTROLLER-V1 (observer package)',
    normativeAuthority:
      'workspace-lifecycle-controller-v1.1-SPEC-FREEZE.md A9, A10, A11, A12, A13, B6; Del D item 10',
    generatedBy: 'scripts/workspace-lifecycle/build-snapshot-digest-vectors.mts',
    generatedFrom:
      'DIGEST_INCLUSION_TABLE in packages/mps-workspace-observer/src/snapshot/SnapshotDigest.ts. The table below is emitted from that constant so the artifact and the code cannot drift; SnapshotDigest.test.ts asserts the two are deep-equal.',

    payloadSchemaId: SNAPSHOT_SCHEMA_ID,
    digestDomain: DOMAINS.SNAPSHOT_V1,

    inclusionRule: {
      statementSv:
        'Ett f\u00e4lt f\u00e5r ing\u00e5 i digesten om och endast om en reimplementation med annan logik, mot of\u00f6r\u00e4ndrad omv\u00e4rld, med n\u00f6dv\u00e4ndighet producerar samma v\u00e4rde.',
      statementEn:
        'A field belongs in the digest iff a reimplementation with different logic, against an unchanged world, necessarily produces the same value.',
      statementNote:
        'One rule, quoted verbatim from the two places the freeze states it: A10 (Swedish) and B6 (English). Neither is a paraphrase of the other.',
      questionAnswered:
        'Has the observed world changed since the disposition was made? NOT: has our interpretation changed.',
      namedConsequences: [
        'graphRelation fails the test and is excluded: it is our mapping of the topology, not the topology.',
        'mergeBase passes and is kept: Git computes it, so a changed answer means the object graph actually moved.',
        'observedAt, durations, versions and transcript references are excluded by A9: including them gives every re-observation a new digest, the V2 compare-and-swap can then never succeed, and the predictable response to a condition that always fails is to loosen it.',
      ],
      safetyRelevanceGate:
        'A9 adds a second gate on top of A10: a field that passes the inclusion test may still be excluded when it carries no removal safety and changes constantly. filesystem.entryCount is the worked case — it counts build output, no removal predicate reads it, and it changes on every compile.',
    },

    inclusionTable: {
      rowCount: DIGEST_INCLUSION_TABLE.length,
      includedCount: included.length,
      excludedCount: excluded.length,
      rows: DIGEST_INCLUSION_TABLE.map((r) => ({
        field: r.field,
        included: r.included,
        justification: r.justification,
      })),
    },

    primitivePin: {
      packageName: contract.primitivePin.packageName,
      packageVersion: contract.primitivePin.packageVersion,
      entryPoint: 'DefaultCanonicalJson.toBytes',
      format: 'JSON',
      canonicalBaseSha: contract.primitivePin.canonicalBaseSha,
      sourceSha256: contract.primitivePin.sourceSha256,
      behaviourChangeRule: contract.primitivePin.behaviourChangeRule,
      copiedFrom: {
        file: 'contracts/canonicalizer-contract-v1.json',
        contractVersion: contract.version,
        sha256: canonicalizerContractDigest,
        note:
          'The pin is COPIED from the Phase 0-frozen contract in the read-only authority mirror, never re-derived from this repository. A pin re-derived from the working tree would agree with whatever the working tree contains, which is the check the pin exists to perform. CanonicalDigest.test.ts recomputes the seven file digests and compares them to this map.',
      },
      noSecondCanonicaliser:
        'A11/B6 forbid writing another canonicaliser. V1 contributes exactly two things the primitive lacks: the domain framing below, and the structural payload restrictions P1-P7 that make the primitive\u2019s lossy cases unreachable.',
    },

    domainSeparation: {
      preimage: contract.framing.preimage,
      schemaIdEncoding: contract.framing.schemaIdEncoding,
      hash: contract.framing.hash,
      outputEncoding: contract.framing.outputEncoding,
      prefixSafety: contract.framing.prefixSafety,
      schemaIdAcceptance: contract.framing.schemaIdAcceptance,
      domains: {
        CAPTURE_BUNDLE_V1:
          'Phase 0 captureDigest over redacted capture bundles. V1 never mints one; it recomputes them to verify the frozen corpus at load time.',
        SNAPSHOT_V1: 'V1 identityDigest over the projection defined by the inclusion table above.',
      },
      demonstratedBy: ['SD09 (domain separation)', 'SD10 (prefix safety)'],
    },

    absenceEncoding: {
      rule:
        'An unobserved value is OMITTED from the payload. It is NEVER encoded as an explicit null, and never as a sentinel string or a zero. A value field appears if and only if its observation reached OBSERVED.',
      whyItMatters:
        'The pinned primitive emits an omitted field and an explicit null differently (contract R4), so without one consistent rule two conforming implementations of the same observation produce different bytes. Absence is also load-bearing on its own: "the metadata directory was read and was empty" and "the metadata directory was never read" are different facts, and a null would erase the difference.',
      workedExample: {
        absent: { payload: {}, expectedDigest: absentDigest },
        explicitNull: { payload: { headSha: null }, expectedDigest: nullDigest },
        differ: absentDigest !== nullDigest,
        note:
          'Both are valid payloads for the primitive; only the first is a valid V1 projection. The second is published so an implementation that writes null for "not observed" fails against a vector instead of producing a plausible wrong digest (SD02).',
      },
      arrays:
        'An empty array is emitted as [] and is NOT the same as an omitted array (SD01 versus SD03).',
    },

    notCasContentHash: {
      statement:
        'identityDigest is NOT the Mimer CAS content_hash and the two are never aliased or substituted (A13). A snapshot persisted in CAS may legitimately carry both.',
      identityDigestAnswers:
        'Has the world the disposition was grounded on changed?',
      contentHashAnswers:
        'Has the whole canonical content of the persisted artifact changed?',
      failureMode:
        'content_hash (BLAKE3, over a signed envelope) covers the entire envelope including provenance and timestamps, which A9 deliberately keeps OUT of identityDigest. Used as the V2 compare-and-swap condition it would differ between two observations of an untouched machine, so V2 could never delete anything, and the certain response to a condition that always fails is that the condition gets loosened. The CAS condition uses identityDigest, never the CAS reference.',
      differences: [
        'algorithm: SHA-256 here, BLAKE3 for content_hash',
        'framing: length-prefixed schemaId domain here, {_schema,_data} envelope for content_hash',
        'question: world identity here, persisted-artifact identity for content_hash',
      ],
    },

    excludedUndefinedTerms: [
      {
        term: 'generation',
        rule:
          'Omitted entirely rather than excluded-with-a-value. The term has no normative, reproducible definition; an undefined term makes the digest non-portable, so A10 requires it to be defined or struck. It is struck. It appears in no payload, no projection and no artifact field.',
      },
    ],

    testVectors: {
      file: 'snapshot-digest-test-vectors-v1.json',
      sha256: vectorsDigest,
      conformanceVectorCount: vectorsFile.conformanceVectorCount,
      classesCovered: [
        'absent field versus explicit null (SD01, SD02)',
        'empty list versus omitted list (SD01, SD03)',
        'a with ring and o with diaeresis in a path (SD04)',
        'the same path in different case (SD04, SD05)',
        'integers at the safe-integer boundary (SD06)',
        'negative zero collapsing to 0 (SD07)',
        'U+2028 and U+2029 emitted raw (SD08)',
        'domain separation (SD09)',
        'prefix safety (SD10)',
        'a workspace whose observation state is UNKNOWN (SD11)',
        'unknownReason is digest-covered (SD11, SD12)',
        'observationState is digest-covered, notAttemptedReason is not (SD11, SD13)',
      ],
      reviewOwner:
        'Vectors prove conformance, not correctness. Review of the vector SET belongs to the independent adversarial verifier and is an item in the handover (A12).',
    },

    digestRule:
      'snapshotDigestContractDigest = lowercase hex SHA-256 of the exact bytes of this file as versioned.',
    selfDigestEncoding:
      'UTF-8 without a byte-order mark, LF line endings, exactly one trailing LF. Digests are taken over those exact bytes; no re-serialization, re-indentation or line-ending conversion may precede hashing.',
  };

  const digestPath = join(CONTRACTS_DIR, 'snapshot-digest-v1.json');
  const contractDigest = writeArtifact(digestPath, digestFile);

  process.stdout.write(
    [
      `canonicalizer-contract-v1.json  sha256=${canonicalizerContractDigest} (version ${contract.version})`,
      `snapshot-digest-test-vectors-v1.json  vectors=${vectors.length} sha256=${vectorsDigest}`,
      `snapshot-digest-v1.json  rows=${DIGEST_INCLUSION_TABLE.length} (${included.length} included / ${excluded.length} excluded) sha256=${contractDigest}`,
      `invariants checked: ${Object.keys(invariants).length}, all true`,
      '',
    ].join('\n'),
  );
}

main();
