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
  LEGACY_MMD_CORPUS_ACQUISITION_BLOCKED,
  MMD_CORPUS_CLASSIFICATION,
  buildMmdCorpus,
  resolveMmdCorpusDirectory,
} from '../../server/modules/legal/services/mmdCorpusService';
import { testTmpDir } from '../helpers/testPaths';

describe('mmdCorpusService', () => {
  const outputDir = testTmpDir('mmd-corpus');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the website catalogue discovery-only and blocks acquisition', async () => {
    const fetchImpl = vi.fn();

    await expect(buildMmdCorpus({ outputDir, fetchImpl })).rejects.toThrow(
      LEGACY_MMD_CORPUS_ACQUISITION_BLOCKED,
    );

    expect(MMD_CORPUS_CLASSIFICATION).toBe('DISCOVERY_ONLY');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the default MMD corpus directory', () => {
    const dir = resolveMmdCorpusDirectory();
    expect(dir.toLowerCase()).toContain('mmd-corpus');
  });
});
