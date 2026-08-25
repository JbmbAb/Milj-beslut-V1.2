import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CASIntegrityError, FileCASRepository } from '@miljobeslut/mimers-brunn-core';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { SyncMimersReader } from '../../server/utils/SyncMimersReader';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'a1-cas-'));
  roots.push(value);
  return value;
}

describe('A1 CAS read-integrity chokepoints', () => {
  it('MimersByteStorageBackend denies corrupt content-addressed bytes', async () => {
    const storageRoot = root();
    const casRoot = path.join(storageRoot, 'cas');
    mkdirSync(casRoot, { recursive: true });
    mkdirSync(path.join(casRoot, 'tmp'), { recursive: true });
    const cas = new FileCASRepository(casRoot, { durabilityMode: 'none' });
    const backend = new MimersByteStorageBackend(cas, path.join(storageRoot, 'index'));
    await backend.put('artifact-a', Buffer.from('trusted'));
    const hash = await backend.resolveContentAddress('artifact-a');
    writeFileSync(cas.getFilePath(hash!), 'corrupted');

    const reopened = new MimersByteStorageBackend(
      new FileCASRepository(casRoot, { durabilityMode: 'none' }),
      path.join(storageRoot, 'index'),
    );
    await expect(reopened.get('artifact-a')).rejects.toBeInstanceOf(CASIntegrityError);
  });

  it('SyncMimersReader accepts addressed bytes and denies corruption', () => {
    const mimersRoot = root();
    const artifactId = 'artifact-a';
    const bytes = Buffer.from(JSON.stringify({ body: { artifact_id: artifactId } }));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const hash = `sha256:${digest}`;
    const indexName = createHash('sha256').update(artifactId).digest('hex');
    const casRoot = path.join(mimersRoot, 'cas');
    mkdirSync(path.join(casRoot, 'artifact-id-index'), { recursive: true });
    writeFileSync(path.join(casRoot, 'artifact-id-index', `${indexName}.idx`), JSON.stringify({ hash }));
    writeFileSync(path.join(casRoot, hash), bytes);

    const reader = new SyncMimersReader(mimersRoot);
    expect(reader.read({ artifact_id: artifactId, artifact_type: 'test' } as never)).toMatchObject({ artifact_id: artifactId });
    writeFileSync(path.join(casRoot, hash), 'corrupted');
    expect(reader.read({ artifact_id: artifactId, artifact_type: 'test' } as never)).toBeNull();
  });
});
