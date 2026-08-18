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

  it('fails closed before network or archive writes for curated legacy sources', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      arrayBuffer: async () => Buffer.from(`<html>${input}</html>`) as unknown as ArrayBuffer,
    }));

    await expect(
      downloadLegalSources({
        definitions: CURATED_LEGAL_DOWNLOAD_SOURCES,
        outputDir,
        fetchImpl,
        now: () => new Date('2026-04-26T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/P2-AUTH-03D3 BLOCKED/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the curated output directory under dossiers knowledge base', () => {
    const dir = resolveCuratedLegalDownloadDirectory();
    expect(dir.toLowerCase()).toContain('curated-downloads');
  });
});
