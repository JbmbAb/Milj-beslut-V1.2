import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

  it('downloads NVV open data pages and capabilities with manifest', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('vic-wfs')) {
        throw new Error('DNS lookup failed');
      }

      if (input.includes('dice/oai')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => `
            <OAI-PMH>
              <ListRecords>
                <record>
                  <header><identifier>oai:DiVA.org:naturvardsverket-8882</identifier></header>
                  <metadata>
                    <oai_dc:dc>
                      <dc:title>Handbok 2010:1</dc:title>
                      <dc:format>application/pdf</dc:format>
                    </oai_dc:dc>
                  </metadata>
                </record>
              </ListRecords>
            </OAI-PMH>`,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }

      if (input.includes('FULLTEXT01.pdf')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => '',
          arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 test').buffer,
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `<body>${input}</body>`,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });

    const result = await downloadNaturvardsverketKnowledge({
      outputDir,
      fetchImpl,
      now: () => new Date('2026-04-27T18:30:00.000Z'),
    });

    expect(result.files).toEqual([
      'oppnadata.html',
      'geodatakatalogen.html',
      'naturvardsregistret-wfs-capabilities.xml',
      'broschyrer/manifest.json',
    ]);
    expect(rmMock).toHaveBeenCalledWith(outputDir, { recursive: true, force: true });
    expect(mkdirMock).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(6);
    expect(writeFileMock).toHaveBeenCalledWith(
      path.join(outputDir, 'manifest.json'),
      expect.stringContaining('"legacyEbhProbe"'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      path.join(outputDir, 'broschyrer', 'manifest.json'),
      expect.stringContaining('"downloads"'),
      'utf8',
    );
  });

  it('resolves the default NVV output directory', () => {
    const dir = resolveNaturvardsverketDownloadDirectory();
    expect(dir.toLowerCase()).toContain('naturvardsverket');
  });
});
