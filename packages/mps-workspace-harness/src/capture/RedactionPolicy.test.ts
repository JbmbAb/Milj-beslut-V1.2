/**
 * The proof that matters for spec B4 / A8: ROUND-TRIP FIDELITY against the frozen corpus.
 *
 * A test that only showed the policy runs would prove nothing about drift attribution. The claim
 * that has to hold is stronger: the frozen corpus bytes are already this policy's OUTPUT, so
 * re-applying the policy to them must be a fixed point, bit for bit, for every record class the
 * corpus contains. If it is not, then a fresh captureDigest computed on the live machine differs
 * from the frozen one for reasons that have nothing to do with the machine, and every CORPUS_DRIFT
 * verdict built on it is unfounded.
 *
 * Bit for bit means the canonical bytes, not a deep-equality assertion. Deep equality passes on
 * records whose digests differ — an explicit null where the corpus omits a key, a different
 * property order — and those are exactly the differences a digest comparison would surface later
 * with no way to explain them.
 *
 * The synthetic cases below cover the rules the corpus cannot exercise, and the report states which
 * those are rather than letting an all-green suite imply full coverage.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalBytes, sha256Hex } from '@miljobeslut/mps-workspace-observer';

import {
  CREDENTIAL_PATTERNS,
  KeyFieldCredentialShape,
  REDACTION_POLICY_DIGEST,
  RedactionAbort,
  RULES,
  TR1_LINE_LIMIT,
  TR2_BYTE_LIMIT,
  applyByteLimit,
  applyCredentialShapes,
  applyListingFilter,
  applyReflogIdentity,
  applyStatusLineLimit,
  applyUntrackedPaths,
  isWellFormed,
  listingFilterKey,
  redactRecord,
  splitLines,
} from './RedactionPolicy.js';
import type { CaptureRecord, ListingFilter, ProcessCaptureRecord } from './RedactionPolicy.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';

const CORPUS_DIR = join(AUTHORITY_ROOT, 'corpus');
const authorityPresent = existsSync(join(CORPUS_DIR, 'capture-manifest-v1.json'));

interface SurfaceContainer {
  readonly key: string;
  readonly nameFilter: string | null;
  readonly nameFilterFlags?: string;
  readonly onlyDirectories?: boolean;
}

/**
 * The listing filters, read from the frozen surface rather than restated, so a filter that drifted
 * from the one the capture used shows up here as a byte difference instead of a passing test.
 */
function frozenListingFilters(): ReadonlyMap<string, ListingFilter> {
  const surface = JSON.parse(
    readFileSync(join(AUTHORITY_ROOT, 'contracts', 'workspace-observer-command-surface-v1.json'), 'utf8'),
  ) as {
    requestFamilies: {
      id: string;
      instances: { containers?: SurfaceContainer[] };
      operations?: { key: string; filesOnly?: boolean }[];
    }[];
  };
  const filters = new Map<string, ListingFilter>();
  const f05 = surface.requestFamilies.find((f) => f.id === 'R-F-05');
  for (const c of f05?.instances.containers ?? []) {
    filters.set(listingFilterKey('R-F-05', `container:${c.key}`, ''), {
      nameFilter: c.nameFilter,
      nameFilterFlags: c.nameFilterFlags,
      onlyDirectories: c.onlyDirectories,
      dropEntryMetadata: true,
    });
  }
  const f07 = surface.requestFamilies.find((f) => f.id === 'R-F-07');
  for (const op of f07?.operations ?? []) {
    if (op.filesOnly === true) {
      filters.set(listingFilterKey('R-F-07', '', op.key), { nameFilter: null, filesOnly: true });
    }
  }
  return filters;
}

interface Bundle {
  readonly caseId?: string;
  readonly records: readonly CaptureRecord[];
}

function loadBundles(): { scope: string; records: readonly CaptureRecord[] }[] {
  const out: { scope: string; records: readonly CaptureRecord[] }[] = [];
  const global = JSON.parse(readFileSync(join(CORPUS_DIR, 'global.capture.json'), 'utf8')) as Bundle;
  out.push({ scope: 'GLOBAL', records: global.records });
  const caseDir = join(CORPUS_DIR, 'cases');
  for (const name of readdirSync(caseDir).filter((f) => f.endsWith('.capture.json')).sort()) {
    const bundle = JSON.parse(readFileSync(join(caseDir, name), 'utf8')) as Bundle;
    out.push({ scope: bundle.caseId ?? name, records: bundle.records });
  }
  return out;
}

