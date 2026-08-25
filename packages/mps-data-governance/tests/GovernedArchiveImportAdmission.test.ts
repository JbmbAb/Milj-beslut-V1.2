import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DiskQuarantineStorage } from '@miljobeslut/mimers-brunn-core';
import { afterEach, describe, expect, it } from 'vitest';

import { GovernedArchiveImportAdmission } from '../src/GovernedArchiveImportAdmission';
import { fixtureRegistry, fixtureSource } from './fixtures/verifiedSourceRegistry';

describe('GOVERNED-ARCHIVE-IMPORT-ADMISSION-V1', () => {
  const roots: string[] = [];
  const bytes = new TextEncoder().encode('already materialized municipal decision bytes');
  const archiveSource = fixtureSource({
    sourceId: 'municipal-decision-archive',
    authority: { name: 'Example kommun', type: 'municipality' },
    channelType: 'ARCHIVE_IMPORT',
    archiveId: 'geo-master-c-drive-import-v1',
    endpointUrl: undefined,
    allowedDomains: [],
    registryArtifactId: 'reg-municipal-decision-archive-001',
  });

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function admission(source = archiveSource): {
    admission: GovernedArchiveImportAdmission;
    storage: DiskQuarantineStorage;
  } {
    const root = mkdtempSync(join(tmpdir(), 'governed-archive-import-'));
    roots.push(root);
    const storage = new DiskQuarantineStorage(root);
    return {
      admission: new GovernedArchiveImportAdmission(fixtureRegistry(source), storage),
      storage,
    };
  }

  const request = {
    source_id: archiveSource.sourceId,
    archive_id: 'geo-master-c-drive-import-v1',
    file_name: 'decision.pdf',
    bytes,
    observed_locator: 'C:/geo-master/decision.pdf',
    observed_at: '2026-08-25T10:00:00.000Z',
    transport_metadata: { transport: 'rclone' },
  } as const;

  it('admits already-materialized archive bytes with explicit provenance and no source URL', async () => {
    const { admission: importer, storage } = admission();
    const result = await importer.importObservation(request);
    const metadata = await storage.getMetadata(result.quarantine_id);

    expect(result.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(metadata).not.toBeNull();
    expect(metadata).toMatchObject({
      source_id: archiveSource.sourceId,
      file_name: request.file_name,
      acquisition: {
        acquisition_kind: 'ARCHIVE_IMPORT',
        archive_id: request.archive_id,
        observed_locator: request.observed_locator,
        observed_at: request.observed_at,
        transport_metadata: request.transport_metadata,
      },
      custom_metadata: { registry_artifact_id: archiveSource.registryArtifactId },
    });
    expect(Object.prototype.hasOwnProperty.call(metadata!, 'source_url')).toBe(false);
    expect(await storage.get(result.quarantine_id)).toEqual(bytes);
  });

  it.each([
    ['unknown source', { source_id: 'unknown-source' }, 'REJECT_SOURCE'],
    ['network source', { source_id: 'network-source' }, 'REJECT_CHANNEL'],
    ['archive id mismatch', { archive_id: 'wrong-archive' }, 'REJECT_ARCHIVE_ID'],
    ['missing locator', { observed_locator: '' }, 'REJECT_MISSING_PROVENANCE'],
  ] as const)('fails closed for %s', async (_label, overrides, reasonCode) => {
    const source =
      'source_id' in overrides && overrides.source_id === 'network-source'
        ? fixtureSource({ sourceId: 'network-source' })
        : archiveSource;
    const { admission: importer, storage } = admission(source);

    await expect(importer.importObservation({ ...request, ...overrides })).rejects.toMatchObject({
      reason_code: reasonCode,
    });
    expect(await storage.list()).toEqual([]);
  });

  it('refuses identical bytes with incompatible archive provenance rather than silently losing it', async () => {
    const { admission: importer, storage } = admission();
    await importer.importObservation(request);

    await expect(
      importer.importObservation({
        ...request,
        observed_locator: 'C:/another-materialization/decision.pdf',
      }),
    ).rejects.toThrow(/different provenance/);
    expect(await storage.list()).toHaveLength(1);
  });
});
