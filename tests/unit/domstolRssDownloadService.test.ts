import path from 'node:path';
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

  it('downloads raw feed and linked decision pages', async () => {
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

    const result = await downloadDomstolRssFeed({
      outputDir,
      fetchImpl,
      now: () => new Date('2026-04-27T18:00:00.000Z'),
    });

    expect(result.processed).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(rmMock).toHaveBeenCalledWith(outputDir, { recursive: true, force: true });
    expect(mkdirMock).toHaveBeenCalledWith(path.join(outputDir, 'pages'), { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith(path.join(outputDir, 'feed.xml'), expect.any(String), 'utf8');
    expect(writeFileMock).toHaveBeenCalledWith(
      path.join(outputDir, 'pages', 'dom-1.html'),
      expect.stringContaining('https://www.domstol.se/example/dom-1'),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenLastCalledWith(
      path.join(outputDir, 'items.json'),
      expect.stringContaining('"processed": 2'),
      'utf8',
    );
  });

  it('resolves the default output directory', () => {
    const dir = resolveDomstolRssDownloadDirectory();
    expect(dir.toLowerCase()).toContain('domstol-rss');
  });
});
