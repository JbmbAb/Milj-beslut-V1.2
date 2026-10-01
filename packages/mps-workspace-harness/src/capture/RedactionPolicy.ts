/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the frozen redaction and truncation policy, re-implemented.
 *
 * Implements contracts/redaction-truncation-policy-v1.json 1.2.0, redactionPolicyDigest
 * e6c7cd9d3ac08444f9c32a8eb4b05184b0bf78d3d41470906093f737f5e2ed11.
 *
 * Why this exists at all: spec B4/A8 require that a differing captureDigest on the live machine
 * yields CORPUS_DRIFT, not CONTROLLER_FAILURE. Test layer 3 can only make that distinction if it
 * can COMPUTE a fresh captureDigest, and captureDigest covers exactly the bytes this policy
 * produces. Without a bit-for-bit re-implementation the live layer can run the Observer but cannot
 * tell a machine that changed from a controller that is broken, which is the entire point of A8.
 *
 * Three properties are contract, not implementation taste, and each has a named failure:
 *
 *  - Determinism. Placeholders are numbered by order of appearance WITHIN the record, there is no
 *    clock, no randomness and no run-dependent ordering. A run-dependent placeholder would make
 *    every recomputed captureDigest differ and every drift report meaningless.
 *  - Recomputation, not accumulation. `redactions` is rebuilt from the record's own bytes rather
 *    than appended to, so re-applying the policy to an already-redacted record is a fixed point.
 *    An appending implementation would double every count on the second pass and could never be
 *    checked against the frozen corpus at all.
 *  - Safety-relevant counts are never reduced. An already-present totalEntryCount, originalSize or
 *    truncation object is preserved rather than recomputed from the surviving material: those
 *    counts are the only remaining evidence of what was filtered away.
 *
 * Two boundaries are load-bearing and are asserted rather than assumed:
 *
 *  - RD6: argv, cwd and path are NEVER rewritten, because the replay transport builds its lookup
 *    key from them (ReplayTransport.processKey / fsKey). Rewriting one turns every replay of that
 *    case into NOT_IN_CORPUS. A credential shape found in one of them therefore ABORTS.
 *  - RD2's left boundary (?<![A-Za-z0-9_-]) and right boundary (?![A-Za-z0-9]). Without them a
 *    branch named codex/task-* matched the OpenAI key pattern in the first capture run and
 *    destroyed ref-name evidence, which spec A14 depends on.
 */
import { framedDigestOfBytes, DOMAINS, canonicalBytes } from '@miljobeslut/mps-workspace-observer';

/** Frozen capture bytes. `utf8` when the bytes were strictly valid UTF-8, otherwise `base64`. */
export interface BytesFieldLike {
  readonly encoding: 'utf8' | 'base64';
  readonly data: string;
}

export interface RedactionEntry {
  readonly rule: string;
  readonly count: number;
  readonly kinds?: readonly string[];
}

export interface DirectoryEntryLike {
  readonly name: string;
  readonly type: 'file' | 'dir' | 'symlink' | 'other';
  readonly size?: number | null;
  readonly mtimeMs?: number | null;
}

export interface FsResultLike {
  readonly outcome: 'COMPLETED' | 'TIMEOUT' | 'ERROR';
  readonly errorCode?: string | null;
  readonly exists?: boolean;
  readonly type?: 'file' | 'dir' | 'symlink' | 'other' | null;
  readonly size?: number | null;
  readonly mtimeMs?: number | null;
  readonly realpath?: string | null;
  readonly entries?: readonly DirectoryEntryLike[];
  readonly totalEntryCount?: number;
  readonly matchedEntryCount?: number;
  readonly entryCount?: number;
  readonly content?: BytesFieldLike;
  readonly truncated?: boolean;
  readonly originalSize?: number;
}

export type TruncationLike = { readonly rule: string; readonly [k: string]: unknown };

