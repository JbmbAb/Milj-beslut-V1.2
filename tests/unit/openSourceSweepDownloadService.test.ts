import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  downloadOpenSourceSweep,
  resolveOpenSourceSweepDirectory,
} from '../../server/services/openSourceSweepDownloadService';
import { testTmpDir } from '../helpers/testPaths';

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
  const outputDir = testTmpDir('open-source-sweep');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed before downloading sources or writing a manifest', async () => {
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

    await expect(
      downloadOpenSourceSweep({
        outputDir,
        fetchImpl,
        now: () => new Date('2026-04-27T19:00:00.000Z'),
      }),
    ).rejects.toThrow('P2-AUTH-03C BLOCKED');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the default sweep output directory', () => {
    const dir = resolveOpenSourceSweepDirectory();
    expect(dir.toLowerCase()).toContain('open-source-sweep');
  });
});
