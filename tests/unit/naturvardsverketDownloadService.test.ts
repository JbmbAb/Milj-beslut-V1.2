import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  downloadNaturvardsverketKnowledge,
  resolveNaturvardsverketDownloadDirectory,
} from '../../server/modules/legal/services/naturvardsverketDownloadService';

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

describe('naturvardsverketDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads NVV open data pages and capabilities with manifest', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('vic-wfs')) {
        throw new Error('DNS lookup failed');
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `<body>${input}</body>`,
      };
    });

    const result = await downloadNaturvardsverketKnowledge({
      outputDir: 'C:\\tmp\\naturvardsverket',
      fetchImpl,
      now: () => new Date('2026-04-27T18:30:00.000Z'),
    });

    expect(result.files).toEqual([
      'oppnadata.html',
      'geodatakatalogen.html',
      'naturvardsregistret-wfs-capabilities.xml',
    ]);
    expect(rmMock).toHaveBeenCalledWith('C:\\tmp\\naturvardsverket', { recursive: true, force: true });
    expect(mkdirMock).toHaveBeenCalledWith('C:\\tmp\\naturvardsverket', { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(4);
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\naturvardsverket\\manifest.json',
      expect.stringContaining('"legacyEbhProbe"'),
      'utf8',
    );
  });

  it('resolves the default NVV output directory', () => {
    const dir = resolveNaturvardsverketDownloadDirectory();
    expect(dir.toLowerCase()).toContain('knowledge_base');
    expect(dir.toLowerCase()).toContain('naturvardsverket');
  });
});