export interface ProcessCaptureRecord {
  readonly requestId: string;
  readonly instanceKey: string;
  readonly kind: 'PROCESS';
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly outcome: 'COMPLETED' | 'TIMEOUT' | 'SPAWN_ERROR';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly spawnErrorCode: string | null;
  readonly stdout: BytesFieldLike;
  readonly stderr: BytesFieldLike;
  readonly redactions: readonly RedactionEntry[];
  readonly nonNfcFields: readonly string[];
  readonly truncation?: TruncationLike;
}

export interface FsCaptureRecord {
  readonly requestId: string;
  readonly instanceKey: string;
  readonly kind: 'FS';
  readonly operation: 'LSTAT' | 'READDIR' | 'READDIR_COUNT' | 'READ_FILE' | 'REALPATH_NATIVE';
  readonly opKey?: string;
  readonly path: string;
  readonly result: FsResultLike;
  readonly redactions: readonly RedactionEntry[];
  readonly nonNfcFields: readonly string[];
}

export type CaptureRecord = ProcessCaptureRecord | FsCaptureRecord;

/** Rule identifiers, quoted from the frozen policy so a typo cannot silently rename evidence. */
export const RULES = Object.freeze({
  RD1: 'RD1_UNTRACKED_PATHS',
  RD2: 'RD2_CREDENTIAL_SHAPES',
  RD3: 'RD3_ENVIRONMENT_VALUES',
  RD4: 'RD4_DISCOVERY_NAME_FILTER',
  RD5: 'RD5_CANDIDATE_DIR_CONTENTS',
  RD6: 'RD6_REPLAY_KEY_FIELDS_NEVER_REWRITTEN',
  RD8: 'RD8_REFLOG_IDENTITY',
  TR1: 'TR1_LINE_LIMIT_STATUS',
  TR2: 'TR2_BYTE_LIMIT_STDOUT',
  TR3: 'TR3_FILE_READ_LIMIT',
} as const);

/** The redactionPolicyDigest this module claims to implement; asserted against the mirror in test. */
export const REDACTION_POLICY_DIGEST =
  'e6c7cd9d3ac08444f9c32a8eb4b05184b0bf78d3d41470906093f737f5e2ed11';
export const REDACTION_POLICY_VERSION = '1.2.0';

/** TR1: the R-W-04 line threshold. Below it the 151-line Cesium cluster stays verbatim (A23). */
export const TR1_LINE_LIMIT = 400;
/** TR2: 1 MiB per decoded stream. */
export const TR2_BYTE_LIMIT = 1048576;
/** The family whose stdout carries untracked names and is therefore TR1's, not TR2's. */
export const STATUS_FAMILY = 'R-W-04';
/** The family whose file content is the canonical-reference reflog (RD8). */
export const REFLOG_FAMILY = 'R-F-10';

/**
 * Raised when a replay-key field carries a credential shape.
 *
 * This is an abort, not a rewrite, and the reason is stated in the frozen policy: rewriting argv,
 * cwd or path would make the replay lookup miss and every affected request would come back
 * NOT_IN_CORPUS. Privacy and replay determinism are both preserved by stopping and adjudicating.
 */
export class KeyFieldCredentialShape extends Error {
  readonly code = 'RD6_KEY_FIELD_CREDENTIAL_SHAPE';
  constructor(
    readonly requestId: string,
    readonly instanceKey: string,
    readonly field: string,
    readonly kind: string,
  ) {
    super(
      `RD6_KEY_FIELD_CREDENTIAL_SHAPE requestId=${requestId} instanceKey=${JSON.stringify(instanceKey)} field=${field} kind=${kind}`,
    );
    this.name = 'KeyFieldCredentialShape';
  }
}

/**
 * Raised when the policy cannot be applied to the bytes it was handed.
 *
 * Every case here is one the frozen policy says aborts the freeze rather than degrading: a base64
 * status stream (untracked names could then not be redacted at all), and a TR2 cut that failed its
 * own well-formedness assertion.
 */
export class RedactionAbort extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = 'RedactionAbort';
  }
}

// --- RD2 ---------------------------------------------------------------------------------------

