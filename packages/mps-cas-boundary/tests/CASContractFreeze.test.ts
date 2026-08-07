import { describe, expect, it } from 'vitest';
import {
  CAS_ALLOWED_OPERATIONS,
  CAS_FORBIDDEN_OPERATIONS,
  InMemoryCASRepository,
  assertCASOperationAllowed,
  digestBytes,
  sealCASRepository,
} from '../src/CASWriteOnceRepository';
import { resolveObjectPath } from '../src/CASPathResolver';
import { CASRuntimeBoundary, assertRuntimeStorable } from '../src/CASRuntimeBoundary';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('Commit H.1: CAS Contract Freeze', () => {
  describe('CAS-I02: Immutable Object', () => {
    it('en påstådd digest måste stämma med bytesen (CAS_DIGEST_MISMATCH)', async () => {
      const cas = new InMemoryCASRepository('/disk/a');
      const { hash } = await cas.put(bytes('beslut-A'));

      await expect(cas.putAtDigest(hash, bytes('beslut-B'))).rejects.toThrowError('CAS_DIGEST_MISMATCH');
      expect(new TextDecoder().decode((await cas.get(hash))!)).toBe('beslut-A');
    });

    it('samma hash + andra bytes = omöjligt även vid kollision (CAS_IMMUTABILITY_VIOLATION)', async () => {
      const collidingDigest = () => 'sha256:' + 'a'.repeat(64);
      const cas = new InMemoryCASRepository('/disk/a', 'sha256', collidingDigest);

      const { hash } = await cas.put(bytes('beslut-A'));
      await expect(cas.put(bytes('beslut-B'))).rejects.toThrowError('CAS_IMMUTABILITY_VIOLATION');
      expect(new TextDecoder().decode((await cas.get(hash))!)).toBe('beslut-A');
    });

    it('idempotent put på identiska bytes ger existed=true utan att röra innehållet', async () => {
      const cas = new InMemoryCASRepository('/disk/a');
      const first = await cas.put(bytes('beslut-A'));
      const second = await cas.put(bytes('beslut-A'));

      expect(second.hash).toBe(first.hash);
      expect(first.existed).toBe(false);
      expect(second.existed).toBe(true);
    });

    it('CAS-ytan är put/get/exists — update, replace och mutate finns inte', async () => {
      const sealed = sealCASRepository(new InMemoryCASRepository('/disk/a'));

      for (const forbidden of CAS_FORBIDDEN_OPERATIONS) {
        expect(() => (sealed as unknown as Record<string, unknown>)[forbidden]).toThrowError(
          'CAS_MUTATION_FORBIDDEN',
        );
      }

      for (const allowed of CAS_ALLOWED_OPERATIONS) {
        expect(typeof (sealed as unknown as Record<string, unknown>)[allowed]).toBe('function');
        expect(() => assertCASOperationAllowed(allowed)).not.toThrow();
      }

      const put = await sealed.put(bytes('beslut-A'));
      expect(await sealed.exists(put.hash)).toBe(true);
    });
  });

  describe('CAS-I03: Storage Independence', () => {
    it('flytt disk A -> disk B ändrar inte hash, identitet eller replay-förmåga', async () => {
      const diskA = new InMemoryCASRepository('/mnt/disk-a/mimer-cas');
      const stored = await diskA.put(bytes('evidence-set-1'));

      const diskB = diskA.relocateTo('D:\\mimer\\cas');

      expect(await diskB.exists(stored.hash)).toBe(true);
      expect(await diskB.get(stored.hash)).toEqual(await diskA.get(stored.hash));
      expect(diskB.locate(stored.hash)).toEqual(diskA.locate(stored.hash));

      expect(diskA.physicalPath(stored.hash)).not.toBe(diskB.physicalPath(stored.hash));
      expect(digestBytes((await diskB.get(stored.hash))!)).toBe(stored.hash);
    });

    it('mount root ingår aldrig i den kanoniska objektsökvägen', async () => {
      const { hash } = await new InMemoryCASRepository('/mnt/disk-a').put(bytes('evidence-set-1'));
      const location = resolveObjectPath(hash);

      expect(location.relativePath.startsWith('objects/')).toBe(true);
      expect(location.relativePath).not.toContain('mnt');
    });
  });

  describe('CAS-I04: Runtime Non Authority', () => {
    it('runtime får hålla snapshots, cache och temporärt härlett tillstånd', () => {
      for (const namespace of ['runtime', 'snapshots', 'cache', 'temporary']) {
        const runtime = new CASRuntimeBoundary(namespace);
        expect(() => runtime.store({ kind: 'RuntimeSnapshotPointer', release_hash: 'r1' })).not.toThrow();
      }
    });

    it('runtime får inte hålla DecisionFacts, EvidenceAuthority eller MaterializedTruth', () => {
      for (const artifactType of ['DecisionFacts', 'EvidenceAuthority', 'MaterializedTruth']) {
        expect(() => assertRuntimeStorable({ artifact_type: artifactType })).toThrowError(
          'CAS_RUNTIME_AUTHORITY_VIOLATION',
        );
      }
    });

    it('auktoritet kan inte smugglas in som fält i ett runtime-objekt', () => {
      const runtime = new CASRuntimeBoundary('cache');
      expect(() => runtime.store({ kind: 'QueryResultCache', decision_facts: { allowed: true } })).toThrowError(
        'CAS_RUNTIME_AUTHORITY_VIOLATION',
      );
    });

    it('objects/ är inte en runtime-namespace', () => {
      expect(() => new CASRuntimeBoundary('objects')).toThrowError('CAS_RUNTIME_AUTHORITY_VIOLATION');
    });
  });
});
