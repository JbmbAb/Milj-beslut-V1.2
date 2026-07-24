import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CURATED_LEGAL_DOWNLOAD_SOURCES } from '../../server/modules/legal/catalogs/curatedLegalDownloadSources';
import {
  downloadLegalSources,
  resolveCuratedLegalDownloadDirectory,
} from '../../server/modules/legal/services/legalSourceDownloadService';
import { testTmpDir } from '../helpers/testPaths';

const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

describe('legalSourceDownloadService', () => {
  const outputDir = testTmpDir('curated-legal-downloads');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates shared source URLs and writes a manifest', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      arrayBuffer: async () => Buffer.from(`<html>${input}</html>`) as unknown as ArrayBuffer,
    }));

    const result = await downloadLegalSources({
      definitions: CURATED_LEGAL_DOWNLOAD_SOURCES,
      outputDir,
      fetchImpl,
      now: () => new Date('2026-04-26T12:00:00.000Z'),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(result.processed).toBe(12);
    expect(result.downloads[0]).toMatchObject({
      definitionIds: ['foundation.mb', 'sewage.mb'],
      externalIds: ['SFS:1998:808', 'SFS:1998:808'],
      savedAs: 'sfs-1998-808.html',
    });
    expect(writeFileMock).toHaveBeenCalledTimes(13);
    expect(writeFileMock).toHaveBeenLastCalledWith(
      path.join(outputDir, 'manifest.json'),
      expect.stringContaining('"processed": 12'),
      'utf8',
    );
  });

  it('resolves the curated output directory under dossiers knowledge base', () => {
    const dir = resolveCuratedLegalDownloadDirectory();
    expect(dir.toLowerCase()).toContain('curated-downloads');
  });
});