/** The frozen left boundary B. Its absence is what matched `sk-` inside codex/task-* branch names. */
const B = '(?<![A-Za-z0-9_-])';
/** The frozen right boundary E. */
const E = '(?![A-Za-z0-9])';

interface CredentialPattern {
  readonly kind: string;
  readonly re: RegExp;
  /**
   * Replacement. Most patterns replace the whole match by the kind label; kv_secret keeps the key
   * and separator, because the KEY is evidence (which secret was present) while the value is not.
   */
  readonly replace: string;
}

/**
 * The twelve frozen credential shapes, in the frozen order, as a data table.
 *
 * Order is contract: kv_secret runs last so that a value already replaced by a token pattern is
 * still recognised as a secret-shaped assignment. 40-hex and 64-hex strings are deliberately absent
 * from this table — git SHAs and digests are the evidence the classifier reads.
 *
 * Every regex here is written with its escapes intact. The frozen policy file states them in prose
 * and several backslashes did not survive into that prose (`[sS]*?`, `[^/s:@]+`, `(s*[:=]s*)(S+)`,
 * and the JWT separators); the patterns below are the only reading under which those clauses parse
 * as the rule the same clause describes in words. That divergence is reported, not hidden.
 */
export const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = Object.freeze([
  { kind: 'ghp_token', re: new RegExp(`${B}ghp_[A-Za-z0-9]{20,}${E}`, 'g'), replace: '<REDACTED:ghp_token>' },
  {
    kind: 'github_pat',
    re: new RegExp(`${B}github_pat_[A-Za-z0-9_]{20,}${E}`, 'g'),
    replace: '<REDACTED:github_pat>',
  },
  { kind: 'gh_token', re: new RegExp(`${B}gh[oasru]_[A-Za-z0-9]{20,}${E}`, 'g'), replace: '<REDACTED:gh_token>' },
  { kind: 'openai_key', re: new RegExp(`${B}sk-[A-Za-z0-9]{20,}${E}`, 'g'), replace: '<REDACTED:openai_key>' },
  { kind: 'aws_key', re: new RegExp(`${B}AKIA[0-9A-Z]{16}${E}`, 'g'), replace: '<REDACTED:aws_key>' },
  {
    kind: 'slack_token',
    re: new RegExp(`${B}xox[abpr]-[A-Za-z0-9-]{10,}${E}`, 'g'),
    replace: '<REDACTED:slack_token>',
  },
  { kind: 'google_key', re: new RegExp(`${B}AIza[0-9A-Za-z_-]{35}${E}`, 'g'), replace: '<REDACTED:google_key>' },
  {
    kind: 'jwt',
    re: new RegExp(`${B}eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`, 'g'),
    replace: '<REDACTED:jwt>',
  },
  {
    kind: 'pem_block',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: '<REDACTED:pem_block>',
  },
  { kind: 'url_userinfo', re: /(?<=:\/\/)[^/\s:@]+:[^@\s]+(?=@)/g, replace: '<REDACTED:url_userinfo>' },
  {
    kind: 'kv_secret',
    re: /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|bearer)\b(\s*[:=]\s*)(\S+)/gi,
    replace: '$1$2<REDACTED:kv_secret>',
  },
]);

export interface CredentialScan {
  readonly text: string;
  readonly count: number;
  readonly kinds: readonly string[];
}

/**
 * RD2 over one decoded string, globally, in the frozen pattern order.
 *
 * A fresh RegExp is built per call because the table's patterns carry the `g` flag and therefore
 * carry mutable lastIndex; sharing them across calls makes the result depend on call order, which
 * is exactly the run-dependence the policy's determinism principle forbids.
 */
export function applyCredentialShapes(input: string): CredentialScan {
  let text = input;
  let count = 0;
  const kinds: string[] = [];
  for (const pattern of CREDENTIAL_PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    const matches = text.match(re);
    if (matches === null) continue;
    count += matches.length;
    kinds.push(pattern.kind);
    text = text.replace(new RegExp(pattern.re.source, pattern.re.flags), pattern.replace);
  }
  return { text, count, kinds };
}

