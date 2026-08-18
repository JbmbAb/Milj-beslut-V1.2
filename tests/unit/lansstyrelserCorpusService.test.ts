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
  LANSSTYRELSER_CORPUS_CLASSIFICATION,
  LEGACY_LANSSTYRELSER_CORPUS_ACQUISITION_BLOCKED,
  buildLansstyrelserCorpus,
  resolveLansstyrelserCorpusDirectory,
} from '../../server/modules/legal/services/lansstyrelserCorpusService';
import { testTmpDir } from '../helpers/testPaths';

describe('lansstyrelserCorpusService', () => {
  const outputDir = testTmpDir('lansstyrelserna');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the portal catalogue discovery-only and blocks acquisition', async () => {
    const fetchImpl = vi.fn();

    await expect(buildLansstyrelserCorpus({ outputDir, fetchImpl })).rejects.toThrow(
      LEGACY_LANSSTYRELSER_CORPUS_ACQUISITION_BLOCKED,
    );

    expect(LANSSTYRELSER_CORPUS_CLASSIFICATION).toBe('DISCOVERY_ONLY');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the default länsstyrelser directory', () => {
    const dir = resolveLansstyrelserCorpusDirectory();
    expect(dir.toLowerCase()).toContain('lansstyrelserna');
  });
});
