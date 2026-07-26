import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../server/logger';

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  embedText: vi.fn(),
  parseLegalReference: vi.fn(),
  generateJsonWithVertex: vi.fn(),
  vertexConfigStatus: vi.fn(),
  rerankWithGeminiOrLexical: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

vi.mock('../../server/services/searchService', () => ({
  embedText: mocks.embedText,
}));

vi.mock('../../server/services/vertexAiService', () => ({
  generateJsonWithVertex: mocks.generateJsonWithVertex,
  vertexConfigStatus: mocks.vertexConfigStatus,
}));

vi.mock('../../server/modules/legal/services/legalReferenceParser', () => ({
  parseLegalReference: mocks.parseLegalReference,
}));

vi.mock('../../server/services/legalRerankService', () => ({
  rerankWithGeminiOrLexical: mocks.rerankWithGeminiOrLexical,
  localLexicalRerank: (query: string, items: Array<{ chunkText: string; score: number }>) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = items.map((it) => {
      let matches = 0;
      for (const term of terms) {
        if (it.chunkText.toLowerCase().includes(term)) matches++;
      }
      const boost = matches * 0.1;
      return { ...it, finalScore: it.score + boost };
    });
    return scored.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
  },
}));

import {
  getLegalCorpusSearchConfig,
  isTransientError,
  localLexicalRerank,
  resetLegalCorpusVectorColumnCache,
  searchLegalCorpusHandler,
  shouldSkipReranker,
} from '../../server/modules/ai/orchestrator/tools/searchLegalCorpusTool';