/** The first credential kind present in a string, or undefined. Used by RD6's abort check. */
export function firstCredentialKind(input: string): string | undefined {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (new RegExp(pattern.re.source, pattern.re.flags).test(input)) return pattern.kind;
  }
  return undefined;
}

// --- line handling ------------------------------------------------------------------------------

/**
 * Split into real lines, dropping the empty element a trailing newline produces.
 *
 * TR1's threshold and its originalLines are counts of LINES, not of split fragments; counting the
 * phantom fragment would report one more line than git emitted and would move the 400-line
 * threshold by one against a corpus whose largest status is 156.
 */
export function splitLines(text: string): string[] {
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function joinLines(lines: readonly string[], original: string): string {
  const joined = lines.join('\n');
  return original.endsWith('\n') ? `${joined}\n` : joined;
}

// --- RD1 ----------------------------------------------------------------------------------------

export interface RuleResult {
  readonly text: string;
  readonly count: number;
}

/**
 * RD1: every '? ' line's path becomes '<UNTRACKED_n>', n being the 1-based ordinal of that '?'
 * line within the record. A trailing '/' is preserved after the placeholder.
 *
 * The trailing slash is kept because it is git's directory indicator: without it a collapsed
 * untracked DIRECTORY (which can hide an unbounded number of files) becomes indistinguishable from
 * a single untracked file, and the count the classifier reads would mean two different things.
 *
 * The line count and the '?' line count are unchanged: untracked names are the leak vector, their
 * number is the evidence.
 */
export function applyUntrackedPaths(text: string): RuleResult {
  const lines = splitLines(text);
  let n = 0;
  const out = lines.map((line) => {
    if (!line.startsWith('? ')) return line;
    n += 1;
    const path = line.slice(2);
    const suffix = path.endsWith('/') ? '/' : '';
    return `? <UNTRACKED_${n}>${suffix}`;
  });
  return { text: joinLines(out, text), count: n };
}

// --- RD8 ----------------------------------------------------------------------------------------

/**
 * RD8: `<old-sha> <new-sha> <committer name> <email> <epoch> <tz>\t<message>` keeps both SHAs, the
 * epoch, the timezone and the message, and replaces the identity between them.
 *
 * The identity is a real person's name and address, no classifier needs it, and publishing the
 * corpus to a verifier would publish it too. What B9 actually needs from this family is WHEN the
 * local canonical reference was last updated, which is the epoch this rule preserves.
 *
 * The identity group is matched non-greedily and anchored on the right by the epoch and timezone,
 * so a name containing digits or spaces cannot swallow the timestamp evidence.
 */
const REFLOG_LINE_RE = /^([0-9a-f]{40} [0-9a-f]{40} )(.*?)( \d+ [+-]\d{4}\t)/;

export function applyReflogIdentity(text: string): RuleResult {
  const lines = splitLines(text);
  let count = 0;
  const out = lines.map((line) => {
    const m = REFLOG_LINE_RE.exec(line);
    if (m === null) return line;
    count += 1;
    return `${m[1]}<REDACTED:identity>${m[3]}${line.slice(m[0].length)}`;
  });
  return { text: joinLines(out, text), count };
}

// --- TR1 ----------------------------------------------------------------------------------------

/**
 * Field counts of git status --porcelain=v2 before the path, by line class.
 *
 * A data table rather than an if-chain because the frozen policy calls this a per-class rule and
 * because the counts are the only thing that differs between the three classes. Getting one wrong
 * elides a mode or a SHA instead of a path, which would corrupt evidence rather than protect it.
 */
const STATUS_PATH_FIELD_INDEX: Readonly<Record<string, number>> = Object.freeze({
  /** 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path> */
  '1 ': 8,
  /** 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath> */
  '2 ': 9,
  /** u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path> */
  'u ': 10,
});

export type StatusLineClassCounts = {
  readonly headerLines: number;
  readonly changedLines: number;
  readonly renamedLines: number;
  readonly unmergedLines: number;
  readonly untrackedLines: number;
  readonly ignoredLines: number;
};

export function statusLineClassCounts(lines: readonly string[]): StatusLineClassCounts {
  let headerLines = 0;
  let changedLines = 0;
  let renamedLines = 0;
  let unmergedLines = 0;
  let untrackedLines = 0;
  let ignoredLines = 0;
  for (const line of lines) {
    if (line.startsWith('# ')) headerLines += 1;
    else if (line.startsWith('1 ')) changedLines += 1;
    else if (line.startsWith('2 ')) renamedLines += 1;
    else if (line.startsWith('u ')) unmergedLines += 1;
    else if (line.startsWith('? ')) untrackedLines += 1;
    else if (line.startsWith('! ')) ignoredLines += 1;
  }
  return { headerLines, changedLines, renamedLines, unmergedLines, untrackedLines, ignoredLines };
}

export type StatusTruncation = {
  readonly rule: string;
  readonly originalLines: number;
  readonly elidedPathLines: number;
  readonly lineClassCounts: StatusLineClassCounts;
};

export interface StatusTruncationResult {
  readonly text: string;
  readonly truncation?: StatusTruncation;
}

/**
 * TR1: beyond the first 400 lines, '1 ', '2 ' and 'u ' lines keep every field except the path.
 *
 * Lines are never DROPPED. A parser that counts entries must still see every one of them, because
 * A23 makes the counts safety-relevant while the individual repeated names under public/cesium/...
 * are not. The rename line has two path fields separated by a tab and both are elided under the
 * SAME ordinal n, because the frozen rule defines n as the ordinal among elided LINES.
 */
export function applyStatusLineLimit(text: string): StatusTruncationResult {
  const lines = splitLines(text);
  if (lines.length <= TR1_LINE_LIMIT) return { text };

  let elided = 0;
  const out = lines.map((line, index) => {
    if (index < TR1_LINE_LIMIT) return line;
    const prefix = line.slice(0, 2);
    const fieldCount = STATUS_PATH_FIELD_INDEX[prefix];
    if (fieldCount === undefined) return line;
    const fields = line.split(' ');
    if (fields.length <= fieldCount) return line;
    elided += 1;
    const placeholder = `<ELIDED_PATH_${elided}>`;
    const head = fields.slice(0, fieldCount).join(' ');
    const tail = fields.slice(fieldCount).join(' ');
    // A rename line carries `<path>\t<origPath>`; both are paths and both go.
    const replaced = tail.includes('\t') ? `${placeholder}\t${placeholder}` : placeholder;
    return `${head} ${replaced}`;
  });

  return {
    text: joinLines(out, text),
    truncation: {
      rule: RULES.TR1,
      originalLines: lines.length,
      elidedPathLines: elided,
      lineClassCounts: statusLineClassCounts(lines),
    },
  };
}

// --- TR2 ----------------------------------------------------------------------------------------

export type ByteTruncation = {
  readonly rule: string;
  readonly originalBytes: number;
  readonly keptBytes: number;
  readonly originalLines: number;
  readonly keptLines: number;
  /** Set when an earlier size limit (the port's 64 MiB output limit) had already applied. */
  readonly priorRule?: string;
};

export interface ByteTruncationResult {
  readonly text: string;
  readonly truncation?: ByteTruncation;
}

/** P3, without the ES2024 lib: a well-formed string contains no lone surrogate. */
export function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** A UTF-8 continuation byte, i.e. a byte that can never start a character. */
function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/**
 * TR2: cut to the nearest UTF-8 character boundary at or before 1 MiB, then to the last line
 * boundary, then ASSERT the result is well-formed Unicode.
 *
 * Cutting on a character boundary is mandatory and the assertion is not belt-and-braces. Slicing
 * raw bytes mid-sequence makes Node's lossy decoder substitute U+FFFD, or in the surrogate-pair
 * case can leave a lone surrogate; either one violates the canonicalizer contract's payload
 * restriction P3, and a P3 violation in a bundle is discovered as an unexplainable digest
 * difference on the live machine — precisely the CORPUS_DRIFT / CONTROLLER_FAILURE confusion A8
 * exists to prevent. So the cut is verified by re-encoding and comparing bytes, and a failure
 * aborts rather than being recorded.
 */
export function applyByteLimit(
  text: string,
  priorRule?: string,
  limit: number = TR2_BYTE_LIMIT,
): ByteTruncationResult {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= limit) return { text };

  let cut = limit;
  while (cut > 0 && isContinuation(buf[cut])) cut -= 1;
  let kept = buf.subarray(0, cut).toString('utf8');

  // Re-encoding must reproduce the kept bytes exactly; if it does not, the decoder substituted and
  // the cut was not on a character boundary after all.
  if (!Buffer.from(kept, 'utf8').equals(buf.subarray(0, cut))) {
    throw new RedactionAbort(
      'TR2_CHARACTER_BOUNDARY_CUT_FAILED',
      `cutting at ${cut} of ${buf.length} bytes did not land on a character boundary`,
    );
  }

  const lastNewline = kept.lastIndexOf('\n');
  if (lastNewline >= 0) kept = kept.slice(0, lastNewline + 1);

  if (!isWellFormed(kept)) {
    throw new RedactionAbort(
      'TR2_RESULT_NOT_WELL_FORMED',
      'the truncated stream contains a lone surrogate and would violate payload restriction P3',
    );
  }

  const truncation: ByteTruncation = {
    rule: RULES.TR2,
    originalBytes: buf.length,
    keptBytes: Buffer.byteLength(kept, 'utf8'),
    originalLines: splitLines(text).length,
    keptLines: splitLines(kept).length,
    ...(priorRule === undefined ? {} : { priorRule }),
  };
  return { text: kept, truncation };
}

