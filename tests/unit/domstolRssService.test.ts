import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../server/repositories/judgmentRepository', () => ({
  upsertJudgment: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    pipelineRun: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceWithMatrix: vi.fn(),
}));

vi.mock('../../server/services/legalSourceIngestService', () => ({
  buildJudgmentLegalSourceSeed: vi.fn().mockReturnValue({ title: 'Dom', link: 'https://test' }),
}));

vi.mock('../../server/utils/textEncoding', () => ({
  normalizeExternalText: vi.fn((t: string) => t),
}));

import { upsertJudgment } from '../../server/repositories/judgmentRepository';
import { upsertLegalSourceWithMatrix } from '../../server/repositories/legalSourceRepository';
import { ingestDomstolRssFeed } from '../../server/services/domstolRssService';
import {
  installSourceRegistryFixtureEnv,
  writeVerifiedSourceRegistryFixture,
} from './import/sourceRegistryFixture';

const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:a10="http://www.w3.org/2005/Atom">
  <channel>
    <title>Domstolsverket beslut</title>
    <item>
      <guid isPermaLink="true">https://www.domstol.se/beslut/2025/1234</guid>
      <link>https://www.domstol.se/beslut/2025/1234</link>
      <title>Dom i miljömål – Gävle tingsrätt</title>
      <description>Mål om utsläpp från avloppsanläggning</description>
      <pubDate>Mon, 10 Mar 2025 00:00:00 +0100</pubDate>
      <a10:updated>2025-03-10T12:34:09+01:00</a10:updated>
    </item>
    <item>
      <guid isPermaLink="false">https://www.domstol.se/beslut/2025/5678</guid>
      <link>https://www.domstol.se/beslut/2025/5678</link>
      <title>Miljödom – Mark- och miljödomstolen</title>
      <description>Överklagande av tillståndsansökan</description>
      <pubDate>Tue, 11 Mar 2025 00:00:00 +0100</pubDate>
      <a10:updated>2025-03-11T09:00:00+01:00</a10:updated>
    </item>
  </channel>
</rss>`;

const mockEmptyRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Domstolsverket</title>
  </channel>
</rss>`;

const now = new Date();
const createdJudgment = { id: 'j-1', createdAt: now, updatedAt: now };
const updatedJudgment = { id: 'j-2', createdAt: new Date('2025-01-01'), updatedAt: now };
const originalSourceRegistryEnv = {
  SOURCE_REGISTRY_ARTIFACT_PATH: process.env.SOURCE_REGISTRY_ARTIFACT_PATH,
  SOURCE_REGISTRY_SIGNING_KEY_ID: process.env.SOURCE_REGISTRY_SIGNING_KEY_ID,
  SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM,
  SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM,
};

let tempDirs: string[] = [];

function restoreSourceRegistryEnv(): void {
  for (const key of Object.keys(originalSourceRegistryEnv) as Array<keyof typeof originalSourceRegistryEnv>) {
    const value = originalSourceRegistryEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  restoreSourceRegistryEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domstol-rss-service-source-registry-'));
  tempDirs.push(dir);
  installSourceRegistryFixtureEnv(await writeVerifiedSourceRegistryFixture(dir, { sources: ['domstol_rss'] }));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRssXml),
    }),
  );
  vi.mocked(upsertJudgment).mockResolvedValue(createdJudgment as never);
  vi.mocked(upsertLegalSourceWithMatrix).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreSourceRegistryEnv();
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('domstolRssService', () => {
  describe('ingestDomstolRssFeed', () => {
    it('returnerar newJudgments och updatedJudgments', async () => {
      const result = await ingestDomstolRssFeed();
      expect(result).toHaveProperty('newJudgments');
      expect(result).toHaveProperty('updatedJudgments');
    });

    it('räknar ny dom (createdAt === updatedAt)', async () => {
      vi.mocked(upsertJudgment).mockResolvedValue(createdJudgment as never);
      const result = await ingestDomstolRssFeed();
      expect(result.newJudgments).toBe(2);
      expect(result.updatedJudgments).toBe(0);
    });

    it('räknar uppdaterad dom (createdAt !== updatedAt)', async () => {
      vi.mocked(upsertJudgment).mockResolvedValue(updatedJudgment as never);
      const result = await ingestDomstolRssFeed();
      expect(result.newJudgments).toBe(0);
      expect(result.updatedJudgments).toBe(2);
    });

    it('anropar upsertJudgment för varje item', async () => {
      await ingestDomstolRssFeed();
      expect(vi.mocked(upsertJudgment)).toHaveBeenCalledTimes(2);
    });

    it('anropar upsertLegalSourceWithMatrix för varje dom', async () => {
      await ingestDomstolRssFeed();
      expect(vi.mocked(upsertLegalSourceWithMatrix)).toHaveBeenCalledTimes(2);
    });

    it('kastar fel om fetch misslyckas', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          statusText: 'Service Unavailable',
        }),
      );
      await expect(ingestDomstolRssFeed()).rejects.toThrow('Failed to fetch RSS feed');
    });

    it('returnerar 0/0 om inga items i RSS-flödet', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(mockEmptyRssXml),
        }),
      );
      const result = await ingestDomstolRssFeed();
      expect(result.newJudgments).toBe(0);
      expect(result.updatedJudgments).toBe(0);
    });

    it('fortsätter trots fel på enskild item', async () => {
      vi.mocked(upsertJudgment)
        .mockRejectedValueOnce(new Error('DB error on item 1'))
        .mockResolvedValueOnce(createdJudgment as never);
      const result = await ingestDomstolRssFeed();
      // Second item still processed
      expect(result.newJudgments).toBe(1);
    });
  });
});
