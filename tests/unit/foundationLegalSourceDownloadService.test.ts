import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FOUNDATION_LEGAL_SOURCES } from '../../server/modules/legal/catalogs/foundationLegalSources';
import {
  downloadFoundationLegalSources,
  resolveFoundationLegalSourceDownloadDirectory,
} from '../../server/modules/legal/services/foundationLegalSourceDownloadService';
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

describe('foundationLegalSourceDownloadService', () => {
  const outputDir = testTmpDir('foundation-downloads');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed before network or archive writes for foundation legacy sources', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      arrayBuffer: async () => Buffer.from(`<html>${input}</html>`) as unknown as ArrayBuffer,
    }));

    expect(FOUNDATION_LEGAL_SOURCES).toHaveLength(5);
    await expect(
      downloadFoundationLegalSources({
        outputDir,
        fetchImpl,
        now: () => new Date('2026-04-26T10:00:00.000Z'),
      }),
    ).rejects.toThrow(/P2-AUTH-03D3 BLOCKED/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the default output directory under dossiers knowledge base', () => {
    const dir = resolveFoundationLegalSourceDownloadDirectory();
    expect(dir.toLowerCase()).toContain('foundation-sources');
  });
});
