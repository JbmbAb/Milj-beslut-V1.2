import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, rmMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: { mkdir: mkdirMock, rm: rmMock, writeFile: writeFileMock },
  mkdir: mkdirMock,
  rm: rmMock,
  writeFile: writeFileMock,
}));

import { downloadNaturvardsverketKnowledge } from '../../server/modules/legal/services/naturvardsverketDownloadService';

const REPO_ROOT = process.cwd();
const SELF_EXECUTING_SURFACES = [
  'scripts/fetch_nvv_brochures.ts',
  'scripts/fetch_nvv_publications_site.ts',
] as const;

describe('P2-AUTH-03E2-A historical red proof - NVV legacy acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P2-AUTH-03E2-A VIOLATED: mixed NVV paths retain network and persistent write capability', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<OAI-PMH><ListRecords></ListRecords></OAI-PMH>',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    await downloadNaturvardsverketKnowledge({
      outputDir: 'legacy-nvv-output',
      fetchImpl,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(writeFileMock).toHaveBeenCalledTimes(5);

    for (const relativePath of SELF_EXECUTING_SURFACES) {
      const source = fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
      expect(source).toMatch(/\bfetch\s*\(/);
      expect(source).toMatch(/writeFile|writeFileSync/);
      expect(source).toMatch(/main\(\)\.catch|fetchAllNvvBrochures\(\)/);
      expect(source).not.toContain('loadVerifiedSourceRegistry');
    }

    throw new Error(
      'P2-AUTH-03E2-A VIOLATED: network_calls=5; payload_manifest_writes=5; ' +
        'additional_self_executing_surfaces=2; verified_source_authority_used=false',
    );
  });
});
