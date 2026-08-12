import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createTokenPair } from '../../server/security/auth';
import {
  installSourceRegistryFixtureEnv,
  writeVerifiedSourceRegistryFixture,
} from './import/sourceRegistryFixture';

const mocks = vi.hoisted(() => ({
  routeIngestDomstolRssFeed: vi.fn(),
  upsertJudgment: vi.fn(),
  upsertLegalSourceWithMatrix: vi.fn(),
  buildJudgmentLegalSourceSeed: vi.fn(),
  pipelineRunCreate: vi.fn(),
  pipelineRunUpdate: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/modules/legal/public', () => ({
  listJudgments: vi.fn(),
  ingestDomstolRssFeed: mocks.routeIngestDomstolRssFeed,
  searchLegalKnowledge: vi.fn(),
  listJudgmentRecordsPage: vi.fn(),
  listLegalSourceRecordsPage: vi.fn(),
}));

vi.mock('../../server/repositories/judgmentRepository', () => ({
  upsertJudgment: mocks.upsertJudgment,
}));

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceWithMatrix: mocks.upsertLegalSourceWithMatrix,
}));

vi.mock('../../server/services/legalSourceIngestService', () => ({
  buildJudgmentLegalSourceSeed: mocks.buildJudgmentLegalSourceSeed,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    pipelineRun: {
      create: mocks.pipelineRunCreate,
      update: mocks.pipelineRunUpdate,
    },
    legalCorpusRecord: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../server/utils/textEncoding', () => ({
  normalizeExternalText: vi.fn((value: string) => value),
}));

import legalRoutes from '../../server/routes/legal.routes';
import { ingestDomstolRssFeed } from '../../server/services/domstolRssService';

const app = express();
app.use(express.json());
app.use(legalRoutes);

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

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'consultant-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

async function installRegistry(sources: readonly string[]): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domstol-source-registry-'));
  tempDirs.push(dir);
  installSourceRegistryFixtureEnv(await writeVerifiedSourceRegistryFixture(dir, { sources }));
}

const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:a10="http://www.w3.org/2005/Atom">
  <channel>
    <item>
      <guid isPermaLink="true">https://www.domstol.se/beslut/2025/1234</guid>
      <link>https://www.domstol.se/beslut/2025/1234</link>
      <title>Dom i miljomal</title>
      <description>Miljorattsligt avgorande</description>
      <pubDate>Mon, 10 Mar 2025 00:00:00 +0100</pubDate>
      <a10:updated>2025-03-10T12:34:09+01:00</a10:updated>
    </item>
  </channel>
</rss>`;

describe('C-P1-03 — Domstol RSS authority enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    restoreSourceRegistryEnv();
    mocks.routeIngestDomstolRssFeed.mockResolvedValue({ newJudgments: 1, updatedJudgments: 0 });
    mocks.pipelineRunCreate.mockResolvedValue({});
    mocks.pipelineRunUpdate.mockResolvedValue({});
    const now = new Date('2026-08-12T12:00:00Z');
    mocks.upsertJudgment.mockResolvedValue({ id: 'judgment-1', createdAt: now, updatedAt: now });
    mocks.upsertLegalSourceWithMatrix.mockResolvedValue(undefined);
    mocks.buildJudgmentLegalSourceSeed.mockImplementation((input: unknown) => input);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreSourceRegistryEnv();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('rejects CONSULTANT before the manual Domstol RSS ingest handler is reached', async () => {
    const response = await request(app)
      .post('/api/legal/ingest/domstol-rss/run')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({});

    expect(response.status).toBe(403);
    expect(mocks.routeIngestDomstolRssFeed).not.toHaveBeenCalled();
  });

  it('allows an ADMIN operator to start the manual Domstol RSS ingest handler', async () => {
    const response = await request(app)
      .post('/api/legal/ingest/domstol-rss/run')
      .set('Authorization', authHeader('ADMIN'))
      .send({});

    expect(response.status).toBe(200);
    expect(mocks.routeIngestDomstolRssFeed).toHaveBeenCalledTimes(1);
  });

  it('blocks fetch and legal writes when Domstol RSS lacks a verified canonical source definition', async () => {
    await installRegistry(['mmd_nacka']);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(ingestDomstolRssFeed()).rejects.toThrow(
      "Domstol RSS ingest requires verified SourceRegistry source 'domstol_rss'.",
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.upsertJudgment).not.toHaveBeenCalled();
    expect(mocks.upsertLegalSourceWithMatrix).not.toHaveBeenCalled();
  });

  it('derives the feed URL from verified SourceRegistry before reaching legal writes', async () => {
    await installRegistry(['domstol_rss']);
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
        fetchCalls.push(url);
        return {
          ok: true,
          statusText: 'OK',
          text: async () => rssXml,
        } as Response;
      }),
    );

    const result = await ingestDomstolRssFeed();
    const serviceSource = fs.readFileSync(
      path.resolve(__dirname, '../../server/services/domstolRssService.ts'),
      'utf8',
    );

    expect(result).toEqual({ newJudgments: 1, updatedJudgments: 0 });
    expect(fetchCalls).toEqual(['https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972']);
    expect(mocks.upsertJudgment).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLegalSourceWithMatrix).toHaveBeenCalledTimes(1);
    expect(mocks.buildJudgmentLegalSourceSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFeed: 'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972',
      }),
    );
    expect(serviceSource).toContain('getVerifiedSourceDefinition');
    expect(serviceSource).not.toContain('const RSS_FEED_URL');
    expect(serviceSource).not.toContain("'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972'");
    expect(serviceSource).not.toContain('"https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972"');
  });
});
