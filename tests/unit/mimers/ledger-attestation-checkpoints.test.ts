import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EvolutionLedger,
  FileCASRepository,
  InMemoryEventLog,
  LocalPemSigningKeyProvider,
  MIMERS_METRICS,
  RecoveryOrchestrator,
  buildCasMerkleCheckpoint,
  buildIntegrityCheckpoint,
  buildLedgerMerkleCheckpoint,
  createArtifactAttestation,
  signIntegrityCheckpoint,
  verifyArtifactAttestation,
  verifySignedCheckpoint,
  type MimersBrunnManifest,
} from '@miljobeslut/mimers-brunn-core';

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
    nodes: ['a'],
  });
  const policy = await putDescriptor(cas, 'application/vnd.mimers.policy.v1+json', { maxCost: 1 });
  const runtime = await putDescriptor(cas, 'application/vnd.mimers.runtime.v1+json', {
    runtimeVersion: 'test',
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

describe('P1D–P2 Mimers ledger / attestation / checkpoints', () => {
  let dir: string;
  let cas: FileCASRepository;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-p1d-'));
    cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('commitPromotion is idempotent for identical sealed content', async () => {
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const manifest = await sampleManifest(cas);

    const first = await ledger.commitPromotion(manifest, [], 1, { metadataName: 'g1' });
    const second = await ledger.commitPromotion(manifest, [], 1, { metadataName: 'g1' });

    expect(second.idempotentReplay).toBe(true);
    expect(second.promotionHash).toBe(first.promotionHash);
    expect(second.eventId).toBe(first.eventId);
    expect((await log.getAllEvents()).length).toBe(1);
  });

  it('creates and verifies domain-separated artifact attestation', async () => {
    const { provider } = LocalPemSigningKeyProvider.generate('test-key');
    const attestation = await createArtifactAttestation({
      subjectDigest: 'sha256:' + 'a'.repeat(64),
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: { builder: { id: 'mimers-test' } },
      signing: provider,
    });
    expect(attestation.signer).toBe('test-key');
    expect(await verifyArtifactAttestation(attestation, provider)).toBe(true);
  });

  it('builds independent CAS and Ledger merkle checkpoints and signs them', async () => {
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const manifest = await sampleManifest(cas);
    const committed = await ledger.commitPromotion(manifest, [], 1);
    const events = await log.getAllEvents();

    const ledgerCp = buildLedgerMerkleCheckpoint(events);
    const casCp = buildCasMerkleCheckpoint([committed.promotionHash, committed.manifestHash]);
    expect(ledgerCp.rootHash).not.toBe(casCp.rootHash);

    const integrity = buildIntegrityCheckpoint(casCp, ledgerCp);
    const { provider } = LocalPemSigningKeyProvider.generate();
    const signed = await signIntegrityCheckpoint(integrity, provider);
    expect(await verifySignedCheckpoint(signed, provider)).toBe(true);
  });

  it('RecoveryOrchestrator L0–L3 reports CLEAN for healthy signed commit', async () => {
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const { provider } = LocalPemSigningKeyProvider.generate('audit-key');
    await ledger.commitPromotion(await sampleManifest(cas), [], 1, { signing: provider });

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const l0 = await recovery.auditL0();
    const l1 = await recovery.auditL1();
    const l2 = await recovery.auditL2({ signing: provider, requireSignatures: true });
    const l3 = await recovery.auditL3({ concurrency: 4 });

    expect(l0.status).toBe('CLEAN');
    expect(l1.status).toBe('CLEAN');
    expect(l2.status).toBe('CLEAN');
    expect(l3.status).toBe('CLEAN');
    expect(l3.processedCount).toBeGreaterThan(0);
    expect(MIMERS_METRICS.auditL0Duration).toBe('audit.l0.duration');
    expect(MIMERS_METRICS.auditL3Duration).toBe('audit.l3.duration');
  });

  it('RecoveryOrchestrator L2 fails closed when required signature is missing', async () => {
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    await ledger.commitPromotion(await sampleManifest(cas), [], 1);

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const l2 = await recovery.auditL2({ requireSignatures: true });
    expect(l2.status).toBe('CORRUPTED');
    expect(l2.errors.some((e) => /missing required signature/i.test(e))).toBe(true);
  });

  it('RecoveryOrchestrator L3 detects on-disk bitrot', async () => {
    const log = new InMemoryEventLog();
    const ledger = new EvolutionLedger(cas, log);
    const committed = await ledger.commitPromotion(await sampleManifest(cas), [], 1);

    const filePath = cas.getFilePath(committed.manifestHash);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, '{"tampered":true}', 'utf-8');

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const l2 = await recovery.auditL2();
    const l3 = await recovery.auditL3();
    expect(l2.status).toBe('CORRUPTED');
    expect(l3.status).toBe('CORRUPTED');
    expect(l3.errors.some((e) => /bitrot/i.test(e))).toBe(true);
  });
});
