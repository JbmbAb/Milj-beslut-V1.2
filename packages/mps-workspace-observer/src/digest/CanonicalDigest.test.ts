/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the pin and the payload restrictions (spec A11, B6).
 *
 * Two questions, and nothing else:
 *
 *  1. Is the primitive this module reuses still the one Phase 0 froze? A11 pins
 *     @miljobeslut/mps-canonical 0.1.0 by the SHA-256 of seven source files. Without this test the
 *     pin is a comment: someone edits CanonicalString.ts for an unrelated reason, the emitted bytes
 *     shift, and every frozen captureDigest silently becomes wrong while every suite stays green.
 *     The primitivePin exists precisely so that such a change is a schemaId retirement decision
 *     (behaviourChangeRule) rather than an invisible event.
 *
 *  2. Does validatePayload actually refuse P1-P6? The restrictions are what make the primitive's
 *     lossy cases unreachable. A restriction that is documented but not enforced is worse than no
 *     restriction, because the documentation is then evidence for a property that does not hold.
 *
 * The frozen contract is read from the read-only authority mirror. Where the mirror is absent the
 * mirror-bound suites SKIP and say so, exactly as the harness suites do: an acceptance report must
 * be able to state AUTHORITY_PRESENT: NO rather than silently show green. The pin is therefore
 * asserted a second time against the copy published in snapshot-digest-v1.json, which is in the
 * repository and always present, so a substituted primitive fails on every machine either way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DOMAINS,
  canonicalBytes,
  framePreimage,
  framedDigest,
  nonNfcPaths,
  sha256Hex,
  validatePayload,
} from './CanonicalDigest.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';

const CONTRACT_PATH = join(AUTHORITY_ROOT, 'contracts', 'canonicalizer-contract-v1.json');
const CAPTURE_VECTORS_PATH = join(
  AUTHORITY_ROOT,
  'contracts',
  'canonicalizer-capture-test-vectors-v1.json',
);
const authorityPresent = existsSync(CONTRACT_PATH);

/** The repository root, reached from this file rather than from process.cwd(), which vitest owns. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const DIGEST_ARTIFACT_PATH = fileURLToPath(
  new URL('../../contracts/snapshot-digest-v1.json', import.meta.url),
);

interface PrimitivePin {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly canonicalBaseSha: string;
  readonly sourceSha256: Readonly<Record<string, string>>;
  readonly behaviourChangeRule: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Recompute each pinned file's digest from the repository.
 *
 * Read as raw bytes, never as a decoded-and-re-encoded string: the pin is over the file's exact
 * bytes, so a BOM or a CRLF conversion must show up as a mismatch rather than be normalised away
 * by the reader.
 */
function recomputePin(sourceSha256: Readonly<Record<string, string>>): Record<string, string> {
  const got: Record<string, string> = {};
  for (const relPath of Object.keys(sourceSha256)) {
    got[relPath] = sha256Hex(readFileSync(join(REPO_ROOT, relPath)));
  }
  return got;
}