// --- RD4 / RD5 (structural) ----------------------------------------------------------------------

export interface ListingFilter {
  /** Frozen nameFilter source, or null when the container declares none. */
  readonly nameFilter: string | null;
  readonly nameFilterFlags?: string;
  readonly onlyDirectories?: boolean;
  readonly filesOnly?: boolean;
  /** R-F-05 records `[{name,type}]` only; every other listing family declares withSize. */
  readonly dropEntryMetadata?: boolean;
}

/**
 * RD4: names that do not pass the frozen filter are never recorded; the counts survive.
 *
 * totalEntryCount is PRESERVED when the result already carries one rather than recomputed from the
 * surviving entries. That is the whole safety property of the rule: the size of the blind spot the
 * name filter creates (A20's 'filesystem present, git metadata absent' row) is only visible as the
 * difference between the unfiltered total and the matched count. Recomputing the total from the
 * filtered list would silently set that difference to zero, and would also make this function
 * non-idempotent over the frozen corpus, where the entries are already filtered.
 */
export function applyListingFilter(result: FsResultLike, filter: ListingFilter): FsResultLike {
  const entries = result.entries;
  if (entries === undefined) return result;

  const re = filter.nameFilter === null ? null : new RegExp(filter.nameFilter, filter.nameFilterFlags ?? '');
  const kept = entries
    .filter((e) => {
      if (filter.onlyDirectories === true && e.type !== 'dir') return false;
      if (filter.filesOnly === true && e.type !== 'file') return false;
      return re === null || re.test(e.name);
    })
    .map((e) =>
      filter.dropEntryMetadata === true ? { name: e.name, type: e.type } : e,
    );

  return {
    ...result,
    entries: kept,
    totalEntryCount: result.totalEntryCount ?? entries.length,
    matchedEntryCount: kept.length,
  };
}

