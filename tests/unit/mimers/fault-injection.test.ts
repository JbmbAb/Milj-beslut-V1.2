import { mkdtemp, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CASIntegrityError,
  DurabilityError,
  EvolutionLedger,
  FileCASRepository,
  InMemoryEventLog,
  LocalPemSigningKeyProvider,
  RecoveryOrchestrator,
  createArtifactAttestation,
  generateUUIDv7,
  verifyArtifactAttestation,
  verifyLedgerHashChain,
  verifyPromotionSignature,
  type CommitStrategy,
  type EventLog,
  type LedgerEventInput,
  type MimersBrunnManifest,
  type MimersLedgerEvent,
} from '@miljobeslut/mimers-brunn-core';

function errno(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** Simulates crash / errno outcomes at the CommitStrategy boundary. */
class FaultyCommitStrategy implements CommitStrategy {
  constructor(
    private readonly mode:
      | 'crash-before-commit'
      | 'eexist-same'
      | 'eexist-corrupt'
      | 'exdev'
      | 'fsync-fail'
      | 'pass-through',
  ) {}

  async commit(tempPath: string, destinationPath: string): Promise<void> {
    switch (this.mode) {
      case 'crash-before-commit':
        throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
      case 'eexist-same': {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(tempPath, destinationPath);
        throw errno('EEXIST', 'SIMULATED_EEXIST');
      }
      case 'eexist-corrupt': {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, '{"not":"the-same-bytes"}', 'utf-8');
        throw errno('EEXIST', 'SIMULATED_EEXIST_CORRUPT');
      }
      case 'exdev':
        throw errno('EXDEV', 'SIMULATED_EXDEV');
      case 'fsync-fail': {
        await fs.link(tempPath, destinationPath);
        throw new DurabilityError('SIMULATED_DIR_FSYNC_FAILURE');
      }
      case 'pass-through':
        await fs.link(tempPath, destinationPath);
        return;
      default: {
        const _exhaustive: never = this.mode;
        throw new Error(`Unknown fault mode: ${_exhaustive}`);
      }
    }
  }
}

/** EventLog that fails once on append to simulate crash after CAS put. */
class CrashOnceEventLog implements EventLog {
  private appends = 0;

  constructor(private readonly inner: InMemoryEventLog) {}

  async append(event: LedgerEventInput): Promise<MimersLedgerEvent> {
    this.appends += 1;
    if (this.appends === 1) {
      throw new Error('SIMULATED_CRASH_AFTER_CAS_BEFORE_LEDGER');
    }
    return this.inner.append(event);
  }

  getHead(): Promise<MimersLedgerEvent | null> {
    return this.inner.getHead();
  }

  getAllEvents(): Promise<MimersLedgerEvent[]> {
    return this.inner.getAllEvents();
  }

  findByPromotionHash(promotionHash: string): Promise<MimersLedgerEvent | null> {
    return this.inner.findByPromotionHash(promotionHash);
  }
}

async function putDescriptor(
  cas: FileCASRepository,
  mediaType: string,
  payload: unknown,
): Promise<{ digest: string; size: number; mediaType: string }> {
  const { hash, size } = await cas.put(payload);
  return { digest: hash, size, mediaType };
}

async function sampleManifest(cas: FileCASRepository): Promise<MimersBrunnManifest> {
  const pipeline = await putDescriptor(cas, 'application/vnd.mimers.pipeline.v1+json', {
    nodes: ['fault'],
  });
  const policy = await putDescriptor(cas, 'application/vnd.mimers.policy.v1+json', { maxCost: 1 });
  const runtime = await putDescriptor(cas, 'application/vnd.mimers.runtime.v1+json', {
    runtimeVersion: 'fault-test',
  });
  const metrics = await putDescriptor(cas, 'application/vnd.mimers.metrics.v1+json', {
    latencyMs: 1,
    costSek: 0,
    qualityScore: 1,
    errorRate: 0,
  });
  return {
    mediaType: 'application/vnd.mimers.manifest.v1+json',
    schemaVersion: 'v1.0.0',
    pipeline,
    policySnapshot: policy,
    runtimeFingerprint: runtime,
    metrics,
  };
}