describe('searchLegalCorpusTool — Alphaevolve A1', () => {
  const originalReranker = process.env.LEGAL_RERANKER;
  const originalGap = process.env.LEGAL_RERANKER_RELATIVE_GAP;

  beforeEach(() => {
    vi.clearAllMocks();
    resetLegalCorpusVectorColumnCache();
    delete process.env.LEGAL_RERANKER;
    delete process.env.LEGAL_RERANKER_RELATIVE_GAP;
    mocks.parseLegalReference.mockReturnValue(null);
    mocks.embedText.mockResolvedValue({
      values: [0.1, 0.2, 0.3],
      model: 'text-multilingual-embedding-002',
    });
    mocks.rerankWithGeminiOrLexical.mockImplementation(async (query, items) => {
      const sorted = [...items];
      sorted.sort((a, b) => {
        const aMatch = a.chunkText.toLowerCase().includes('fosforrening') ? 1 : 0;
        const bMatch = b.chunkText.toLowerCase().includes('fosforrening') ? 1 : 0;
        return bMatch - aMatch;
      });
      return {
        engine: 'lexical',
        promptVersion: 'offline-fallback',
        items: sorted.map((it) => ({ id: it.id, finalScore: it.score, rerankApplied: true })),
      };
    });
  });

  afterEach(() => {
    if (originalReranker === undefined) delete process.env.LEGAL_RERANKER;
    else process.env.LEGAL_RERANKER = originalReranker;
    if (originalGap === undefined) delete process.env.LEGAL_RERANKER_RELATIVE_GAP;
    else process.env.LEGAL_RERANKER_RELATIVE_GAP = originalGap;
  });

  it('returnerar fel om query är för kort', async () => {
    const result = await searchLegalCorpusHandler({ query: 'a' });
    expect(result).toEqual({ error: 'Söksträngen är för kort.' });
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('söker vector mot legal_corpus_chunks (inte records) och fusar på chunk-id', async () => {
    mocks.queryRawUnsafe
      // Exact arm (ingen lagrum-träff → parseLegalReference null → empty, but runExactArm still not calling if null - wait, exact returns [] without SQL when no ref)
      // Actually runExactArm with null ref returns [] without query.
      // Then Promise.all: Exact=[], FTS query, Vector column check, Vector search, then record details
      .mockResolvedValueOnce([
        {
          chunk_id: 'chunk-fts-1',
          record_id: 'rec-1',
          chunk_text: 'FTS: fosforrening i enskilt avlopp.',
          chapter: '2',
          paragraph: '6',
          section: null,
          rank: 0.9,
        },
      ])
      .mockResolvedValueOnce([{ column_name: 'embedding_vector' }])
      .mockResolvedValueOnce([
        {
          chunk_id: 'chunk-vec-1',
          record_id: 'rec-2',
          chunk_text: 'Vektor: krav på fosforavskiljning.',
          chapter: null,
          paragraph: null,
          section: null,
          similarity: 0.88,
        },
        {
          chunk_id: 'chunk-fts-1',
          record_id: 'rec-1',
          chunk_text: 'FTS: fosforrening i enskilt avlopp.',
          chapter: '2',
          paragraph: '6',
          section: null,
          similarity: 0.7,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'rec-1',
          title: 'Dom A',
          case_number: 'M 1-22',
          published_at: null,
          decision_date: null,
          authority_name: 'MMD',
          legal_area: 'avlopp',
          metadata: {},
          source_url: null,
          source_path: '/a',
        },
        {
          id: 'rec-2',
          title: 'Dom B',
          case_number: 'M 2-22',
          published_at: null,
          decision_date: null,
          authority_name: 'MMD',
          legal_area: 'avlopp',
          metadata: {},
          source_url: null,
          source_path: '/b',
        },
      ]);

    const result = await searchLegalCorpusHandler({ query: 'fosforrening' });

    expect(result).not.toHaveProperty('error');
    expect(Array.isArray((result as { results: unknown[] }).results)).toBe(true);

    const sqlCalls = mocks.queryRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes('legal_corpus_chunks') && sql.includes('<=>'))).toBe(true);
    expect(sqlCalls.some((sql) => /FROM\s+legal_corpus_records[\s\S]*<=>/i.test(sql))).toBe(false);

    const results = (
      result as {
        results: Array<{ chunkId: string; snippet: string; score: number }>;
      }
    ).results;

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => typeof r.chunkId === 'string')).toBe(true);
    expect(results.every((r) => typeof r.snippet === 'string' && r.snippet.length > 0)).toBe(true);

    // Chunk som träffas av både FTS och vector ska få högre RRF än vector-only.
    const both = results.find((r) => r.chunkId === 'chunk-fts-1');
    const vectorOnly = results.find((r) => r.chunkId === 'chunk-vec-1');
    expect(both).toBeDefined();
    expect(vectorOnly).toBeDefined();
    expect(both!.score).toBeGreaterThan(vectorOnly!.score);
  });

  it('kör Exact + FTS + Vector parallellt och returnerar upp till 30 chunks', async () => {
    mocks.parseLegalReference.mockReturnValue({
      lawName: 'Miljöbalken',
      chapter: '2',
      paragraph: '6',
    });

    const manyVector = Array.from({ length: 40 }, (_, i) => ({
      chunk_id: `chunk-v-${i}`,
      record_id: `rec-v-${i}`,
      chunk_text: `Vektorchunk ${i}`,
      chapter: null,
      paragraph: null,
      section: null,
      similarity: 1 - i * 0.01,
    }));

    let call = 0;
    mocks.queryRawUnsafe.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const text = String(sql);
      call += 1;
      if (text.includes('information_schema.columns')) {
        return [{ column_name: 'embedding_vector' }];
      }
      if (text.includes('c.chapter = $1') && text.includes('c.paragraph = $2')) {
        return [
          {
            chunk_id: 'chunk-exact-1',
            record_id: 'rec-exact',
            chunk_text: '2 kap. 6 § MB',
            chapter: '2',
            paragraph: '6',
            section: null,
          },
        ];
      }
      if (text.includes('websearch_to_tsquery')) {
        return [];
      }
      if (text.includes('<=>')) {
        return manyVector;
      }
      if (text.includes('WHERE id IN')) {
        return params.map((id) => ({
          id,
          title: `Title ${id}`,
          case_number: null,
          published_at: null,
          decision_date: null,
          authority_name: null,
          legal_area: null,
          metadata: {},
          source_url: null,
          source_path: null,
        }));
      }
      return [];
    });

    const result = await searchLegalCorpusHandler({ query: '2 kap. 6 § miljöbalken' });
    const results = (result as { results: unknown[]; meta?: { topK: number } }).results;

    expect(results.length).toBe(30);
    expect((result as { meta: { topK: number } }).meta.topK).toBe(30);
    expect(call).toBeGreaterThanOrEqual(4);
  });

  it('använder chunk_text som snippet (grounding), inte hela dokumentet', async () => {
    mocks.queryRawUnsafe.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        return [{ column_name: 'embedding_vector' }];
      }
      if (text.includes('websearch_to_tsquery')) {
        return [
          {
            chunk_id: 'chunk-1',
            record_id: 'rec-1',
            chunk_text: 'Endast denna chunk ska visas.',
            chapter: null,
            paragraph: null,
            section: null,
            rank: 1,
          },
        ];
      }
      if (text.includes('<=>')) {
        return [];
      }
      if (text.includes('WHERE id IN')) {
        return [
          {
            id: 'rec-1',
            title: 'Långt dokument',
            case_number: 'M 1',
            published_at: null,
            decision_date: null,
            authority_name: 'MMD',
            legal_area: null,
            metadata: { lagrumLista: ['MB 2:6'] },
            source_url: null,
            source_path: '/x',
          },
        ];
      }
      return [];
    });

    const result = await searchLegalCorpusHandler({ query: 'fosfor' });
    const row = (result as { results: Array<{ snippet: string; chunkText: string }> }).results[0];
    expect(row.snippet).toBe('Endast denna chunk ska visas.');
    expect(row.chunkText).toBe('Endast denna chunk ska visas.');
  });
});