// --- the record-level policy ----------------------------------------------------------------------

export interface RedactOptions {
  /**
   * Listing filters by `${requestId} ${instanceKey} ${opKey}`, supplied by the caller
   * from the frozen command surface. The policy does not read the surface itself: the surface is
   * digest-bound by the caller, and a second reader of it would be a second place to drift.
   */
  readonly listingFilters?: ReadonlyMap<string, ListingFilter>;
}

export function listingFilterKey(requestId: string, instanceKey: string, opKey: string): string {
  return [requestId, instanceKey, opKey].join(' ');
}

function orderedRedactions(entries: readonly RedactionEntry[]): readonly RedactionEntry[] {
  // Rule order is the frozen policy's own order; a record with two applied rules must not depend
  // on which field happened to be walked first.
  const order: readonly string[] = [RULES.RD1, RULES.RD2, RULES.RD8];
  return [...entries].sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
}

/** RD2 over one BytesField, leaving base64 fields alone: 'the decoded string' does not exist there. */
function redactBytesField(field: BytesFieldLike, scan: { count: number; kinds: string[] }): BytesFieldLike {
  if (field.encoding !== 'utf8') return field;
  const applied = applyCredentialShapes(field.data);
  scan.count += applied.count;
  for (const k of applied.kinds) if (!scan.kinds.includes(k)) scan.kinds.push(k);
  return applied.count === 0 ? field : { encoding: 'utf8', data: applied.text };
}