describe('primitive pin', () => {
  it('publishes the frozen pin unchanged in snapshot-digest-v1.json, and the repository reproduces all seven files', () => {
    const artifact = readJson<{ primitivePin: PrimitivePin }>(DIGEST_ARTIFACT_PATH);
    const pin = artifact.primitivePin;

    expect(pin.packageName).toBe('@miljobeslut/mps-canonical');
    expect(pin.packageVersion).toBe('0.1.0');
    expect(Object.keys(pin.sourceSha256)).toHaveLength(7);
    expect(recomputePin(pin.sourceSha256)).toEqual(pin.sourceSha256);
  });

  it.skipIf(!authorityPresent)(
    'matches the Phase 0-frozen canonicalizer contract for all seven files',
    () => {
      const frozen = readJson<{ primitivePin: PrimitivePin }>(CONTRACT_PATH).primitivePin;
      const artifact = readJson<{ primitivePin: PrimitivePin }>(DIGEST_ARTIFACT_PATH).primitivePin;

      // The published pin must be the frozen pin verbatim, not a re-derivation that happens to
      // agree today. A re-derived pin agrees with whatever the working tree contains, which is the
      // one thing the pin is supposed to be able to disagree with.
      expect(artifact.sourceSha256).toEqual(frozen.sourceSha256);
      expect(artifact.canonicalBaseSha).toBe(frozen.canonicalBaseSha);
      expect(artifact.behaviourChangeRule).toBe(frozen.behaviourChangeRule);

      expect(recomputePin(frozen.sourceSha256)).toEqual(frozen.sourceSha256);
    },
  );

  it.skipIf(!authorityPresent)(
    'reproduces every conformance vector of the frozen capture vector set',
    () => {
      // The file-digest check above proves the SOURCE is unchanged. This proves the BEHAVIOUR is:
      // a runtime or dependency change that shifts the emitted bytes leaves all seven digests
      // intact, and behaviourChangeRule calls that a new-schemaId event, so it has to be caught by
      // re-deriving the frozen digests rather than by hashing files.
      const set = readJson<{
        vectors: readonly {
          id: string;
          conformance: boolean;
          schemaId: string;
          input: unknown;
          expectedCanonicalHex: string;
          expectedPreimageHex: string;
          expectedDigest: string;
        }[];
      }>(CAPTURE_VECTORS_PATH);

      const conformance = set.vectors.filter((v) => v.conformance);
      expect(conformance.length).toBeGreaterThanOrEqual(19);

      const failures: string[] = [];
      for (const v of conformance) {
        const bytes = canonicalBytes(v.input);
        const preimage = framePreimage(v.schemaId, bytes);
        const digest = framedDigest(v.schemaId, v.input).digest;
        if (Buffer.from(bytes).toString('hex') !== v.expectedCanonicalHex) {
          failures.push(`${v.id}: canonical bytes differ`);
        }
        if (preimage.toString('hex') !== v.expectedPreimageHex) {
          failures.push(`${v.id}: preimage differs`);
        }
        if (digest !== v.expectedDigest) failures.push(`${v.id}: digest differs`);
      }
      expect(failures).toEqual([]);
    },
  );
});