/** A record's class, so the report can state WHICH classes the idempotence claim covers. */
function recordClass(record: CaptureRecord): string {
  return record.kind === 'PROCESS'
    ? `PROCESS ${record.requestId}`
    : `FS ${record.requestId} ${record.operation}`;
}

describe('RedactionPolicy — the frozen contract it implements', () => {
  it.skipIf(!authorityPresent)('implements the policy bytes it names', () => {
    const bytes = readFileSync(join(AUTHORITY_ROOT, 'contracts', 'redaction-truncation-policy-v1.json'));
    expect(sha256Hex(bytes)).toBe(REDACTION_POLICY_DIGEST);
    const policy = JSON.parse(bytes.toString('utf8')) as { version: string; status: string };
    expect(policy.version).toBe('1.2.0');
    expect(policy.status).toBe('FROZEN');
  });

  it('carries every credential shape the frozen policy lists, with both boundaries', () => {
    // The frozen policy's RD2 operation string enumerates ELEVEN bracketed patterns, not twelve.
    // The table is asserted against that enumeration in the frozen order, so a pattern added or
    // dropped here fails rather than quietly changing which bytes reach the corpus.
    expect(CREDENTIAL_PATTERNS.map((p) => p.kind)).toEqual([
      'ghp_token',
      'github_pat',
      'gh_token',
      'openai_key',
      'aws_key',
      'slack_token',
      'google_key',
      'jwt',
      'pem_block',
      'url_userinfo',
      'kv_secret',
    ]);
    // The three structural patterns are exempt from the token boundaries by construction: a PEM
    // block, a URL userinfo span and a key=value assignment carry their own delimiters.
    const tokenPatterns = CREDENTIAL_PATTERNS.filter(
      (p) => !['pem_block', 'url_userinfo', 'kv_secret'].includes(p.kind),
    );
    for (const p of tokenPatterns) {
      expect(p.re.source).toContain('(?<![A-Za-z0-9_-])');
    }
    // The JWT pattern is the one token shape whose right side is a structured triple rather than a
    // word boundary, which is why it is exempted from E in the frozen list.
    for (const p of tokenPatterns.filter((x) => x.kind !== 'jwt')) {
      expect(p.re.source).toContain('(?![A-Za-z0-9])');
    }
  });
});