function redactPlainString(value: string, scan: { count: number; kinds: string[] }): string {
  const applied = applyCredentialShapes(value);
  scan.count += applied.count;
  for (const k of applied.kinds) if (!scan.kinds.includes(k)) scan.kinds.push(k);
  return applied.text;
}

/**
 * RD6's abort check: argv, cwd and path are scanned but never rewritten.
 *
 * The scan runs BEFORE any other rule, so a case that must be adjudicated is adjudicated on the
 * bytes as captured rather than on bytes some earlier rule already touched.
 */
function assertNoCredentialShapeInKeyFields(record: CaptureRecord): void {
  const fields: { name: string; value: string }[] = [];
  if (record.kind === 'PROCESS') {
    record.argv.forEach((a, i) => fields.push({ name: `argv[${i}]`, value: a }));
    fields.push({ name: 'cwd', value: record.cwd });
  } else {
    fields.push({ name: 'path', value: record.path });
  }
  for (const field of fields) {
    const kind = firstCredentialKind(field.value);
    if (kind !== undefined) {
      throw new KeyFieldCredentialShape(record.requestId, record.instanceKey, field.name, kind);
    }
  }
}

/**
 * Apply the whole frozen policy to one raw capture record.
 *
 * Rule order is RD6 (abort), RD1, RD8, RD2, RD4/RD5 (structural), TR1, TR2, TR3 (structural).
 * RD1 and RD8 run before RD2 because both are anchored on line SHAPE — a '? ' prefix, a pair of
 * 40-hex SHAs — and a credential replacement inside those lines would shift the very fields those
 * two rules key on. RD2 then runs over what survives, which is the material the policy actually
 * wants scanned.
 *
 * The returned record is a fresh object; the input is never mutated, because a caller that reused
 * a raw record after redaction would be reading bytes that are not the versioned ones.
 */