describe('searchLegalCorpusTool — Alphaevolve A2', () => {
  const originalReranker = process.env.LEGAL_RERANKER;
  const originalGap = process.env.LEGAL_RERANKER_RELATIVE_GAP;

  beforeEach(() => {
    vi.clearAllMocks();
    resetLegalCorpusVectorColumnCache();
    delete process.env.LEGAL_RERANKER;
    delete process.env.LEGAL_RERANKER_RELATIVE_GAP;
    mocks.parseLegalReference.mockReturnValue(null);
    mocks.embedText.mockResolvedValue({
      values: [0.1, 0.2, 0.3],
      model: 'text-multilingual-embedding-002',
    });
    mocks.vertexConfigStatus.mockReturnValue({
      configured: false,
      missing: ['VERTEX_PROJECT_ID'],
      projectId: null,
      location: 'europe-west1',
      hasExplicitServiceAccountFile: false,
    });
    mocks.generateJsonWithVertex.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalReranker === undefined) delete process.env.LEGAL_RERANKER;
    else process.env.LEGAL_RERANKER = originalReranker;
    if (originalGap === undefined) delete process.env.LEGAL_RERANKER_RELATIVE_GAP;
    else process.env.LEGAL_RERANKER_RELATIVE_GAP = originalGap;
  });

  it('läser feature-flagga LEGAL_RERANKER från env', () => {
    expect(getLegalCorpusSearchConfig({}).rerankerEnabled).toBe(false);
    expect(getLegalCorpusSearchConfig({ LEGAL_RERANKER: 'on' }).rerankerEnabled).toBe(true);
    expect(getLegalCorpusSearchConfig({ LEGAL_RERANKER: 'true' }).rerankerEnabled).toBe(true);
    expect(getLegalCorpusSearchConfig({ LEGAL_RERANKER: '0' }).rerankerEnabled).toBe(false);
  });

  it('skippar rerank vid dominant relativ RRF-gap', () => {
    expect(shouldSkipReranker([0.04, 0.02], 0.25)).toBe(true); // gap 50%
    expect(shouldSkipReranker([0.04, 0.035], 0.25)).toBe(false); // gap 12.5%
    expect(shouldSkipReranker([0.04], 0.25)).toBe(true);
  });

  it('höjer score för chunks med stark lexical match', () => {
    const ranked = localLexicalRerank('fosforrening enskilt avlopp', [
      { chunkText: 'Krav på fosforrening i enskilt avlopp.', score: 0.02 },
      { chunkText: 'Allmän text om vägbyggnad.', score: 0.03 },
    ]);
    const byText = Object.fromEntries(ranked.map((r) => [r.chunkText, r.finalScore]));
    expect(byText['Krav på fosforrening i enskilt avlopp.']).toBeGreaterThan(
      byText['Allmän text om vägbyggnad.'],
    );
  });

  function mockHybridCorpus(
    chunks: Array<{ chunk_id: string; record_id: string; chunk_text: string; rank: number }>,
  ) {
    mocks.queryRawUnsafe.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        return [{ column_name: 'embedding_vector' }];
      }
      if (text.includes('websearch_to_tsquery')) {
        return chunks.map((c) => ({
          ...c,
          chapter: null,
          paragraph: null,
          section: null,
        }));
      }
      if (text.includes('<=>')) {
        return [];
      }
      if (text.includes('WHERE id IN')) {
        return params.map((id) => ({
          id,
          title: `Title ${id}`,
          case_number: null,
          published_at: null,
          decision_date: null,
          authority_name: null,
          legal_area: null,
          metadata: {},
          source_url: null,
          source_path: null,
        }));
      }
      return [];
    });
  }

  it('med LEGAL_RERANKER=on och stort gap: skippar rerank och returnerar top 8', async () => {
    process.env.LEGAL_RERANKER = 'on';
    process.env.LEGAL_RERANKER_RELATIVE_GAP = '0.25';

    // Endast en stark FTS-träff → length < 2 ⇒ skip
    mockHybridCorpus([
      {
        chunk_id: 'chunk-strong',
        record_id: 'rec-1',
        chunk_text: 'Dominant träff om fosforrening.',
        rank: 0.99,
      },
    ]);

    const result = await searchLegalCorpusHandler({ query: 'fosforrening' });
    const body = result as {
      results: Array<{ chunkId: string; rerankApplied?: boolean }>;
      meta: { rerankerStatus: string; topK: number };
    };

    expect(body.meta.rerankerStatus).toBe('skipped_gap');
    expect(body.meta.topK).toBe(8);
    expect(body.results.length).toBe(1);
    expect(body.results[0].rerankApplied).toBe(false);
  });

  it('med LEGAL_RERANKER=on och litet gap: applicerar lexical rerank till top 8', async () => {
    process.env.LEGAL_RERANKER = 'on';
    process.env.LEGAL_RERANKER_RELATIVE_GAP = '0.25';

    // Många chunks med liknande FTS-rank → litet RRF-gap mellan #1 och #2 (samma arm)
    // Actually with only FTS arm, ranks are 1/(60+1), 1/(60+2), ... relative gap between first two:
    // (1/61 - 1/62) / (1/61) = 1 - 61/62 ≈ 0.016 → well below 0.25
    mockHybridCorpus(
      Array.from({ length: 12 }, (_, i) => ({
        chunk_id: `chunk-${i}`,
        record_id: `rec-${i}`,
        chunk_text:
          i === 5
            ? 'Fosforrening i enskilt avlopp enligt föreskrift.'
            : `Generell miljötext nummer ${i} utan nyckelord.`,
        rank: 1 - i * 0.01,
      })),
    );

    const result = await searchLegalCorpusHandler({ query: 'fosforrening enskilt avlopp' });
    const body = result as {
      results: Array<{ chunkId: string; rerankApplied?: boolean; finalScore?: number }>;
      meta: { rerankerStatus: string; topK: number };
    };

    expect(body.meta.rerankerStatus).toBe('applied');
    expect(body.meta.topK).toBe(8);
    expect(body.results.length).toBe(8);
    expect(body.results.every((r) => r.rerankApplied === true)).toBe(true);
    expect(body.results[0].chunkId).toBe('chunk-5');
  });

  it('exponerar rerankerEngine och promptVersion i meta', async () => {
    process.env.LEGAL_RERANKER = 'on';
    process.env.LEGAL_RERANKER_RELATIVE_GAP = '0.25';

    mockHybridCorpus(
      Array.from({ length: 4 }, (_, i) => ({
        chunk_id: `chunk-${i}`,
        record_id: `rec-${i}`,
        chunk_text: `Miljötext ${i}`,
        rank: 1 - i * 0.01,
      })),
    );

    const result = await searchLegalCorpusHandler({ query: 'miljö tillstånd' });
    const body = result as {
      meta: { rerankerEngine: string; promptVersion: string };
    };

    expect(body.meta.rerankerEngine).toBe('lexical');
    expect(body.meta.promptVersion).toBe('offline-fallback');
  });
});

