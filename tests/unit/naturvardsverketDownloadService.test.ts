import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LEGACY_NATURVARDSVERKET_ACQUISITION_BLOCKED,
  NATURVARDSVERKET_LEGACY_CLASSIFICATION,
  downloadNaturvardsverketKnowledge,
  resolveNaturvardsverketDownloadDirectory,
} from '../../server/modules/legal/services/naturvardsverketDownloadService';
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

describe('naturvardsverketDownloadService', () => {
  const outputDir = testTmpDir('naturvardsverket');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed before legacy NVV acquisition or output creation', async () => {
    const fetchImpl = vi.fn();

    expect(NATURVARDSVERKET_LEGACY_CLASSIFICATION).toBe('LEGACY_NON_AUTHORITATIVE');
    await expect(
      downloadNaturvardsverketKnowledge({
        outputDir,
        fetchImpl,
        now: () => new Date('2026-04-27T18:30:00.000Z'),
      }),
    ).rejects.toThrow(LEGACY_NATURVARDSVERKET_ACQUISITION_BLOCKED);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the default NVV output directory', () => {
    const dir = resolveNaturvardsverketDownloadDirectory();
    expect(dir.toLowerCase()).toContain('naturvardsverket');
  });
});
