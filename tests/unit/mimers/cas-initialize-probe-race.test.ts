import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCASRepository } from '@miljobeslut/mimers-brunn-core';

/**
 * U30-A: FileCASRepository.initialize() proves that tmp/ and objects/ share a filesystem by
 * hard-linking a probe file. The probe used ONE fixed name (`.fs_assertion_dummy`) in both
 * directories, so two processes initializing the same CAS root at the same moment (the web
 * process and the four LU workers on start) raced: one link failed with EEXIST, or one unlink
 * removed the other's probe (ENOENT), and initialize() threw "[P-05] ... Link failed" -- a
 * filesystem-integrity error for what was only a name collision (observed in the M0 runtime).
 *
 * Concurrent initialize() calls on separate instances over the same directory reproduce the
 * same collision inside one test process.
 */
describe('FileCASRepository.initialize() probe is collision-free (U30-A)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-cas-probe-race-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('32 concurrent initialize() calls on one CAS root all succeed', async () => {
    const instances = Array.from({ length: 32 }, () => new FileCASRepository(dir, { durabilityMode: 'none' }));
    const results = await Promise.allSettled(instances.map((cas) => cas.initialize()));
    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason instanceof Error ? r.reason.message : r.reason));
    expect(failures).toEqual([]);
  });

  it('leaves no probe files behind and the CAS still stores and enumerates objects', async () => {
    const instances = Array.from({ length: 8 }, () => new FileCASRepository(dir, { durabilityMode: 'none' }));
    await Promise.all(instances.map((cas) => cas.initialize()));

    expect(await readdir(path.join(dir, 'tmp'))).toEqual([]);
    const sha256Entries = await readdir(path.join(dir, 'objects', 'sha256'));
    expect(sha256Entries.filter((name) => name.startsWith('.fs_assertion'))).toEqual([]);

    const put = await instances[0]!.putBytes(Buffer.from('probe-race-payload'));
    const digests: string[] = [];
    for await (const digest of instances[1]!.streamObjectDigests()) digests.push(digest);
    expect(digests).toEqual([put.hash]);
  });
});