describe('RedactionPolicy — round-trip fidelity against the frozen corpus', () => {
  it.skipIf(!authorityPresent)(
    're-applying the policy to every frozen record reproduces its bytes exactly',
    () => {
      const filters = frozenListingFilters();
      const bundles = loadBundles();
      const classes = new Map<string, number>();
      const differing: { scope: string; index: number; recordClass: string; detail: string }[] = [];
      let total = 0;

      for (const { scope, records } of bundles) {
        records.forEach((record, index) => {
          total += 1;
          const cls = recordClass(record);
          classes.set(cls, (classes.get(cls) ?? 0) + 1);
          const before = Buffer.from(canonicalBytes(record));
          const after = Buffer.from(canonicalBytes(redactRecord(record, { listingFilters: filters })));
          if (!before.equals(after)) {
            differing.push({
              scope,
              index,
              recordClass: cls,
              detail: `${before.length} -> ${after.length} bytes`,
            });
          }
        });
      }

      console.log(
        `[idempotence] records=${total} bundles=${bundles.length} classes=${classes.size} differing=${differing.length}\n` +
          [...classes.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n'),
      );
      expect(differing.slice(0, 10)).toEqual([]);
      expect(total).toBeGreaterThan(3000);
    },
    120000,
  );

  it.skipIf(!authorityPresent)('states which rules the frozen corpus can and cannot exercise', () => {
    const bundles = loadBundles();
    const applied = new Map<string, number>();
    let truncationObjects = 0;
    let base64Fields = 0;
    let maxStatusLines = 0;
    let maxStreamBytes = 0;

    for (const { records } of bundles) {
      for (const record of records) {
        for (const entry of record.redactions) {
          applied.set(entry.rule, (applied.get(entry.rule) ?? 0) + entry.count);
        }
        if (record.kind === 'PROCESS') {
          if (record.truncation !== undefined) truncationObjects += 1;
          for (const field of [record.stdout, record.stderr]) {
            if (field.encoding !== 'utf8') base64Fields += 1;
            else maxStreamBytes = Math.max(maxStreamBytes, Buffer.byteLength(field.data, 'utf8'));
          }
          if (record.requestId === 'R-W-04' && record.stdout.encoding === 'utf8') {
            maxStatusLines = Math.max(maxStatusLines, splitLines(record.stdout.data).length);
          }
        } else if (record.result.content !== undefined && record.result.content.encoding !== 'utf8') {
          base64Fields += 1;
        }
      }
    }

    console.log(
      `[corpus coverage] applied=${JSON.stringify(Object.fromEntries(applied))} ` +
        `truncationObjects=${truncationObjects} base64Fields=${base64Fields} ` +
        `maxStatusLines=${maxStatusLines}/${TR1_LINE_LIMIT} maxStreamBytes=${maxStreamBytes}/${TR2_BYTE_LIMIT}`,
    );

    // RD1 and RD8 are the only rules the corpus exercises. The rest are frozen but unexercised, and
    // that is stated here as a measured fact rather than assumed from the handoff report.
    expect(applied.has(RULES.RD1)).toBe(true);
    expect(applied.has(RULES.RD8)).toBe(true);
    expect(applied.has(RULES.RD2)).toBe(false);
    expect(truncationObjects).toBe(0);
    expect(maxStatusLines).toBeLessThan(TR1_LINE_LIMIT);
    expect(maxStreamBytes).toBeLessThan(TR2_BYTE_LIMIT);
  });
});

describe('RD1_UNTRACKED_PATHS', () => {
  it('numbers placeholders by order of appearance and preserves the directory indicator', () => {
    const status = ['# branch.oid abc', '? .env', '? exports/', '1 M. N... 0 0 0 a b src/x.ts', '? p.pdf'].join(
      '\n',
    );
    const out = applyUntrackedPaths(`${status}\n`);
    expect(out.count).toBe(3);
    expect(splitLines(out.text)).toEqual([
      '# branch.oid abc',
      '? <UNTRACKED_1>',
      '? <UNTRACKED_2>/',
      '1 M. N... 0 0 0 a b src/x.ts',
      '? <UNTRACKED_3>',
    ]);
    // The trailing newline is part of git's output and part of the digested bytes.
    expect(out.text.endsWith('\n')).toBe(true);
  });

  it('is a fixed point on its own output', () => {
    const once = applyUntrackedPaths('? a/b/c\n? d/\n');
    const twice = applyUntrackedPaths(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(once.count);
  });

  it('aborts rather than record raw untracked names from a base64 status stream', () => {
    const record: ProcessCaptureRecord = {
      requestId: 'R-W-04',
      instanceKey: 'ws-c-x-00000000',
      kind: 'PROCESS',
      executable: 'git',
      argv: ['-C', 'C:\\x', 'status'],
      cwd: 'C:\\repo',
      env: {},
      outcome: 'COMPLETED',
      exitCode: 0,
      signal: null,
      spawnErrorCode: null,
      stdout: { encoding: 'base64', data: 'AAECAw==' },
      stderr: { encoding: 'utf8', data: '' },
      redactions: [],
      nonNfcFields: [],
    };
    expect(() => redactRecord(record)).toThrow(RedactionAbort);
    expect(() => redactRecord(record)).toThrow(/RD1_STATUS_STREAM_NOT_UTF8/);
  });
});

describe('RD2_CREDENTIAL_SHAPES', () => {
  it('does NOT match a credential shape inside a ref name (the codex/task-* false positive)', () => {
    // This is the regression the 1.1.0 amendment was written for: without the left boundary the
    // OpenAI pattern matched inside the branch name and destroyed the branch-reuse evidence A14
    // depends on.
    const line = 'worktree C:\\wt-a\nbranch refs/heads/codex/task-sk-0123456789abcdefghijklmn\n';
    const out = applyCredentialShapes(line);
    expect(out.count).toBe(0);
    expect(out.text).toBe(line);
  });

  it('does match a real key at a token boundary', () => {
    const out = applyCredentialShapes('error: bad key sk-0123456789abcdefghijklmn used');
    expect(out.count).toBe(1);
    expect(out.kinds).toEqual(['openai_key']);
    expect(out.text).toBe('error: bad key <REDACTED:openai_key> used');
  });

  it('replaces every frozen shape with its kind label and never with the value', () => {
    const cases: { input: string; kind: string; expected: string }[] = [
      {
        input: 'ghp_abcdefghij0123456789',
        kind: 'ghp_token',
        expected: '<REDACTED:ghp_token>',
      },
      {
        input: 'github_pat_abcdefghij0123456789',
        kind: 'github_pat',
        expected: '<REDACTED:github_pat>',
      },
      { input: 'gho_abcdefghij0123456789', kind: 'gh_token', expected: '<REDACTED:gh_token>' },
      { input: 'AKIA0123456789ABCDEF', kind: 'aws_key', expected: '<REDACTED:aws_key>' },
      {
        input: 'xoxb-0123456789abcdef',
        kind: 'slack_token',
        expected: '<REDACTED:slack_token>',
      },
      {
        input: 'AIza0123456789abcdefghij0123456789abcde',
        kind: 'google_key',
        expected: '<REDACTED:google_key>',
      },
      {
        input: 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4',
        kind: 'jwt',
        expected: '<REDACTED:jwt>',
      },
      {
        input: '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
        kind: 'pem_block',
        expected: '<REDACTED:pem_block>',
      },
    ];
    for (const c of cases) {
      const out = applyCredentialShapes(`before ${c.input} after`);
      expect({ kind: c.kind, text: out.text }).toEqual({
        kind: c.kind,
        text: `before ${c.expected} after`,
      });
      expect(out.kinds).toContain(c.kind);
    }
  });

  it('keeps the key and separator for a secret-shaped assignment, and the userinfo host', () => {
    expect(applyCredentialShapes('token=hunter2').text).toBe('token=<REDACTED:kv_secret>');
    expect(applyCredentialShapes('api_key: s3cr3t').text).toBe('api_key: <REDACTED:kv_secret>');
    expect(applyCredentialShapes('remote https://user:hunter2@github.com/x.git').text).toBe(
      'remote https://<REDACTED:url_userinfo>@github.com/x.git',
    );
  });

  it('exposes the one span the frozen kv_secret rule leaves behind', () => {
    // `(\S+)` is ONE whitespace-delimited token, so a two-token scheme-plus-credential header
    // (`Authorization: Bearer <token>`) has its scheme redacted and its credential left in place.
    // The credential survives here only because no token pattern in the table matches this shape;
    // an opaque bearer token that matched none of the twelve would reach the corpus.
    expect(applyCredentialShapes('Authorization: Bearer abc.def').text).toBe(
      'Authorization: <REDACTED:kv_secret> abc.def',
    );
    // A bearer whose value IS a recognised shape is still caught, by the shape rule not by kv_secret.
    expect(applyCredentialShapes('Authorization: Bearer ghp_abcdefghij0123456789').text).toBe(
      'Authorization: <REDACTED:kv_secret> <REDACTED:ghp_token>',
    );
  });

  it('never matches a 40-hex or 64-hex string, which are the evidence', () => {
    const sha = '9650d07397a813da4a5b3556ae7c777ddbfe7d11';
    const digest = 'e6c7cd9d3ac08444f9c32a8eb4b05184b0bf78d3d41470906093f737f5e2ed11';
    expect(applyCredentialShapes(`${sha} ${digest}`).count).toBe(0);
  });

  it('is a fixed point on its redacted TEXT for every single-rule case', () => {
    for (const input of [
      'sk-0123456789abcdefghijklmn',
      'ghp_abcdefghij0123456789',
      'https://user:pw@host/x',
      'password = hunter2',
    ]) {
      const once = applyCredentialShapes(input);
      const twice = applyCredentialShapes(once.text);
      expect(twice.text).toBe(once.text);
    }
  });

  it('exposes the one place the frozen composition is NOT count-stable', () => {
    // Two rules touching the same span. The redacted TEXT is a fixed point, the recorded COUNT is
    // not: the token rule matched on pass one and only kv_secret matches on pass two. Recorded here
    // rather than hidden, because `redactions` counts are themselves digest-covered evidence.
    const once = applyCredentialShapes('token=ghp_abcdefghij0123456789');
    expect(once.text).toBe('token=<REDACTED:kv_secret>');
    expect(once.count).toBe(2);
    const twice = applyCredentialShapes(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(1);
  });
});

describe('RD6_KEY_FIELD_CREDENTIAL_SHAPE', () => {
  const base: ProcessCaptureRecord = {
    requestId: 'R-W-01',
    instanceKey: 'ws-c-x-00000000',
    kind: 'PROCESS',
    executable: 'git',
    argv: ['-C', 'C:\\wt', 'rev-parse', 'HEAD'],
    cwd: 'C:\\repo',
    env: {},
    outcome: 'COMPLETED',
    exitCode: 0,
    signal: null,
    spawnErrorCode: null,
    stdout: { encoding: 'utf8', data: '' },
    stderr: { encoding: 'utf8', data: '' },
    redactions: [],
    nonNfcFields: [],
  };

  it('never rewrites argv, cwd or path even when they carry credential-shaped text', () => {
    const record = { ...base, argv: ['-C', 'C:\\wt-codex-task-sk-abc', 'rev-parse'] };
    const out = redactRecord(record) as ProcessCaptureRecord;
    expect(out.argv).toEqual(record.argv);
    expect(out.cwd).toBe(record.cwd);
  });

  it('aborts naming requestId and instanceKey when argv really does carry a credential', () => {
    const record = { ...base, argv: ['-C', 'C:\\a sk-0123456789abcdefghijklmn', 'rev-parse'] };
    let thrown: KeyFieldCredentialShape | undefined;
    try {
      redactRecord(record);
    } catch (e) {
      thrown = e as KeyFieldCredentialShape;
    }
    expect(thrown).toBeInstanceOf(KeyFieldCredentialShape);
    expect(thrown?.code).toBe('RD6_KEY_FIELD_CREDENTIAL_SHAPE');
    expect(thrown?.requestId).toBe('R-W-01');
    expect(thrown?.instanceKey).toBe('ws-c-x-00000000');
    expect(thrown?.kind).toBe('openai_key');
  });

  it('aborts on a filesystem path too', () => {
    const record: CaptureRecord = {
      requestId: 'R-F-06',
      instanceKey: 'ws-c-x-00000000',
      kind: 'FS',
      operation: 'LSTAT',
      opKey: 'lstat',
      path: 'C:\\dumps\\AKIA0123456789ABCDEF',
      result: { outcome: 'COMPLETED', errorCode: null, exists: true, type: 'dir' },
      redactions: [],
      nonNfcFields: [],
    };
    expect(() => redactRecord(record)).toThrow(/RD6_KEY_FIELD_CREDENTIAL_SHAPE.*field=path.*aws_key/s);
  });
});

describe('RD8_REFLOG_IDENTITY', () => {
  const line = (id: string): string =>
    `5178c673263d7fa6aa11bc40aa3ff410f7e13377 b2f7ea9b8fe6fd43fb7829b39eafebca747d32e0 ${id} 1786624962 +0200\tupdate by push`;

  it('replaces the identity and keeps both SHAs, the epoch, the offset and the message', () => {
    const out = applyReflogIdentity(`${line('Jane Doe <jane@example.com>')}\n`);
    expect(out.count).toBe(1);
    expect(splitLines(out.text)).toEqual([line('<REDACTED:identity>')]);
  });

  it('is a fixed point on an already-redacted reflog', () => {
    const once = applyReflogIdentity(`${line('Jane Doe <jane@example.com>')}\n`);
    const twice = applyReflogIdentity(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(once.count);
  });

  it('leaves a non-reflog line alone', () => {
    const other = 'not a reflog line at all\n';
    expect(applyReflogIdentity(other)).toEqual({ text: other, count: 0 });
  });
});

describe('TR1_LINE_LIMIT_STATUS', () => {
  function bigStatus(changed: number, renamed: number): string {
    const lines = ['# branch.oid abc', '# branch.head main'];
    for (let i = 0; i < changed; i += 1) {
      lines.push(`1 M. N... 100644 100644 100644 aaaa bbbb src/file-${i}.ts`);
    }
    for (let i = 0; i < renamed; i += 1) {
      lines.push(`2 R. N... 100644 100644 100644 aaaa bbbb R100 new-${i}.ts\told-${i}.ts`);
    }
    lines.push('u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.ts');
    lines.push('? untracked.txt');
    return `${lines.join('\n')}\n`;
  }

  it('does nothing at or below the 400-line threshold', () => {
    const out = applyStatusLineLimit(bigStatus(300, 0));
    expect(out.truncation).toBeUndefined();
  });

  it('elides paths beyond line 400 without dropping a single line', () => {
    const text = bigStatus(430, 10);
    const before = splitLines(text);
    const out = applyStatusLineLimit(text);
    const after = splitLines(out.text);

    expect(after).toHaveLength(before.length);
    expect(out.truncation?.rule).toBe(RULES.TR1);
    expect(out.truncation?.originalLines).toBe(before.length);
    // Header, untracked and every line inside the first 400 keep their paths verbatim.
    expect(after[0]).toBe('# branch.oid abc');
    expect(after[399]).toBe(before[399]);
    expect(after[400]).toContain('<ELIDED_PATH_1>');
    expect(after.filter((l) => l.startsWith('? '))).toEqual(['? untracked.txt']);
    // Counts are the safety-relevant fact and are exact, not estimated.
    expect(out.truncation?.lineClassCounts).toEqual({
      headerLines: 2,
      changedLines: 430,
      renamedLines: 10,
      unmergedLines: 1,
      untrackedLines: 1,
      ignoredLines: 0,
    });
    // A rename line carries two path fields; both go, under the line's own ordinal.
    const renamed = after.find((l) => l.startsWith('2 ') && l.includes('<ELIDED_PATH_'));
    expect(renamed).toBeDefined();
    expect(renamed?.split('\t')).toHaveLength(2);
    expect(renamed?.split('\t')[0].endsWith(renamed.split('\t')[1])).toBe(true);
    // The unmerged line keeps all ten fields and loses only the path.
    const unmerged = after.find((l) => l.startsWith('u '));
    expect(unmerged).toBe(
      `u UU N... 100644 100644 100644 100644 aaaa bbbb cccc <ELIDED_PATH_${out.truncation?.elidedPathLines ?? 0}>`,
    );
  });

  it('is a fixed point on its own output', () => {
    const once = applyStatusLineLimit(bigStatus(430, 10));
    const twice = applyStatusLineLimit(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.truncation).toEqual(once.truncation);
  });
});

describe('TR2_BYTE_LIMIT_STDOUT', () => {
  /**
   * A stream whose byte at the limit falls INSIDE a multi-byte character. 'ö' is two bytes, so a
   * line of 'ö' repeated puts a continuation byte at every odd offset; the limit is chosen to land
   * on one.
   */
  function multibyteStream(limit: number): string {
    const line = `${'ö'.repeat(50)}\n`; // 101 bytes per line
    let text = '';
    while (Buffer.byteLength(text, 'utf8') <= limit + 500) text += line;
    return text;
  }

  it('cuts on a character boundary and then on a line boundary, and the result is well-formed', () => {
    const limit = 1001; // lands inside the second byte of an 'ö'
    const text = multibyteStream(limit);
    const out = applyByteLimit(text, undefined, limit);

    expect(out.truncation?.rule).toBe(RULES.TR2);
    expect(out.text.endsWith('\n')).toBe(true);
    expect(Buffer.byteLength(out.text, 'utf8')).toBeLessThanOrEqual(limit);
    expect(isWellFormed(out.text)).toBe(true);
    // The decisive assertion: no U+FFFD was manufactured by the cut.
    expect(out.text.includes('\ufffd')).toBe(false);
    // Round-tripping the kept text must reproduce a prefix of the original bytes exactly.
    const keptBytes = Buffer.from(out.text, 'utf8');
    expect(Buffer.from(text, 'utf8').subarray(0, keptBytes.length).equals(keptBytes)).toBe(true);
  });

  it('preserves the original byte and line counts, which are never reduced', () => {
    const limit = 1001;
    const text = multibyteStream(limit);
    const out = applyByteLimit(text, undefined, limit);
    expect(out.truncation?.originalBytes).toBe(Buffer.byteLength(text, 'utf8'));
    expect(out.truncation?.originalLines).toBe(splitLines(text).length);
    expect(out.truncation?.keptBytes).toBe(Buffer.byteLength(out.text, 'utf8'));
    expect(out.truncation?.keptLines).toBe(splitLines(out.text).length);
    expect(out.truncation?.originalBytes).toBeGreaterThan(out.truncation?.keptBytes ?? 0);
  });

  it('retains an earlier size limit rather than overwriting it', () => {
    // The port's 64 MiB output limit and TR2 always co-occur when they occur at all, and the frozen
    // schema has one truncation object per record to say so in.
    const out = applyByteLimit(multibyteStream(1001), 'TR4_OUTPUT_LIMIT_EXCEEDED', 1001);
    expect(out.truncation?.priorRule).toBe('TR4_OUTPUT_LIMIT_EXCEEDED');
  });

  it('does nothing at or below the limit and omits the truncation object entirely', () => {
    const out = applyByteLimit('short\n', undefined, TR2_BYTE_LIMIT);
    expect(out.text).toBe('short\n');
    expect(out.truncation).toBeUndefined();
    expect(Object.keys(out)).toEqual(['text']);
  });

  it('is a fixed point on its own output', () => {
    const once = applyByteLimit(multibyteStream(1001), undefined, 1001);
    const twice = applyByteLimit(once.text, undefined, 1001);
    expect(twice.text).toBe(once.text);
    expect(twice.truncation).toBeUndefined();
  });
});

describe('RD4_DISCOVERY_NAME_FILTER / RD5_CANDIDATE_DIR_CONTENTS', () => {
  const filter: ListingFilter = {
    nameFilter: '^(wt-|lu-|milj|rc8-|verify-)',
    nameFilterFlags: 'i',
    onlyDirectories: true,
    dropEntryMetadata: true,
  };

  it('records only matching names and keeps the unfiltered total visible', () => {
    const result = applyListingFilter(
      {
        outcome: 'COMPLETED',
        errorCode: null,
        entries: [
          { name: 'wt-a', type: 'dir', size: null, mtimeMs: 1 },
          { name: 'Documents', type: 'dir', size: null, mtimeMs: 2 },
          { name: 'wt-b.txt', type: 'file', size: 5, mtimeMs: 3 },
          { name: 'MILJöbeslut', type: 'dir', size: null, mtimeMs: 4 },
        ],
        totalEntryCount: 4,
        matchedEntryCount: 4,
      },
      filter,
    );
    expect(result.entries).toEqual([
      { name: 'wt-a', type: 'dir' },
      { name: 'MILJöbeslut', type: 'dir' },
    ]);
    // The blind spot A20 accepts is only visible as total minus matched; reducing the total would
    // silently claim there was nothing to miss.
    expect(result.totalEntryCount).toBe(4);
    expect(result.matchedEntryCount).toBe(2);
  });

  it('is a fixed point on an already-filtered listing', () => {
    const once = applyListingFilter(
      {
        outcome: 'COMPLETED',
        errorCode: null,
        entries: [{ name: 'wt-a', type: 'dir' }],
        totalEntryCount: 115,
        matchedEntryCount: 1,
      },
      filter,
    );
    const twice = applyListingFilter(once, filter);
    expect(twice).toEqual(once);
    expect(twice.totalEntryCount).toBe(115);
  });

  it('leaves a READDIR_COUNT result untouched: it never had names to remove', () => {
    const result = { outcome: 'COMPLETED' as const, errorCode: null, entryCount: 134 };
    expect(applyListingFilter(result, filter)).toBe(result);
  });
});
