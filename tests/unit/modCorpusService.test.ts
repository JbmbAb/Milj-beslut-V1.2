import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileMock, rmMock, mkdirMock, copyFileMock, writeFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  mkdirMock: vi.fn(),
  copyFileMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: readFileMock,
    rm: rmMock,
    mkdir: mkdirMock,
    copyFile: copyFileMock,
    writeFile: writeFileMock,
  },
  readFile: readFileMock,
  rm: rmMock,
  mkdir: mkdirMock,
  copyFile: copyFileMock,
  writeFile: writeFileMock,
}));

import {
  buildModCorpus,
  resolveModCorpusDirectory,
} from '../../server/modules/legal/services/modCorpusService';

describe('modCorpusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts only MÖD items from domstol RSS manifest', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        feedUrl: 'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972',
        fetchedAt: '2026-04-27T18:39:20.427Z',
        processed: 2,
        items: [
          {
            guid: '160013',
            title: 'Mål: F 11878-24',
            link: 'https://www.domstol.se/mark--och-miljooverdomstolen/mark--och-miljooverdomstolens-avgoranden/2025/160013/',
            savedAs: '160013.html',
            savedAt: '2026-04-27T18:39:10.013Z',
          },
          {
            guid: 'x-1',
            title: 'Annan domstol',
            link: 'https://www.domstol.se/hogsta-domstolen/avgoranden/2025/x-1/',
            savedAs: 'x-1.html',
            savedAt: '2026-04-27T18:39:10.013Z',
          },
        ],
      }),
    );

    const result = await buildModCorpus({
      sourceDir: 'C:\\tmp\\domstol-rss',
      outputDir: 'C:\\tmp\\mod-corpus',
      now: () => new Date('2026-04-27T19:10:00.000Z'),
    });

    expect(result.processed).toBe(1);
    expect(copyFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\domstol-rss\\pages\\160013.html',
      'C:\\tmp\\mod-corpus\\pages\\160013.html',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\mod-corpus\\manifest.json',
      expect.stringContaining('"processed": 1'),
      'utf8',
    );
  });

  it('resolves the default MÖD corpus directory', () => {
    const dir = resolveModCorpusDirectory();
    expect(dir.toLowerCase()).toContain('mod-corpus');
  });
});