export function redactRecord(record: CaptureRecord, options: RedactOptions = {}): CaptureRecord {
  assertNoCredentialShapeInKeyFields(record);

  const redactions: RedactionEntry[] = [];
  const scan = { count: 0, kinds: [] as string[] };

  if (record.kind === 'PROCESS') {
    let stdout = record.stdout;
    let stderr = record.stderr;
    let truncation = record.truncation;

    if (record.requestId === STATUS_FAMILY) {
      if (stdout.encoding !== 'utf8') {
        // A base64 status stream aborts the freeze: untracked names could not then be redacted,
        // and recording them raw is the one outcome this policy exists to prevent.
        throw new RedactionAbort(
          'RD1_STATUS_STREAM_NOT_UTF8',
          `${record.requestId} ${record.instanceKey} stdout is base64; untracked paths cannot be redacted`,
        );
      }
      const rd1 = applyUntrackedPaths(stdout.data);
      if (rd1.count > 0) redactions.push({ rule: RULES.RD1, count: rd1.count });
      stdout = { encoding: 'utf8', data: rd1.text };
    }

    stdout = redactBytesField(stdout, scan);
    stderr = redactBytesField(stderr, scan);

    if (record.requestId === STATUS_FAMILY) {
      const tr1 = applyStatusLineLimit(stdout.data);
      stdout = { encoding: 'utf8', data: tr1.text };
      if (tr1.truncation !== undefined) truncation = tr1.truncation;
    } else {
      // The prior rule is retained rather than overwritten: the port's 64 MiB output limit and TR2
      // ALWAYS co-occur when they occur at all (64 MiB exceeds 1 MiB), and the frozen bundle schema
      // has exactly one truncation object per record to say so in.
      const priorRule = typeof truncation?.rule === 'string' ? truncation.rule : undefined;
      if (stdout.encoding === 'utf8') {
        const tr2 = applyByteLimit(stdout.data, priorRule);
        stdout = { encoding: 'utf8', data: tr2.text };
        if (tr2.truncation !== undefined) truncation = tr2.truncation;
      }
      if (stderr.encoding === 'utf8') {
        const tr2 = applyByteLimit(stderr.data, priorRule);
        stderr = { encoding: 'utf8', data: tr2.text };
        if (tr2.truncation !== undefined) truncation = tr2.truncation;
      }
    }

    if (scan.count > 0) {
      redactions.push({ rule: RULES.RD2, count: scan.count, kinds: [...scan.kinds] });
    }

    const out: ProcessCaptureRecord = {
      requestId: record.requestId,
      instanceKey: record.instanceKey,
      kind: 'PROCESS',
      executable: record.executable,
      argv: [...record.argv],
      cwd: record.cwd,
      env: { ...record.env },
      outcome: record.outcome,
      exitCode: record.exitCode,
      signal: record.signal,
      spawnErrorCode: record.spawnErrorCode,
      stdout,
      stderr,
      redactions: orderedRedactions(redactions),
      nonNfcFields: [...record.nonNfcFields],
      ...(truncation === undefined ? {} : { truncation }),
    };
    return out;
  }

  let result: FsResultLike = record.result;

  if (record.requestId === REFLOG_FAMILY && result.content?.encoding === 'utf8') {
    const rd8 = applyReflogIdentity(result.content.data);
    if (rd8.count > 0) redactions.push({ rule: RULES.RD8, count: rd8.count });
    result = { ...result, content: { encoding: 'utf8', data: rd8.text } };
  }

  const filter = options.listingFilters?.get(
    listingFilterKey(record.requestId, record.instanceKey, record.opKey ?? ''),
  );
  if (filter !== undefined) result = applyListingFilter(result, filter);

  if (result.content !== undefined) {
    result = { ...result, content: redactBytesField(result.content, scan) };
  }
  if (typeof result.realpath === 'string') {
    result = { ...result, realpath: redactPlainString(result.realpath, scan) };
  }
  if (result.entries !== undefined) {
    result = {
      ...result,
      entries: result.entries.map((e) => ({ ...e, name: redactPlainString(e.name, scan) })),
    };
  }

  if (scan.count > 0) {
    redactions.push({ rule: RULES.RD2, count: scan.count, kinds: [...scan.kinds] });
  }

  const out: FsCaptureRecord = {
    requestId: record.requestId,
    instanceKey: record.instanceKey,
    kind: 'FS',
    operation: record.operation,
    ...(record.opKey === undefined || record.opKey === '' ? {} : { opKey: record.opKey }),
    path: record.path,
    result,
    redactions: orderedRedactions(redactions),
    nonNfcFields: [...record.nonNfcFields],
  };
  return out;
}

/**
 * The canonical bytes of a record, for comparing two records BIT FOR BIT rather than field by field.
 *
 * Deep-equality assertions in tests pass on records whose digests differ (property order, an
 * explicit null where the corpus omits the key). Only the bytes the digest actually covers settle
 * whether a re-implementation reproduced the frozen policy.
 */
export function recordBytes(record: CaptureRecord): Uint8Array {
  return canonicalBytes(record);
}

export function recordDigest(record: CaptureRecord): string {
  return framedDigestOfBytes(DOMAINS.CAPTURE_BUNDLE_V1, recordBytes(record));
}
