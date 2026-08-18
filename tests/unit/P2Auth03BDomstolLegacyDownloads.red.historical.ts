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

import { downloadDomstolRssFeed } from '../../server/modules/legal/services/domstolRssDownloadService';

describe('P2-AUTH-03B Domstol legacy download paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects the operator-reachable RSS downloader before network or filesystem writes', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        input.includes('/feed/15972/')
          ? '<rss><channel><item><guid>dom-1</guid><link>https://www.domstol.se/example/dom-1</link><title>Dom 1</title></item></channel></rss>'
          : '<html>legacy decision page</html>',
    }));

    await downloadDomstolRssFeed({
      outputDir: 'unused-by-mocked-fs',
      fetchImpl,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });

    const evidence = {
      network_calls: fetchImpl.mock.calls.length,
      filesystem_writes: writeFileMock.mock.calls.length,
      verified_source_registry_consulted: false,
    };

    expect(
      evidence.network_calls + evidence.filesystem_writes,
      `P2-AUTH-03B RSS VIOLATED\n${JSON.stringify(evidence, null, 2)}`,
    ).toBe(0);
  });

  it('rejects the self-executing PUH history CLI capability', () => {
    const target = path.resolve(process.cwd(), 'scripts/download-domstol-history.ts');
    const source = fs.readFileSync(target, 'utf8');
    const evidence = {
      directly_executable: /\bmain\(\)\.catch\(/.test(source),
      hardcoded_puh_authority: /https:\/\/rattspraxis\.etjanst\.domstol\.se\//.test(source),
      bare_network_fetch: /\bfetch\s*\(/.test(source),
      custom_file_write: /\bfs\.writeFile\s*\(/.test(source),
      verified_source_registry_consulted: /loadVerifiedSourceRegistry\s*\(/.test(source),
      governed_download_executor_used: /GovernedDownloadExecutor/.test(source),
    };
    const violation =
      evidence.directly_executable &&
      evidence.hardcoded_puh_authority &&
      evidence.bare_network_fetch &&
      evidence.custom_file_write &&
      !evidence.verified_source_registry_consulted &&
      !evidence.governed_download_executor_used;

    expect(
      violation,
      `P2-AUTH-03B HISTORY VIOLATED\n${JSON.stringify(evidence, null, 2)}`,
    ).toBe(false);
  });
});
