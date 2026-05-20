import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FOUNDATION_LEGAL_SOURCES } from '../../server/modules/legal/catalogs/foundationLegalSources';
import {
  downloadFoundationLegalSources,
  resolveFoundationLegalSourceDownloadDirectory,
} from '../../server/modules/legal/services/foundationLegalSourceDownloadService';

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

describe('foundationLegalSourceDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads every curated foundation legal source and writes a manifest', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      arrayBuffer: async () => Buffer.from(`<html>${input}</html>`) as unknown as ArrayBuffer,
    }));

    const result = await downloadFoundationLegalSources({
      outputDir: 'C:\\tmp\\foundation-downloads',
      fetchImpl,
      now: () => new Date('2026-04-26T10:00:00.000Z'),
    });

    expect(result.processed).toBe(FOUNDATION_LEGAL_SOURCES.length);
    expect(fetchImpl).toHaveBeenCalledTimes(FOUNDATION_LEGAL_SOURCES.length);
    expect(mkdirMock).toHaveBeenCalledWith('C:\\tmp\\foundation-downloads', { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(FOUNDATION_LEGAL_SOURCES.length + 1);
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\foundation-downloads\\sfs-1998-808.html',
      expect.any(Buffer),
    );
    expect(writeFileMock).toHaveBeenLastCalledWith(
      'C:\\tmp\\foundation-downloads\\manifest.json',
      expect.stringContaining('"processed": 5'),
      'utf8',
    );
    expect(result.downloads[0]).toMatchObject({
      externalId: 'SFS:1998:808',
      contentType: 'text/html',
      savedAs: 'sfs-1998-808.html',
    });
  });

  it('resolves the default output directory under dossiers knowledge base', () => {
    const dir = resolveFoundationLegalSourceDownloadDirectory();
    expect(dir.toLowerCase()).toContain('knowledge_base');
    expect(dir.toLowerCase()).toContain('foundation-sources');
  });
});
