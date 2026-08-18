import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: { mkdir: mkdirMock, writeFile: writeFileMock },
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

import { FOUNDATION_DOWNLOAD_SOURCES } from '../../server/modules/legal/catalogs/curatedLegalDownloadSources';
import { downloadLegalSources } from '../../server/modules/legal/services/legalSourceDownloadService';

describe('P2-AUTH-03D3 historical red proof - executable legacy acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P2-AUTH-03D3 VIOLATED: a migrated source still reaches network and archive writes', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      arrayBuffer: async () => Buffer.from('legacy source bytes') as unknown as ArrayBuffer,
    }));

    await downloadLegalSources({
      definitions: [FOUNDATION_DOWNLOAD_SOURCES[0]],
      outputDir: 'legacy-foundation-output',
      fetchImpl,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    throw new Error(
      'P2-AUTH-03D3 VIOLATED: network_calls=1; archive_outputs=2; ' + 'verified_source_authority_used=false',
    );
  });
});
