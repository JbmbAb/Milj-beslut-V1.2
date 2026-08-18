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

import { buildLansstyrelserCorpus } from '../../server/modules/legal/services/lansstyrelserCorpusService';
import { buildMmdCorpus } from '../../server/modules/legal/services/mmdCorpusService';

const REPO_ROOT = process.cwd();
const SELF_EXECUTING_SURFACES = [
  'scripts/fetch_sgu_portal_knowledge.ts',
  'scripts/fetch_diva_knowledge.ts',
  'scripts/fetch_boverket_knowledge.ts',
] as const;

describe('P2-AUTH-03E1 historical red proof - legacy discovery acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P2-AUTH-03E1 VIOLATED: discovery surfaces retain network and persistent write capability', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html><body>legacy discovery payload</body></html>',
    }));

    await buildMmdCorpus({
      outputDir: 'legacy-mmd-output',
      fetchImpl,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });
    await buildLansstyrelserCorpus({
      outputDir: 'legacy-lansstyrelser-output',
      fetchImpl,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(28);
    expect(writeFileMock).toHaveBeenCalledTimes(30);

    for (const relativePath of SELF_EXECUTING_SURFACES) {
      const source = fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
      expect(source).toMatch(/\bfetch\s*\(|boverketService\./);
      expect(source).toMatch(/writeFile|writeFileSync/);
      expect(source).toMatch(/main\(\)\.catch|fetchAllKnowledge\(\)/);
      expect(source).not.toContain('loadVerifiedSourceRegistry');
    }

    throw new Error(
      'P2-AUTH-03E1 VIOLATED: network_calls=28; archive_manifest_writes=30; ' +
        'additional_self_executing_surfaces=3; verified_source_authority_used=false',
    );
  });
});
