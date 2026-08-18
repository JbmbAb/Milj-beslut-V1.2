import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

import { CURATED_LEGAL_DOWNLOAD_SOURCES } from '../../server/modules/legal/catalogs/curatedLegalDownloadSources';
import { downloadFoundationLegalSources } from '../../server/modules/legal/services/foundationLegalSourceDownloadService';
import { downloadLegalSources } from '../../server/modules/legal/services/legalSourceDownloadService';

describe('P2-AUTH-03D3 - legacy source acquisition containment', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks curated acquisition before network, archive or manifest writes', async () => {
    await expect(
      downloadLegalSources({
        definitions: CURATED_LEGAL_DOWNLOAD_SOURCES,
        outputDir: 'legacy-curated-output',
        fetchImpl,
      }),
    ).rejects.toThrow(/P2-AUTH-03D3 BLOCKED/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('blocks the foundation wrapper before network, archive or manifest writes', async () => {
    await expect(
      downloadFoundationLegalSources({
        outputDir: 'legacy-foundation-output',
        fetchImpl,
      }),
    ).rejects.toThrow(/P2-AUTH-03D3 BLOCKED/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('removes network and archive-write capability from the shared legacy service', () => {
    const source = readFileSync(
      resolve('server/modules/legal/services/legalSourceDownloadService.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/\bfetch\s*\(|writeFile|mkdir/);
    expect(source).not.toMatch(/manifest\.json|arrayBuffer/);
    expect(source).not.toMatch(/LegalSourceRecord|LegalCorpusRecord|JudgmentRecord|prisma/i);
  });

  it('removes hardcoded catalog authority from both operator entrypoints', () => {
    for (const path of [
      'scripts/download-curated-legal-sources.ts',
      'scripts/download-foundation-legal-sources.ts',
    ]) {
      const source = readFileSync(resolve(path), 'utf8');
      expect(source).toContain('rejectLegacyLegalAcquisition');
      expect(source).not.toMatch(/CURATED_LEGAL_DOWNLOAD_SOURCES|FOUNDATION_DOWNLOAD_SOURCES/);
      expect(source).not.toMatch(/downloadLegalSources|downloadFoundationLegalSources/);
    }
  });

  it('keeps existing legacy storage locations resolvable but read-only', async () => {
    const curated = await import('../../server/modules/legal/services/legalSourceDownloadService');
    const foundation =
      await import('../../server/modules/legal/services/foundationLegalSourceDownloadService');

    expect(curated.resolveCuratedLegalDownloadDirectory()).toContain('curated-downloads');
    expect(foundation.resolveFoundationLegalSourceDownloadDirectory()).toContain('foundation-sources');
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('leaves the installed governed P2 authority intact', () => {
    const registry = JSON.parse(
      readFileSync(resolve('source-registry/national-registry.json'), 'utf8'),
    ) as Array<{ source_id: string; adapter: string; lifecycle_state: string }>;
    const singleEndpoint = registry.filter((entry) => entry.adapter === 'SINGLE_ENDPOINT_V1');

    expect(registry).toHaveLength(9);
    expect(singleEndpoint).toHaveLength(8);
    expect(singleEndpoint.every((entry) => entry.lifecycle_state === 'APPROVED')).toBe(true);
  });
});
