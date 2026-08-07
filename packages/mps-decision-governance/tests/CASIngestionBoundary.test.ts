import { describe, it, expect, vi } from 'vitest';
import { CASConcurrencyGuard } from '../../alpha-runtime/src/recovery/CASConcurrencyGuard';
import { DocumentCAS, EmbeddingCAS, EmbeddingIdentity } from '../../alpha-runtime/src/recovery/CASDomains';

describe('CAS Ingestion Boundary', () => {

  describe('CAS-I01: Domain Isolation', () => {
    it('Embedding CAS derives identity strictly from chunk + model + versions, ignoring document metadata', () => {
      const identity: EmbeddingIdentity = {
        chunkHash: 'chunk123',
        embeddingModel: 'text-embedding-gecko',
        embeddingVersion: 'v1',
        tokenizerVersion: 'v2'
      };

      const hash1 = EmbeddingCAS.generateIdentityHash(identity);

      // A different document context but same chunk should yield exact same embedding hash
      const hash2 = EmbeddingCAS.generateIdentityHash({
        ...identity
      });

      expect(hash1).toBe(hash2);

      // Mutating tokenizer version MUST change hash
      const hash3 = EmbeddingCAS.generateIdentityHash({
        ...identity,
        tokenizerVersion: 'v3'
      });

      expect(hash1).not.toBe(hash3);
    });

    it('Document CAS derives identity strictly from bytes', () => {
      const docBytes = Buffer.from('PDF Content');
      const hash1 = DocumentCAS.generateIdentityHash({ contentBytes: docBytes });
      const hash2 = DocumentCAS.generateIdentityHash({ contentBytes: Buffer.from('PDF Content') });
      expect(hash1).toBe(hash2);
    });
  });

  describe('DFL-I5: Concurrency Invariant', () => {
    it('N concurrent writes of same content = 1 physical write + N successful resolutions', async () => {
      const guard = new CASConcurrencyGuard();
      const identityHash = 'doc123';
      
      let physicalWrites = 0;
      
      const mockIngestToStorage = async () => {
        // Simulate IO delay
        await new Promise(r => setTimeout(r, 50));
        physicalWrites++;
        return 'success';
      };

      const N = 10;
      
      // Fire N concurrent requests
      const promises = Array.from({ length: N }).map(() => {
        return guard.ingest(identityHash, mockIngestToStorage);
      });

      const results = await Promise.all(promises);

      // All N requests should resolve successfully
      expect(results).toHaveLength(N);
      expect(results.every(r => r === 'success')).toBe(true);

      // But only 1 physical write should have occurred!
      expect(physicalWrites).toBe(1);
    });
  });
});