describe('P3 Mimers fault injection / crash recovery', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-p3-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('recovers after crash between temp write and commit', async () => {
    const crashing = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('crash-before-commit'),
    });
    await crashing.initialize();

    await expect(crashing.put({ step: 1 })).rejects.toThrow(/SIMULATED_CRASH_BEFORE_COMMIT/);

    const recovered = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('pass-through'),
    });
    await recovered.initialize();
    const result = await recovered.put({ step: 1 });
    expect(result.existed).toBe(false);
    expect(await recovered.existsAuthoritative(result.hash)).toBe(true);
  });

  it('recovers after crash between CAS commit and ledger append', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const inner = new InMemoryEventLog();
    const log = new CrashOnceEventLog(inner);
    const ledger = new EvolutionLedger(cas, log);
    const manifest = await sampleManifest(cas);

    await expect(ledger.commitPromotion(manifest, [], 1, { metadataName: 'crash' })).rejects.toThrow(
      /SIMULATED_CRASH_AFTER_CAS_BEFORE_LEDGER/,
    );
    expect((await inner.getAllEvents()).length).toBe(0);

    const retry = await ledger.commitPromotion(manifest, [], 1, { metadataName: 'crash' });
    expect(retry.idempotentReplay).toBe(false);
    expect((await inner.getAllEvents()).length).toBe(1);
    expect(await cas.existsAuthoritative(retry.promotionHash)).toBe(true);
  });

  it('parallel workers with identical promotion content yield one ledger event', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const manifest = await sampleManifest(cas);

    const results = await Promise.all(
      Array.from({ length: 24 }, () => ledger.commitPromotion(manifest, [], 2, { metadataName: 'race' })),
    );

    const hashes = new Set(results.map((r) => r.promotionHash));
    const eventIds = new Set(results.map((r) => r.eventId));
    expect(hashes.size).toBe(1);
    expect(eventIds.size).toBe(1);
    expect((await log.getAllEvents()).length).toBe(1);
    expect(results.some((r) => r.idempotentReplay)).toBe(true);
  });

  it('simulates EEXIST with identical bytes as idempotent put', async () => {
    const cas = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('eexist-same'),
    });
    await cas.initialize();
    const result = await cas.put({ collision: 'ok' });
    expect(result.existed).toBe(true);
    expect(await cas.get(result.hash)).toEqual({ collision: 'ok' });
  });

  it('simulates EEXIST with corrupt bytes as integrity error', async () => {
    const cas = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('eexist-corrupt'),
    });
    await cas.initialize();
    await expect(cas.put({ collision: 'bad' })).rejects.toBeInstanceOf(CASIntegrityError);
  });

  it('propagates simulated EXDEV from CommitStrategy', async () => {
    const cas = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('exdev'),
    });
    await cas.initialize();
    await expect(cas.put({ cross: 'device' })).rejects.toMatchObject({ code: 'EXDEV' });
  });

  it('surfaces directory fsync failure as DurabilityError but object remains after retry', async () => {
    const failing = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('fsync-fail'),
    });
    await failing.initialize();
    await expect(failing.put({ durable: true })).rejects.toBeInstanceOf(DurabilityError);

    const recovered = new FileCASRepository(dir, {
      durabilityMode: 'none',
      commitStrategy: new FaultyCommitStrategy('eexist-same'),
    });
    await recovered.initialize();
    const result = await recovered.put({ durable: true });
    expect(result.existed).toBe(true);
  });

  it('detects bitrot and truncated objects via verify/L3', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const committed = await ledger.commitPromotion(await sampleManifest(cas), [], 1);

    await writeFile(cas.getFilePath(committed.manifestHash), '{"bitrot":true}', 'utf-8');
    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    expect((await recovery.auditL3()).status).toBe('CORRUPTED');
    expect((await recovery.auditL2()).status).toBe('CORRUPTED');

    const { hash: truncHash } = await cas.put({ truncateMe: Math.random() });
    await truncate(cas.getFilePath(truncHash), 4);
    expect((await cas.verifyStoredObject(truncHash)).ok).toBe(false);
  });

  it('verifyDescriptor and L3 quarantine move corrupt objects', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const { hash, size } = await cas.put({ ok: true });
    const good = await cas.verifyDescriptor({
      mediaType: 'application/vnd.mimers.pipeline.v1+json',
      digest: hash,
      size,
    });
    expect(good.ok).toBe(true);

    await writeFile(cas.getFilePath(hash), '{"bitrot":true}', 'utf-8');
    const bad = await cas.verifyDescriptor({
      mediaType: 'application/vnd.mimers.pipeline.v1+json',
      digest: hash,
      size,
    });
    expect(bad.ok).toBe(false);
    expect(bad.digestValid).toBe(false);

    const recovery = new RecoveryOrchestrator(cas, async () => []);
    const scrub = await recovery.auditL3({ quarantine: true });
    expect(scrub.status).toBe('CORRUPTED');
    expect(scrub.quarantined).toContain(hash);
    expect(await cas.existsAuthoritative(hash)).toBe(false);
  });

  it('detects missing descriptor target in L2', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const committed = await ledger.commitPromotion(await sampleManifest(cas), [], 1, {
      metadataName: 'missing-desc',
    });
    const storedManifest = (await cas.get(committed.manifestHash)) as MimersBrunnManifest;
    await unlink(cas.getFilePath(storedManifest.pipeline.digest));

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const l2 = await recovery.auditL2();
    expect(l2.status).toBe('CORRUPTED');
    expect(l2.errors.some((e) => /missing object|descriptor/i.test(e))).toBe(true);
  });

  it('detects tampered ledger previous hash', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    await ledger.commitPromotion(await sampleManifest(cas), [], 1);
    await ledger.commitPromotion(await sampleManifest(cas), [], 2, { metadataName: 'second' });

    const events = await log.getAllEvents();
    const tampered: MimersLedgerEvent[] = [
      events[0]!,
      { ...events[1]!, previousEventHash: 'sha256:' + '0'.repeat(64) },
    ];
    const chain = verifyLedgerHashChain(tampered);
    expect(chain.ok).toBe(false);

    const recovery = new RecoveryOrchestrator(cas, async () => tampered);
    expect((await recovery.auditL0()).status).toBe('CORRUPTED');
  });

  it('rejects forged promotion signature and forged attestation', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const { provider } = LocalPemSigningKeyProvider.generate('legit');
    const { provider: attacker } = LocalPemSigningKeyProvider.generate('attacker');
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const committed = await ledger.commitPromotion(await sampleManifest(cas), [], 1, {
      signing: provider,
    });

    const promotion = await cas.get(committed.promotionHash);
    expect(promotion).not.toBeNull();
    expect(await verifyPromotionSignature(promotion as never, provider)).toBe(true);
    expect(await verifyPromotionSignature(promotion as never, attacker)).toBe(false);

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const forgedAudit = await recovery.auditL2({ signing: attacker, requireSignatures: true });
    expect(forgedAudit.status).toBe('CORRUPTED');

    const attestation = await createArtifactAttestation({
      subjectDigest: committed.promotionHash,
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: { builder: { id: 'mimers' } },
      signing: provider,
    });
    expect(await verifyArtifactAttestation(attestation, provider)).toBe(true);
    expect(await verifyArtifactAttestation(attestation, attacker)).toBe(false);

    const forged = {
      ...attestation,
      predicate: { builder: { id: 'evil' } },
    };
    expect(await verifyArtifactAttestation(forged, provider)).toBe(false);
  });

  it('UUIDv7 stays unique and ordered under same-millisecond burst', () => {
    const ids = Array.from({ length: 512 }, () => generateUUIDv7());
    expect(new Set(ids).size).toBe(512);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });

  it('parallel CAS puts of identical content leave exactly one object', async () => {
    const cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    const payload = { parallel: true, n: 42 };
    const results = await Promise.all(Array.from({ length: 40 }, () => cas.put(payload)));
    const hashes = new Set(results.map((r) => r.hash));
    expect(hashes.size).toBe(1);
    expect(results.filter((r) => !r.existed).length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.existed)).toBe(true);

    let count = 0;
    for await (const digest of cas.streamObjectDigests()) {
      if (digest === results[0]!.hash) count += 1;
    }
    expect(count).toBe(1);
  });
});