describe('searchLegalCorpusTool — Resilience & Telemetry Improvements', () => {
  function mockHybridCorpus(
    chunks: Array<{ chunk_id: string; record_id: string; chunk_text: string; rank: number }>,
  ) {
    mocks.queryRawUnsafe.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        return [{ column_name: 'embedding_vector' }];
      }
      if (text.includes('websearch_to_tsquery')) {
        return chunks.map((c) => ({
          ...c,
          chapter: null,
          paragraph: null,
          section: null,
        }));
      }
      if (text.includes('<=>')) {
        return [];
      }
      if (text.includes('WHERE id IN')) {
        return params.map((id) => ({
          id,
          title: `Title ${id}`,
          case_number: null,
          published_at: null,
          decision_date: null,
          authority_name: null,
          legal_area: null,
          metadata: {},
          source_url: null,
          source_path: null,
        }));
      }
      return [];
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetLegalCorpusVectorColumnCache();
    delete process.env.LEGAL_RERANKER;
    delete process.env.LEGAL_RERANKER_RELATIVE_GAP;
    mocks.parseLegalReference.mockReturnValue(null);
    mocks.embedText.mockResolvedValue({
      values: [0.1, 0.2, 0.3],
      model: 'text-multilingual-embedding-002',
    });
  });

  it('verifierar isTransientError funktionalitet', () => {
    expect(isTransientError(new Error('connection timeout error'))).toBe(true);
    expect(isTransientError(new Error('network socket hang up'))).toBe(true);
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientError(new Error('Syntax error near SELECT'))).toBe(false);
  });

  it('reranker kastar transient fel -> assert reranker.error loggas med retryable: true', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    process.env.LEGAL_RERANKER = 'on';
    process.env.LEGAL_RERANKER_RELATIVE_GAP = '0.25';

    mockHybridCorpus([
      { chunk_id: 'c-1', record_id: 'r-1', chunk_text: 'Avloppstext 1', rank: 0.9 },
      { chunk_id: 'c-2', record_id: 'r-2', chunk_text: 'Avloppstext 2', rank: 0.89 },
      { chunk_id: 'c-3', record_id: 'r-3', chunk_text: 'Avloppstext 3', rank: 0.88 },
      { chunk_id: 'c-4', record_id: 'r-4', chunk_text: 'Avloppstext 4', rank: 0.87 },
    ]);

    mocks.rerankWithGeminiOrLexical.mockRejectedValue(new Error('Network timeout fetching Gemini'));

    const result = await searchLegalCorpusHandler({ query: 'avlopp' });
    expect(result).toBeDefined();
    expect((result as any).results.length).toBe(4);

    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls;
    const rerankerErrorCall = calls.find(call => call[1]?.event === 'reranker.error');
    expect(rerankerErrorCall).toBeDefined();
    expect(rerankerErrorCall![1].retryable).toBe(true);
    expect(rerankerErrorCall![1].errorMessage).toContain('Network timeout');
    errorSpy.mockRestore();
  });

  it('retrieval kastar -> assert search.failed loggas med retryable: true och totalMs', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    const transientErr = new Error('Prisma database connection lost');
    transientErr.name = 'PrismaClientInitializationError';
    mocks.queryRawUnsafe.mockRejectedValueOnce(transientErr);

    await expect(searchLegalCorpusHandler({ query: 'avlopp' })).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls;
    const searchFailedCall = calls.find(call => call[1]?.event === 'search.failed');
    expect(searchFailedCall).toBeDefined();
    expect(searchFailedCall![1].retryable).toBe(true);
    expect(typeof searchFailedCall![1].totalMs).toBe('number');
    errorSpy.mockRestore();
  });

  it('normal sökning returnerar meta med alla latency-fält', async () => {
    mockHybridCorpus([
      { chunk_id: 'c-1', record_id: 'r-1', chunk_text: 'Text', rank: 0.9 }
    ]);
    const result = await searchLegalCorpusHandler({ query: 'miljöbalken' });
    const meta = (result as any).meta;
    expect(meta).toBeDefined();
    expect(typeof meta.exactMs).toBe('number');
    expect(typeof meta.ftsMs).toBe('number');
    expect(typeof meta.vectorMs).toBe('number');
    expect(typeof meta.rrfMs).toBe('number');
    expect(typeof meta.rerankMs).toBe('number');
    expect(typeof meta.totalMs).toBe('number');
  });

  it('completed sökning loggar queryHashSaltVersion och läcker inte salt', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    mockHybridCorpus([
      { chunk_id: 'c-1', record_id: 'r-1', chunk_text: 'Text', rank: 0.9 }
    ]);
    await searchLegalCorpusHandler({ query: 'miljöbalken' });
    const calls = infoSpy.mock.calls;
    const searchCompletedCall = calls.find(call => call[1]?.event === 'search.completed');
    expect(searchCompletedCall).toBeDefined();
    expect(searchCompletedCall![1].queryHashSaltVersion).toBe('v1');
    expect(searchCompletedCall![1].QUERY_HASH_SALT).toBeUndefined();
    expect(JSON.stringify(searchCompletedCall![1])).not.toContain('QUERY_HASH_SALT');
    infoSpy.mockRestore();
  });
});
