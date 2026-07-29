import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  FileCASRepository,
  canonicalizeStrict,
  hashBytes,
  hashCanonicalValue,
  hashSerialized,
} from '@miljobeslut/mimers-brunn-core';

describe('Byte-CAS putBytes / getBytes / putCanonical', () => {
  let dir: string;
  let cas: FileCASRepository;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-cas-bytes-'));
    cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('putBytes/getBytes roundtrip for non-UTF8 binary payload', async () => {
    const payload = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x01, 0xc0]);
    const result = await cas.putBytes(payload);
    expect(result.hash).toBe(hashBytes(payload));
    expect(result.size).toBe(6);
    expect(result.existed).toBe(false);

    const loaded = await cas.getBytes(result.hash, { verifyHash: true });
    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!).equals(Buffer.from(payload))).toBe(true);
  });

  it('putCanonical matches legacy put digest and put alias', async () => {
    const obj = { b: 2, a: 1, nested: { z: true, y: null } };
    const expected = hashCanonicalValue(obj);

    const viaCanonical = await cas.putCanonical(obj);
    expect(viaCanonical.hash).toBe(expected);

    const viaPut = await cas.put(obj);
    expect(viaPut.hash).toBe(expected);
    expect(viaPut.existed).toBe(true);

    const viaSerialized = await cas.putSerialized(canonicalizeStrict(obj));
    expect(viaSerialized.hash).toBe(expected);
    expect(viaSerialized.existed).toBe(true);

    const parsed = await cas.get<typeof obj>(viaCanonical.hash, { verifyHash: true });
    expect(parsed).toEqual(obj);
  });

  it('getBytes is copy-on-read (cache isolation)', async () => {
    const payload = Uint8Array.from([1, 2, 3, 4]);
    const { hash } = await cas.putBytes(payload);

    const first = await cas.getBytes(hash);
    expect(first).not.toBeNull();
    first![0] = 99;

    const second = await cas.getBytes(hash);
    expect(second![0]).toBe(1);
  });

  it('verifyStoredObject hashes raw bytes for binary objects', async () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const { hash, size } = await cas.putBytes(payload);
    const verified = await cas.verifyStoredObject(hash);
    expect(verified).toEqual({ ok: true, size });
  });

  it('collision path returns existed for identical bytes', async () => {
    const payload = Uint8Array.from([9, 8, 7]);
    const first = await cas.putBytes(payload);
    const second = await cas.putBytes(payload);
    expect(first.hash).toBe(second.hash);
    expect(second.existed).toBe(true);
  });

  it('hashSerialized and hashBytes stay consistent for UTF-8 strings', () => {
    const s = '{"a":1}';
    expect(hashSerialized(s)).toBe(hashBytes(Buffer.from(s, 'utf-8')));
  });
});
