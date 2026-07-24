import path from 'node:path';
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
  buildMmdCorpus,
  resolveMmdCorpusDirectory,
} from '../../server/modules/legal/services/mmdCorpusService';
import { testTmpDir } from '../helpers/testPaths';

describe('mmdCorpusService', () => {
  const outputDir = testTmpDir('mmd-corpus');

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
      outputDir,
      fetchImpl,
      now: () => new Date('2026-04-27T19:20:00.000Z'),
    });

    expect(result.processed).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(writeFileMock).toHaveBeenCalledWith(
      path.join(outputDir, 'overview.html'),
      expect.stringContaining('har-finns-vi'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      path.join(outputDir, 'pages', 'nacka-tingsratt.html'),
      expect.stringContaining('nacka-tingsratt'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      path.join(outputDir, 'manifest.json'),
      expect.stringContaining('"processed": 5'),
      'utf8',
    );
  });

  it('resolves the default MMD corpus directory', () => {
    const dir = resolveMmdCorpusDirectory();
    expect(dir.toLowerCase()).toContain('mmd-corpus');
  });
});
