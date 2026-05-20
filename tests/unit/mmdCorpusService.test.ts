import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rmMock, mkdirMock, writeFileMock } = vi.hoisted(() => ({
  rmMock: vi.fn(),
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    rm: rmMock,
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
  rm: rmMock,
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

import { buildMmdCorpus, resolveMmdCorpusDirectory } from '../../server/modules/legal/services/mmdCorpusService';

describe('mmdCorpusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads overview and five environmental court pages', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `<html>${input}</html>`,
    }));

    const result = await buildMmdCorpus({
      outputDir: 'C:\\tmp\\mmd-corpus',
      fetchImpl,
      now: () => new Date('2026-04-27T19:20:00.000Z'),
    });

    expect(result.processed).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\mmd-corpus\\overview.html',
      expect.stringContaining('har-finns-vi'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\mmd-corpus\\pages\\nacka-tingsratt.html',
      expect.stringContaining('nacka-tingsratt'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\mmd-corpus\\manifest.json',
      expect.stringContaining('"processed": 5'),
      'utf8',
    );
  });

  it('resolves the default MMD corpus directory', () => {
    const dir = resolveMmdCorpusDirectory();
    expect(dir.toLowerCase()).toContain('knowledge_base');
    expect(dir.toLowerCase()).toContain('mmd-corpus');
  });
});
