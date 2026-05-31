import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  downloadOpenSourceSweep,
  resolveOpenSourceSweepDirectory,
} from '../../server/services/openSourceSweepDownloadService';

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

describe('openSourceSweepDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads accessible open sources and records failures in manifest', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('smp.lansstyrelsen.se')) {
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: async () => '',
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `<body>${input}</body>`,
      };
    });

    const result = await downloadOpenSourceSweep({
      outputDir: 'C:\\tmp\\open-source-sweep',
      fetchImpl,
      now: () => new Date('2026-04-27T19:00:00.000Z'),
    });

    expect(result.attempted).toBe(21);
    expect(result.downloaded).toBe(20);
    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\tmp\\open-source-sweep\\manifest.json',
      expect.stringContaining('"downloaded": 20'),
      'utf8',
    );
  });

  it('resolves the default sweep output directory', () => {
    const dir = resolveOpenSourceSweepDirectory();
    expect(dir.toLowerCase()).toContain('open-source-sweep');
  });
});