describe('payload restrictions P1-P6', () => {
  /** The first violation for a payload, or undefined. Every case below must produce exactly one. */
  function only(value: unknown): { path: string; rule: string } {
    const violations = validatePayload(value);
    expect(violations).toHaveLength(1);
    return { path: violations[0].path, rule: violations[0].rule };
  }

  it('P1 rejects undefined, because absence is encoded by omission', () => {
    expect(only({ headSha: undefined })).toEqual({ path: '$.headSha', rule: 'NO_UNDEFINED' });
    expect(only([undefined])).toEqual({ path: '$[0]', rule: 'NO_UNDEFINED' });
  });

  it('P2 rejects non-finite numbers, which would collapse to null', () => {
    expect(only({ n: Number.NaN }).rule).toBe('FINITE_NUMBER');
    expect(only({ n: Number.POSITIVE_INFINITY }).rule).toBe('FINITE_NUMBER');
    expect(only({ n: Number.NEGATIVE_INFINITY }).rule).toBe('FINITE_NUMBER');
  });

  it('P2 rejects numbers outside the safe-integer domain, which would lose precision', () => {
    expect(only({ n: Number.MAX_SAFE_INTEGER + 2 }).rule).toBe('SAFE_INTEGER');
    expect(only({ n: -(Number.MAX_SAFE_INTEGER + 2) }).rule).toBe('SAFE_INTEGER');
    expect(only({ n: 1.5 }).rule).toBe('SAFE_INTEGER');
    // The boundary itself is admissible, and negative zero is a safe integer: R7 documents the
    // collapse to 0 rather than removing it, so the validator must not reject it.
    expect(validatePayload({ n: Number.MAX_SAFE_INTEGER, m: -0 })).toEqual([]);
  });

  it('P3 rejects lone surrogates', () => {
    expect(only({ s: '\ud800' }).rule).toBe('WELL_FORMED_STRING');
    expect(only({ s: '\udc00' }).rule).toBe('WELL_FORMED_STRING');
    expect(only({ s: 'a\ud83d' }).rule).toBe('WELL_FORMED_STRING');
    // A well-formed surrogate pair is an ordinary string.
    expect(validatePayload({ s: '\ud83d\ude00' })).toEqual([]);
  });

  it('P4 rejects keys whose emission order is not their sorted order', () => {
    // Integer-like keys are the concrete hazard: JSON.stringify emits them first in ascending
    // numeric order regardless of the sort, so a re-implementation that sorts would disagree.
    expect(only({ '0': 1 }).rule).toBe('ASCII_KEY');
    expect(only({ '42': 1 }).rule).toBe('ASCII_KEY');
    expect(only({ 'nyckel-\u00e5': 1 }).rule).toBe('ASCII_KEY');
    expect(only({ 'a b': 1 }).rule).toBe('ASCII_KEY');
    // Keys the frozen policy actually produces: git config keys carry dots, request ids carry
    // hyphens, and the observation ledger keys carry colons.
    expect(validatePayload({ 'core.ignorecase': 1, 'R-W-07': 2, 'a:b': 3, _x: 4 })).toEqual([]);
  });

  it('P4 rejects the three prototype-poisoning keys by name', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const value = Object.defineProperty({}, key, { value: 1, enumerable: true, writable: true });
      const violations = validatePayload(value);
      expect(violations.map((v) => v.rule)).toContain('FORBIDDEN_KEY');
    }
  });

  it('P5 rejects every non-JSON value type', () => {
    expect(only({ n: 1n }).rule).toBe('NO_BIGINT');
    expect(only({ f: () => 1 }).rule).toBe('UNSUPPORTED_TYPE');
    expect(only({ s: Symbol('x') }).rule).toBe('UNSUPPORTED_TYPE');
    // Date and Uint8Array are transformed, Map and Set collapse to {}: each is a silent loss.
    expect(only({ d: new Date(0) }).rule).toBe('NO_DATE_BINARY_MAP_SET');
    expect(only({ b: new Uint8Array([1]) }).rule).toBe('NO_DATE_BINARY_MAP_SET');
    expect(only({ m: new Map() }).rule).toBe('NO_DATE_BINARY_MAP_SET');
    expect(only({ s: new Set() }).rule).toBe('NO_DATE_BINARY_MAP_SET');
  });

  it('P5 rejects class instances, which serialize only their own enumerable properties', () => {
    class Observation {
      readonly state = 'OBSERVED';
      get derived(): string {
        return 'lost';
      }
    }
    expect(only({ o: new Observation() }).rule).toBe('PLAIN_OBJECT');
    // A null-prototype object is explicitly admissible.
    expect(validatePayload(Object.assign(Object.create(null) as object, { a: 1 }))).toEqual([]);
  });

  it('P6 rejects cycles, which make the serializer throw rather than reject', () => {
    const cyclicObject: Record<string, unknown> = {};
    cyclicObject.self = cyclicObject;
    expect(only(cyclicObject)).toEqual({ path: '$.self', rule: 'NO_CYCLES' });

    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    expect(only(cyclicArray)).toEqual({ path: '$[0]', rule: 'NO_CYCLES' });
  });

  it('canonicalBytes refuses a violating payload instead of digesting it', () => {
    expect(() => canonicalBytes({ n: Number.NaN })).toThrow(/violates canonicalizer contract/);
  });

  it('P7 is reported, not silently applied: nonNfcPaths names the fields instead of rewriting them', () => {
    // Normalising a replay-key path would turn every replay of that case into a corpus miss, so
    // the frozen rule is to stop for adjudication. validatePayload therefore stays silent here.
    const nfd = { path: 'C:\\miljo\u0308beslut' };
    expect(validatePayload(nfd)).toEqual([]);
    expect(nonNfcPaths(nfd)).toEqual(['$.path']);
    expect(nonNfcPaths({ path: 'C:\\milj\u00f6beslut' })).toEqual([]);
  });
});

describe('domain framing', () => {
  it('accepts only the two frozen domains as schemaId constants', () => {
    expect(DOMAINS).toEqual({
      CAPTURE_BUNDLE_V1: 'CAPTURE_BUNDLE_V1',
      SNAPSHOT_V1: 'SNAPSHOT_V1',
    });
  });

  it('rejects a schemaId outside the acceptance rule', () => {
    for (const bad of ['', 'snapshot_v1', '1SNAPSHOT', 'SNAPSHOT-V1', 'A'.repeat(65)]) {
      expect(() => framePreimage(bad, new Uint8Array())).toThrow(/not acceptable/);
    }
  });

  it('length-prefixes both components, so no domain preimage is a prefix of another', () => {
    const payload = canonicalBytes({});
    const short = framePreimage('SNAPSHOT_V1', payload).toString('hex');
    const long = framePreimage('SNAPSHOT_V11', payload).toString('hex');
    expect(long.startsWith(short)).toBe(false);
    expect(short.startsWith(long)).toBe(false);
    // uint32be(11) || 'SNAPSHOT_V1' || uint32be(2) || '{}'
    expect(short).toBe('0000000b534e415053484f545f5631000000027b7d');
  });
});
