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

import {
  buildLansstyrelserCorpus,
  resolveLansstyrelserCorpusDirectory,
} from '../../server/modules/legal/services/lansstyrelserCorpusService';

describe('lansstyrelserCorpusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads homepage plus 21 county pages', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `<html>${input}</html>`,
    }));

    const result = await buildLansstyrelserCorpus({
      outputDir: 'C:\\tmp\\lansstyrelserna',
      fetchImpl,
      now: () => new Date('2026-04-27T19:45:00.000Z'),
    });

    expect(result.processed).toBe(21);
    expect(fetchImpl).toHaveBeenCalledTimes(22);
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\lansstyrelserna\\homepage.html',
      expect.stringContaining('lansstyrelsen.se/'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\lansstyrelserna\\pages\\stockholm.html',
      expect.stringContaining('/stockholm'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\lansstyrelserna\\manifest.json',
      expect.stringContaining('"processed": 21'),
      'utf8',
    );
  });

  it('resolves the default länsstyrelser directory', () => {
    const dir = resolveLansstyrelserCorpusDirectory();
    expect(dir.toLowerCase()).toContain('knowledge_base');
    expect(dir.toLowerCase()).toContain('lansstyrelserna');
  });
});
