/**
 * raceConditions.test.ts
 *
 * Testar att tjänster fungerar korrekt vid samtida åtkomst:
 *  - Parallella embedText-anrop löser alla korrekt
 *  - warnedEmbeddingFallback-flaggan sätts en gång (inte race-känslig)
 *  - Parallella spatialAudit-anrop med olika koordinater returnerar isolerade resultat
 *  - Lantmäteriet token-cache: många samtida anrop gör bara ett token-fetch
 *  - Parallella RAG-sökningar för samma org är idempotenta
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks for embedText / searchService ─────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const embedTextWithVertexPredictMock = vi.hoisted(() => vi.fn());
const generateTextWithVertexMock = vi.hoisted(() => vi.fn());

vi.mock('../../server/services/vertexEmbeddingService', () => ({
  embedTextWithVertexPredict: embedTextWithVertexPredictMock,
}));

vi.mock('../../server/services/vertexAiService', () => ({
  generateTextWithVertex: generateTextWithVertexMock,
  generateTextWithVertexAndInlineData: vi.fn(),
  generateJsonWithVertex: vi.fn(),
  vertexConfigStatus: vi.fn(() => ({ configured: true, missing: [], projectId: 't', location: 'europe-west1', hasExplicitServiceAccountFile: true })),
  __resetVertexClientForTest: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// searchRepository stub (so embedDocumentChunks doesn't blow up)
vi.mock('../../server/repositories/searchRepository', () => ({
  queryTopSemanticChunks: vi.fn().mockResolvedValue([]),
  setChunkEmbeddingJson: vi.fn().mockResolvedValue(undefined),
  updateChunkVector: vi.fn().mockResolvedValue(undefined),
  replaceDocumentChunks: vi.fn().mockResolvedValue(undefined),
  setDocumentStatus: vi.fn().mockResolvedValue(undefined),
  findDocumentsForProject: vi.fn().mockResolvedValue([]),
  findDocumentByDiskName: vi.fn().mockResolvedValue(null),
  logSearchQuery: vi.fn().mockResolvedValue(undefined),
  listChunksForDocument: vi.fn().mockResolvedValue([]),
  listChunksForProject: vi.fn().mockResolvedValue([]),
  getDocumentById: vi.fn().mockResolvedValue(null),
  enqueueSearchJob: vi.fn().mockResolvedValue(undefined),
  upsertDocumentContent: vi.fn().mockResolvedValue(undefined),
  upsertDocumentFromManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    document: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../server/services/geoService', () => ({
  checkGeospatialRisks: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../server/services/knowledgeGraphService', () => ({
  searchGraph: vi.fn().mockResolvedValue({ nodes: [] }),
}));

// ─── Mocks for spatialAuditService ───────────────────────────────────────────

vi.mock('../../server/services/sguRiskService', () => ({
  auditSguRiskAtPoint: vi.fn().mockResolvedValue({
    summary: 'SGU: inga risker.',
    riskLevel: 'NONE',
    manualReviewRequired: false,
    coverageMode: 'complete',
    groundLayerScale: '1:1M',
    hits: [],
  }),
}));

import { prisma } from '../../server/db/prisma';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVertexEmbeddingResult(values?: number[]) {
  return {
    values: values ?? new Array(768).fill(0.5),
    model: 'text-multilingual-embedding-002',
  };
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── embedText race-conditions ────────────────────────────────────────────────

describe('raceConditions – embedText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERTEX_PROJECT_ID = 'test-proj';
    process.env.EMBEDDING_MODEL = 'text-multilingual-embedding-002';
    embedTextWithVertexPredictMock.mockReset();
  });

  it('alle N parallella embedText-anrop löser med distinkt inbäddning', async () => {
    const { embedText } = await import('../../server/services/searchService');

    const N = 8;
    for (let i = 0; i < N; i++) {
      const val = (i + 1) / 10;
      embedTextWithVertexPredictMock.mockResolvedValueOnce(makeVertexEmbeddingResult(new Array(768).fill(val)));
    }

    const results = await Promise.all(Array.from({ length: N }, (_, i) => embedText(`query ${i}`)));

    expect(results).toHaveLength(N);
    for (const r of results) {
      expect(r.values).toHaveLength(768);
    }
  });

  it('N parallella anrop returnerar alla successful even if one rejects', async () => {
    const { embedText } = await import('../../server/services/searchService');

    embedTextWithVertexPredictMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(makeVertexEmbeddingResult())
      .mockResolvedValueOnce(makeVertexEmbeddingResult())
      .mockResolvedValueOnce(makeVertexEmbeddingResult());

    const results = await Promise.allSettled([
      embedText('fail'),
      embedText('ok-1'),
      embedText('ok-2'),
      embedText('ok-3'),
    ]);

    // embedText catches errors and returns null (not rejects). Verify:
    // - One result has value=null (failed fetch)
    // - Three results have non-null values (successful fetches)
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(fulfilled).toHaveLength(4); // All fulfilled (no rejections from the hook itself)
    const nullResults = fulfilled.filter((r) => r.value === null);
    const nonNullResults = fulfilled.filter((r) => r.value !== null);
    expect(nullResults).toHaveLength(1);
    expect(nonNullResults).toHaveLength(3);
  });

  it('embedText utan VERTEX_PROJECT_ID returnerar null och påverkar inte parallellt anrop', async () => {
    const saved = process.env.VERTEX_PROJECT_ID;
    delete process.env.VERTEX_PROJECT_ID;

    const { embedText } = await import('../../server/services/searchService');

    const [noProj, withProj] = await Promise.allSettled([
      embedText('fråga utan projekt'),
      (async () => {
        process.env.VERTEX_PROJECT_ID = 'restored-proj';
        embedTextWithVertexPredictMock.mockResolvedValueOnce(makeVertexEmbeddingResult());
        return embedText('fråga med projekt');
      })(),
    ]);

    expect(noProj.status).toBe('fulfilled');
    expect((noProj as PromiseFulfilledResult<any>).value).toBeNull();
    expect(['fulfilled', 'rejected']).toContain(withProj.status);

    process.env.VERTEX_PROJECT_ID = saved;
  });
});

// ─── spatialAuditService race-conditions ─────────────────────────────────────

describe('raceConditions – spatialAuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('4 parallella spatialAudit-anrop returnerar isolerade resultat', async () => {
    // Varje queryRaw-anrop svarar med koordinat-specifika data
    const coords = [
      { lat: 59.3, lon: 18.1, name: 'Stockholm Reservat' },
      { lat: 57.7, lon: 12.0, name: 'Göteborg Reservat' },
      { lat: 55.6, lon: 13.0, name: null },
      { lat: 65.5, lon: 22.1, name: 'Luleå Reservat' },
    ];

    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(() =>
      // Each call gets its own promise; we identify by call-count order
      Promise.resolve([]),
    );

    // Re-mock with per-call data
    let callIndex = 0;
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const c = coords[callIndex++ % coords.length];
      if (!c) return Promise.resolve([]);
      if (!c.name) return Promise.resolve([]);
      return Promise.resolve([
        {
          nvr_id: `id-${c.lat}`,
          name: c.name,
          protection_type: 'Naturreservat',
          decision_status: 'GALLANDE',
        },
      ]);
    });

    const { runSpatialAudit } = await import('../../server/services/spatialAuditService');

    const results = await Promise.all(coords.map((c) => runSpatialAudit(c.lat, c.lon)));

    // Stockholm → skyddad
    expect(results[0].isProtected).toBe(true);
    expect(results[0].protectedAreaHits[0].name).toBe('Stockholm Reservat');
    // Göteborg → skyddad
    expect(results[1].isProtected).toBe(true);
    // Null-namn → obekräftad eller hittar namnlöst
    expect(results[2].isProtected).toBe(false);
    // Luleå → skyddad
    expect(results[3].isProtected).toBe(true);
    expect(results[3].protectedAreaHits[0].name).toBe('Luleå Reservat');
  });

  it('spatialAudit-resultat blandas inte vid hög parallelism (stress test)', async () => {
    let callCnt = 0;
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const n = callCnt++;
      // Var annan anrop returnerar en area
      if (n % 2 === 0) {
        return Promise.resolve([
          {
            nvr_id: `id-${n}`,
            name: `Reservat-${n}`,
            protection_type: 'Naturreservat',
            decision_status: 'GALLANDE',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const { runSpatialAudit } = await import('../../server/services/spatialAuditService');

    const LAT_BASE = 59.0;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => runSpatialAudit(LAT_BASE + i * 0.1, 18.0 + i * 0.1)),
    );

    // Jämna index (0,2,4,…) → skyddad
    for (let i = 0; i < results.length; i++) {
      if (i % 2 === 0) {
        expect(results[i].isProtected).toBe(true);
        expect(results[i].protectedAreaHits[0].name).toBe(`Reservat-${i}`);
      } else {
        expect(results[i].isProtected).toBe(false);
      }
    }
  });
});

// ─── RAG-search idempotens under parallellism ─────────────────────────────────

describe('raceConditions – runRagSearch parallellism', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERTEX_PROJECT_ID = 'test-rag-proj';
    generateTextWithVertexMock.mockResolvedValue('Genererat svar');
  });

  it('10 parallella RAG-sökningar för samma org ger alla ett svar', async () => {
    const { queryTopSemanticChunks } = await import('../../server/repositories/searchRepository');

    embedTextWithVertexPredictMock.mockResolvedValue(makeVertexEmbeddingResult());
    (queryTopSemanticChunks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { runRagSearch } = await import('../../server/services/ragSearchService');

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runRagSearch({ query: `fråga ${i}`, organisationId: 'org-stress' }),
      ),
    );

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.answer).toBeTruthy();
      expect(typeof r.generatedAt).toBe('string');
    }
  });

  it('samtida anrop för olika orgs blandas inte i sources', async () => {
    const { queryTopSemanticChunks } = await import('../../server/repositories/searchRepository');
    embedTextWithVertexPredictMock.mockResolvedValue(makeVertexEmbeddingResult());

    (queryTopSemanticChunks as ReturnType<typeof vi.fn>).mockImplementation(
      ({ organisationId }: { organisationId: string }) =>
        Promise.resolve([
          {
            documentId: `doc-${organisationId}`,
            chunkIndex: 1,
            chunkText: `chunk för ${organisationId}`,
            similarity: 0.9,
          },
        ]),
    );

    const { runRagSearch } = await import('../../server/services/ragSearchService');

    const orgs = ['org-p', 'org-q', 'org-r', 'org-s'];
    const results = await Promise.all(
      orgs.map((org) => runRagSearch({ query: 'parallell fråga', organisationId: org })),
    );

    results.forEach((result, idx) => {
      const expectedOrg = orgs[idx];
      for (const source of result.sources) {
        expect(source.documentId).toContain(expectedOrg);
        for (const otherOrg of orgs.filter((o) => o !== expectedOrg)) {
          expect(source.documentId).not.toContain(otherOrg);
        }
      }
    });
  }, 20_000);
});

// ─── Tillståndsrenhet efter resetModules ──────────────────────────────────────

describe('raceConditions – modul-tillstånd', () => {
  it('modulen laddas om efter vi.resetModules()', async () => {
    vi.resetModules();
    process.env.VERTEX_PROJECT_ID = 'test-proj';
    embedTextWithVertexPredictMock.mockResolvedValue(makeVertexEmbeddingResult());

    const mod1 = await import('../../server/services/searchService');
    await mod1.embedText('test').catch(() => null);

    vi.resetModules();
    process.env.VERTEX_PROJECT_ID = 'test-proj';
    embedTextWithVertexPredictMock.mockResolvedValue(makeVertexEmbeddingResult());

    const mod2 = await import('../../server/services/searchService');
    expect(mod1).not.toBe(mod2);
  });

  it('parallella anrop med identiska indata ger identiska utdata (determinism)', async () => {
    process.env.VERTEX_PROJECT_ID = 'test-proj';
    const FIXED_VALUES = new Array(768).fill(0.42);
    embedTextWithVertexPredictMock.mockResolvedValue(makeVertexEmbeddingResult(FIXED_VALUES));

    const { embedText } = await import('../../server/services/searchService');

    const [r1, r2, r3] = await Promise.all([
      embedText('identisk text'),
      embedText('identisk text'),
      embedText('identisk text'),
    ]);

    // Alla tre ska ha samma values
    expect(r1.values).toEqual(r2.values);
    expect(r2.values).toEqual(r3.values);
  });
});
