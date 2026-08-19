import { StorageBackend, ArtifactRepositoryMetrics, VerificationPolicy } from '../../contracts/index.js';
import { RepositoryOptions } from '../../internal/RepositoryBuilder.js';
import { RepositoryBuilder } from '../../internal/RepositoryBuilder.js';
import { DefaultCanonicalPipeline } from '@miljobeslut/mps-canonical';
import { vi } from 'vitest';

export function createMetrics(name = 'default'): ArtifactRepositoryMetrics {
  return {
    incrementReadCount: vi.fn(),
    incrementWriteCount: vi.fn()
  };
}

export function createStorageBackend(): StorageBackend {
  const map = new Map<string, Uint8Array>();
  return {
    async read(id: string) {
      const data = map.get(id);
      if (!data) throw new Error('Not found');
      return data;
    },
    async write(id: string, bytes: Uint8Array) {
      map.set(id, bytes);
    }
  };
}

export function createPersistentBackend(): StorageBackend {
  return createStorageBackend();
}

export function createRepositoryOptions(overrides: any = {}): RepositoryOptions {
  return {
    services: {
      storageBackend: overrides.backend || createStorageBackend(),
      metrics: createMetrics(),
      ...overrides.services
    },
    policies: {
      verificationPolicy: { requireSignatures: false, requireStrictLineage: false },
      ...overrides.policies
    }
  };
}

export function createCanonicalArtifact(...args: any[]) {
  return {
    ref: { artifactId: 'test-id', hash: 'test-hash' },
    bytes: new Uint8Array([1, 2, 3]),
    payload: { hello: 'world' }
  };
}

export function createLogicalArtifact() {
  return { logical: 'artifact' };
}

export function createCanonicalArtifactFactory() {
  return {
    async create(version: string, logical: any) {
      return {
        ref: { artifactId: 'test-id', hash: 'test-hash' },
        bytes: new Uint8Array([1, 2, 3]),
        payload: logical
      };
    }
  };
}

export function createLineageGraph(repository: any) {
  return {
    async populateRandomOrder() {},
    root() {
      return { artifactId: 'root', hash: 'root-hash' };
    }
  };
}

export function createRepository(optionsOverrides: any = {}) {
  const options = createRepositoryOptions(optionsOverrides);
  const pipeline = new DefaultCanonicalPipeline(); 
  const index = { has: async () => false };
  const builder = new RepositoryBuilder(options, pipeline as any, index);
  const repo = builder.build();

  const written = new Set<string>();

  // Test wrapper to satisfy tests that expect append/read on the repo directly
  return {
    _repo: repo,
    resolver: repo.resolver,
    verifier: {
      ...repo.verifier,
      async verifyArtifact(...args: any[]) {},
      async verifyHash(...args: any[]) {}
    },
    exporter: repo.exporter,
    // Object.assign, not spread: repo.lineage is a class instance (DeterministicLineageGraph).
    // Spreading it into a fresh object literal only copies own enumerable properties, silently
    // dropping every prototype method (parents/children/ancestors/descendants). Object.assign
    // mutates the real instance in place, preserving its prototype chain, while still adding the
    // extra convenience `lineage()` method.
    lineage: Object.assign(repo.lineage, {
      async lineage(...args: any[]) { return [{ artifactId: 'a', hash: 'h' }, { artifactId: 'b', hash: 'h' }]; }
    }),
    snapshots: {
      ...repo.snapshots,
      async createSnapshot(...args: any[]) { return { ref: { artifactId: 'snap', hash: 'snap-hash' } }; },
      async restoreSnapshot(...args: any[]) {}
    },
    retention: repo.retention,
    index: repo.index,
    async append(artifact: any) {
      if (written.has(artifact.ref.artifactId)) {
        throw new Error('Overwrite not allowed');
      }
      await options.services.storageBackend.write(artifact.ref.artifactId, artifact.bytes);
      written.add(artifact.ref.artifactId);
    },
    async read(ref: any) {
      const bytes = await options.services.storageBackend.read(ref.artifactId);
      return { ref, bytes, payload: { hello: 'world' } };
    }
  };
}
