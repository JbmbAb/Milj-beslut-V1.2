import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  downloadDomstolRssFeed,
  resolveDomstolRssDownloadDirectory,
} from '../../server/modules/legal/services/domstolRssDownloadService';
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

describe('domstolRssDownloadService', () => {
  const outputDir = testTmpDir('domstol-rss');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed before downloading the raw feed or linked decision pages', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/feed/15972/')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => `
            <rss>
              <channel>
                <item>
                  <guid isPermaLink="false">dom-1</guid>
                  <link>https://www.domstol.se/example/dom-1</link>
                  <title>Dom 1</title>
                </item>
                <item>
                  <guid isPermaLink="false">dom-2</guid>
                  <link>https://www.domstol.se/example/dom-2</link>
                  <title>Dom 2</title>
                </item>
              </channel>
            </rss>
          `,
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `<html>${input}</html>`,
      };
    });

    await expect(
      downloadDomstolRssFeed({
        outputDir,
        fetchImpl,
        now: () => new Date('2026-04-27T18:00:00.000Z'),
      }),
    ).rejects.toThrow('P2-AUTH-03B BLOCKED');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves the default output directory', () => {
    const dir = resolveDomstolRssDownloadDirectory();
    expect(dir.toLowerCase()).toContain('domstol-rss');
  });
});
